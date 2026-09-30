import { execFile } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hashJson } from './audio-blocks.js';
import { DoubaoAudioGenerationClient, loadDoubaoCredentials, writeBufferAtomic } from './doubao-client.js';
import { pathExists, readJsonIfExists, replaceFileAtomic, sha256File, writeJsonAtomic, writeTextAtomic } from './files.js';
import { createDoubaoDemoReviewSource } from './review-source.js';
import { passesWhisperStructuralReview } from './scene-plan.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVIDER_CONFIG_PATH = join(PROJECT_ROOT, 'content', 'audio', 'providers', 'doubao.json');
const SCENE_PLAN_PATH = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'drama', '081', 'xiren-three-opera', 'scene-plan.json');
const OUTPUT_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'doubao', 'demos', '081', 'xiren-three-opera');
const WSL_DISTRIBUTION = 'Ubuntu-22.04';
const COSYVOICE_PYTHON = '/opt/miniconda3/envs/cosyvoice/bin/python';

function normalizeTranscript(text) {
	return String(text || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function instructionFor(target) {
	const source = String(target.instruction || target.performance?.instruction || '')
		.replace(/<\|endofprompt\|>/gu, '')
		.replace(/[。；;\s]+$/gu, '')
		.replace(/不尖叫、不吞字重复/gu, '不要尖叫，不吞字，不重复');
	const suffix = String(target.providerOverride?.instructionSuffix || '')
		.replace(/<\|endofprompt\|>/gu, '')
		.replace(/[。；;\s]+$/gu, '');
	return `请${source}${suffix ? `；${suffix}` : ''}；只朗读给定正文，不增加、删减或改写字词，不读角色名和舞台说明。`;
}

function toWslPath(path) {
	const normalized = resolve(path).replaceAll('\\', '/');
	const match = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
	if (!match) return normalized;
	return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function runArguments() {
	const args = new Set(process.argv.slice(2));
	return { dryRun: args.has('--dry-run'), allowSubtitleMismatch: args.has('--allow-subtitle-mismatch') };
}

async function runFfmpeg(args) {
	try {
		return await execFileAsync('wsl.exe', [
			'-d', WSL_DISTRIBUTION, '--', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args,
		], {
			windowsHide: true,
			maxBuffer: 8 * 1024 * 1024,
		});
	} catch (error) {
		throw new Error(`FFmpeg 处理失败：${error.stderr || error.message}`, { cause: error });
	}
}

async function normalizeWav(sourcePath, destinationPath, audio) {
	const temporaryPath = `${destinationPath}.${process.pid}.${Date.now()}.tmp.wav`;
	await runFfmpeg([
		'-i', toWslPath(sourcePath),
		'-ac', String(audio.channels),
		'-ar', String(audio.sampleRate),
		'-af', `loudnorm=I=${audio.targetLufs}:TP=${audio.truePeakDbfs}:LRA=7`,
		'-c:a', 'pcm_s16le', toWslPath(temporaryPath),
	]);
	await replaceFileAtomic(temporaryPath, destinationPath);
}

async function inspectAudio(path) {
	const { stdout } = await execFileAsync('wsl.exe', [
		'-d', WSL_DISTRIBUTION, '--', 'ffprobe',
		'-v', 'error', '-select_streams', 'a:0',
		'-show_entries', 'stream=codec_name,sample_rate,channels:format=duration,size',
		'-of', 'json', toWslPath(path),
	], { windowsHide: true });
	const data = JSON.parse(stdout);
	const stream = data.streams?.[0];
	if (!stream) throw new Error(`${path} 没有可解码音轨。`);
	return {
		codec: stream.codec_name,
		sampleRate: Number(stream.sample_rate),
		channels: Number(stream.channels),
		durationSeconds: Number(Number(data.format.duration).toFixed(3)),
		bytes: Number(data.format.size),
	};
}

async function fullDecode(path) {
	await runFfmpeg(['-i', toWslPath(path), '-f', 'null', '-']);
}

async function analyzeLoudness(path, master) {
	let result;
	try {
		result = await execFileAsync('wsl.exe', [
			'-d', WSL_DISTRIBUTION, '--', 'ffmpeg', '-hide_banner', '-nostats',
			'-i', toWslPath(path),
			'-af', `loudnorm=I=${master.targetLufs}:TP=${master.truePeakDbfs}:LRA=${master.loudnessRange}:print_format=json`,
			'-f', 'null', '-',
		], { windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`响度分析失败：${error.stderr || error.message}`, { cause: error });
	}
	const match = /\{\s*"input_i"[\s\S]*?\}/u.exec(result.stderr || '');
	if (!match) throw new Error(`无法解析 ${path} 的响度分析结果。`);
	return JSON.parse(match[0]);
}

function secondPassLoudnormFilter(measurement, master) {
	return [
		`loudnorm=I=${master.targetLufs}`,
		`TP=${master.truePeakDbfs}`,
		`LRA=${master.loudnessRange}`,
		`measured_I=${measurement.input_i}`,
		`measured_TP=${measurement.input_tp}`,
		`measured_LRA=${measurement.input_lra}`,
		`measured_thresh=${measurement.input_thresh}`,
		`offset=${measurement.target_offset}`,
		'linear=true',
		'print_format=summary',
	].join(':');
}

async function runWhisperValidation(artifacts) {
	const jobsPath = join(OUTPUT_DIRECTORY, 'whisper-jobs.json');
	const outputPath = join(OUTPUT_DIRECTORY, 'whisper-validation.json');
	const jobs = artifacts.map((artifact) => ({
		id: artifact.targetId,
		blockId: artifact.blockId,
		unitIndex: artifact.unitIndex,
		voiceCardId: artifact.voiceCardId,
		kind: 'dialogue',
		path: toWslPath(artifact.pathAbsolute),
		expectedText: artifact.synthesisText || artifact.text,
	}));
	await writeJsonAtomic(jobsPath, { version: 1, jobs });
	console.log(`Whisper small 检查 ${jobs.length} 个豆包对白片段...`);
	let result;
	try {
		result = await execFileAsync('wsl.exe', [
			'-d', WSL_DISTRIBUTION, '--', COSYVOICE_PYTHON,
			toWslPath(join(PROJECT_ROOT, 'scripts', 'audio', 'whisper_validate.py')),
			'--jobs', toWslPath(jobsPath),
			'--output', toWslPath(outputPath),
			'--model', 'small',
			'--verbose',
		], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`Whisper 检查失败：${error.stderr || error.message}`, { cause: error });
	}
	if (result.stdout?.trim()) console.log(result.stdout.trim());
	const validation = await readJsonIfExists(outputPath);
	if (!validation || validation.results?.length !== jobs.length) {
		throw new Error('Whisper 检查结果缺失或数量不符。');
	}
	validation.selectionReview = {
		version: 1,
		structuralPass: 0,
		needsReview: 0,
		results: validation.results.map((item) => {
			const structuralPass = passesWhisperStructuralReview(item);
			return {
				id: item.id,
				characterSimilarity: item.characterSimilarity,
				lengthRatio: item.lengthRatio,
				rawStatus: item.status,
				structuralPass,
			};
		}),
		interpretation: 'Whisper small 只做正文长度、顺序、重复和拖尾结构检查；同音字误识保留原始差异，不等同于艺术表现通过。',
	};
	validation.selectionReview.structuralPass = validation.selectionReview.results
		.filter((item) => item.structuralPass).length;
	validation.selectionReview.needsReview = jobs.length - validation.selectionReview.structuralPass;
	await writeJsonAtomic(outputPath, validation);
	if (validation.selectionReview.needsReview > 0) {
		throw new Error(`Whisper 结构检查有 ${validation.selectionReview.needsReview} 条未通过，请先返工片段。`);
	}
	return validation;
}

async function cachedArtifact(path, synthesisHash) {
	const metadata = await readJsonIfExists(`${path}.json`);
	if (!metadata || metadata.synthesisHash !== synthesisHash || !await pathExists(path)) return undefined;
	if (metadata.fileHash !== await sha256File(path)) return undefined;
	return metadata;
}

function longestSentenceText(sentences) {
	return sentences.map((item) => item?.text).filter((item) => typeof item === 'string')
		.sort((left, right) => [...right].length - [...left].length)[0];
}

function synthesisPlanFor(target, provider) {
	const instruction = instructionFor(target);
	const synthesisText = target.synthesisText || target.unitText;
	const textPrompt = `请参考@音频1的说话人身份和音色，${instruction}正文：“${synthesisText}”`;
	const synthesisSpec = {
		version: provider.audioGenerationApi.requestVersion,
		provider: provider.provider,
		apiKind: provider.audioGenerationApi.kind,
		endpoint: provider.audioGenerationApi.endpoint,
		model: provider.audioGenerationApi.model,
		targetId: target.targetId,
		blockId: target.blockId,
		annotationHash: target.annotationHash,
		text: target.unitText,
		synthesisText,
		speakerRef: target.speakerRef,
		voiceCardId: target.voiceCard.id,
		voiceCardFileHash: target.voiceCard.fileHash,
		voiceCardText: target.voiceCard.text,
		instruction,
		speed: target.speed,
		pronunciations: target.pronunciations,
		...(target.providerOverride ? { providerOverride: target.providerOverride } : {}),
		textPrompt,
		audio: provider.audio,
	};
	const synthesisHash = hashJson(synthesisSpec);
	return {
		instruction,
		synthesisText,
		textPrompt,
		synthesisSpec,
		synthesisHash,
		rawPath: join(OUTPUT_DIRECTORY, 'fragments', `${synthesisHash}.source.wav`),
		outputPath: join(OUTPUT_DIRECTORY, 'fragments', `${synthesisHash}.wav`),
	};
}

async function renderTarget({ target, provider, client, allowSubtitleMismatch }) {
	const {
		instruction, synthesisText, textPrompt, synthesisHash, rawPath, outputPath,
	} = synthesisPlanFor(target, provider);
	const voiceCardPath = resolve(PROJECT_ROOT, target.voiceCard.cachePath);
	if (!await pathExists(voiceCardPath)) {
		throw new Error(`${target.targetId} 的参考音色卡不存在：${target.voiceCard.cachePath}`);
	}
	const actualVoiceCardHash = await sha256File(voiceCardPath);
	if (actualVoiceCardHash !== target.voiceCard.fileHash) {
		throw new Error(`${target.targetId} 的参考音色卡哈希已变化，拒绝使用过期计划。`);
	}
	const request = {
		model: provider.audioGenerationApi.model,
		text_prompt: textPrompt,
		references: [{ audio_data: (await readFile(voiceCardPath)).toString('base64') }],
		audio_config: {
			format: provider.audio.format,
			sample_rate: provider.audio.sampleRate,
			speech_rate: 0,
			loudness_rate: 0,
			pitch_rate: 0,
			enable_subtitle: true,
		},
	};
	let artifact = await cachedArtifact(outputPath, synthesisHash);
	if (artifact) {
		if (artifact.subtitleExact === false && !allowSubtitleMismatch) {
			throw new Error(`${target.targetId} 的缓存豆包字幕与合成文本不一致：${artifact.subtitleText}`);
		}
		return { ...artifact, pathAbsolute: outputPath, cached: true };
	}

	console.log(`豆包生成 ${target.targetId}（${target.speakerRef} / ${target.voiceCard.id} 参考卡）...`);
	const result = await client.synthesize(request);
	await writeBufferAtomic(rawPath, result.audio);
	await normalizeWav(rawPath, outputPath, provider.audio);
	const [fileHash, sourceFileHash, info] = await Promise.all([
		sha256File(outputPath), sha256File(rawPath), inspectAudio(outputPath),
	]);
	const subtitleText = result.subtitle?.text || longestSentenceText(result.subtitle?.sentences || []);
	const subtitleExact = subtitleText === undefined ? null
		: normalizeTranscript(subtitleText) === normalizeTranscript(synthesisText);
	artifact = {
		version: 1,
		provider: 'doubao',
		apiKind: provider.audioGenerationApi.kind,
		model: provider.audioGenerationApi.model,
		synthesisHash,
		targetId: target.targetId,
		blockId: target.blockId,
		unitIndex: target.unitIndex,
		text: target.unitText,
		synthesisText,
		annotationHash: target.annotationHash,
		speakerRef: target.speakerRef,
		voiceCardId: target.voiceCard.id,
		voiceCardPath: target.voiceCard.cachePath,
		voiceCardFileHash: target.voiceCard.fileHash,
		instruction,
		speed: target.speed,
		pronunciations: target.pronunciations,
		providerOverride: target.providerOverride,
		requestId: result.requestId,
		logId: result.logId,
		attempt: result.attempt,
		providerDurationSeconds: result.durationSeconds,
		providerOriginalDurationSeconds: result.originalDurationSeconds,
		subtitleText,
		subtitleExact,
		sourcePath: rawPath.slice(PROJECT_ROOT.length + 1).replaceAll('\\', '/'),
		sourceFileHash,
		path: outputPath.slice(PROJECT_ROOT.length + 1).replaceAll('\\', '/'),
		fileHash,
		...info,
		generatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(`${outputPath}.json`, artifact);
	if (subtitleExact === false && !allowSubtitleMismatch) {
		throw new Error(`${target.targetId} 的豆包字幕与合成文本不一致：${subtitleText}`);
	}
	return { ...artifact, pathAbsolute: outputPath, cached: false };
}

async function assembleDemo(artifacts, provider) {
	const silencePath = join(OUTPUT_DIRECTORY, `silence-${provider.demo.pauseAfterMs}ms.wav`);
	if (!await pathExists(silencePath)) {
		await runFfmpeg([
			'-f', 'lavfi', '-i', `anullsrc=r=${provider.audio.sampleRate}:cl=mono`,
			'-t', String(provider.demo.pauseAfterMs / 1000), '-c:a', 'pcm_s16le', toWslPath(silencePath),
		]);
	}
	const concatPath = join(OUTPUT_DIRECTORY, 'concat.txt');
	const concatLines = [];
	for (let index = 0; index < artifacts.length; index += 1) {
		const fragmentPath = toWslPath(artifacts[index].pathAbsolute).replaceAll("'", "'\\''");
		concatLines.push(`file '${fragmentPath}'`);
		if (index < artifacts.length - 1) {
			concatLines.push(`file '${toWslPath(silencePath).replaceAll("'", "'\\''")}'`);
		}
	}
	await writeTextAtomic(concatPath, `${concatLines.join('\n')}\n`);
	const wavPath = join(OUTPUT_DIRECTORY, 'doubao-seed-audio-three-opera-demo.wav');
	const wavTemporary = `${wavPath}.${process.pid}.tmp.wav`;
	const premasterPath = `${wavPath}.${process.pid}.premaster.wav`;
	const mp3Path = join(OUTPUT_DIRECTORY, 'doubao-seed-audio-three-opera-demo.mp3');
	const mp3Temporary = `${mp3Path}.${process.pid}.tmp.mp3`;
	try {
		await runFfmpeg([
			'-f', 'concat', '-safe', '0', '-i', toWslPath(concatPath),
			'-ac', String(provider.audio.channels), '-ar', String(provider.audio.sampleRate),
			'-c:a', 'pcm_s16le', toWslPath(premasterPath),
		]);
		const firstPass = await analyzeLoudness(premasterPath, provider.demo.master);
		await runFfmpeg([
			'-i', toWslPath(premasterPath),
			'-af', secondPassLoudnormFilter(firstPass, provider.demo.master),
			'-ac', String(provider.audio.channels), '-ar', String(provider.audio.sampleRate),
			'-c:a', 'pcm_s16le', toWslPath(wavTemporary),
		]);
		await runFfmpeg([
			'-i', toWslPath(wavTemporary), '-c:a', 'libmp3lame',
			'-b:a', `${provider.demo.mp3BitrateKbps}k`, toWslPath(mp3Temporary),
		]);
		await Promise.all([fullDecode(wavTemporary), fullDecode(mp3Temporary)]);
		const [wavFileHash, mp3FileHash, wavInfo, mp3Info, finalMeasurement] = await Promise.all([
			sha256File(wavTemporary),
			sha256File(mp3Temporary),
			inspectAudio(wavTemporary),
			inspectAudio(mp3Temporary),
			analyzeLoudness(wavTemporary, provider.demo.master),
		]);
		await replaceFileAtomic(wavTemporary, wavPath);
		await replaceFileAtomic(mp3Temporary, mp3Path);
		return {
			wav: { path: wavPath, fileHash: wavFileHash, ...wavInfo },
			mp3: { path: mp3Path, fileHash: mp3FileHash, ...mp3Info },
			loudness: {
				targetLufs: provider.demo.master.targetLufs,
				integratedLufs: Number(finalMeasurement.input_i),
				truePeakDbfs: Number(finalMeasurement.input_tp),
				loudnessRangeLufs: Number(finalMeasurement.input_lra),
			},
		};
	} finally {
		await Promise.all([
			rm(premasterPath, { force: true }),
			rm(wavTemporary, { force: true }),
			rm(mp3Temporary, { force: true }),
		]);
	}
}

async function main() {
	const args = runArguments();
	const [provider, scenePlan, annotationDocument] = await Promise.all([
		JSON.parse(await readFile(PROVIDER_CONFIG_PATH, 'utf8')),
		JSON.parse(await readFile(SCENE_PLAN_PATH, 'utf8')),
		JSON.parse(await readFile(join(PROJECT_ROOT, 'content', 'audio', 'annotations', '081.json'), 'utf8')),
	]);
	if (scenePlan.chapter !== provider.demo.chapter || scenePlan.scene !== provider.demo.scene) {
		throw new Error(`场景计划与豆包配置不一致：${scenePlan.chapter}/${scenePlan.scene}。`);
	}
	if (scenePlan.planOnly !== true || scenePlan.noSynthesisPerformed !== true) {
		throw new Error('豆包 Demo 必须从只读场景计划生成，拒绝使用来源不明的计划。');
	}
	const byId = new Map(scenePlan.dialogueUnits.map((unit) => [unit.targetId, unit]));
	const configuredTargetIds = provider.demo.targetMode === 'all-dialogue-units'
		? scenePlan.dialogueUnits.map((unit) => unit.targetId)
		: provider.demo.targetIds;
	if (!Array.isArray(configuredTargetIds) || configuredTargetIds.length === 0) {
		throw new Error('豆包录制配置没有有效目标。');
	}
	const targets = configuredTargetIds.map((targetId) => {
		const unit = byId.get(targetId);
		if (!unit) throw new Error(`当前场景计划中找不到 Demo 目标 ${targetId}。`);
		if (!unit.text || !unit.speakerRef || !unit.annotationHash) {
			throw new Error(`Demo 目标 ${targetId} 缺少正文、人物或 annotationHash。`);
		}
		const voiceCard = scenePlan.voiceCards?.[unit.voiceCardId];
		if (!voiceCard?.path || !voiceCard?.fileHash || !voiceCard?.text) {
			throw new Error(`角色 ${unit.speakerRef} 缺少可追溯的参考音色卡。`);
		}
		return {
			targetId: unit.targetId,
			blockId: unit.blockId,
			unitIndex: unit.unitIndex,
			unitText: unit.text,
			synthesisText: unit.synthesisText,
			speakerRef: unit.speakerRef,
			annotationHash: unit.annotationHash,
			instruction: unit.instruction,
			speed: unit.speed,
			pronunciations: unit.pronunciations,
			providerOverride: provider.demo.targetOverrides?.[targetId] || null,
			voiceCard: {
				id: unit.voiceCardId,
				cachePath: voiceCard.path,
				fileHash: voiceCard.fileHash,
				text: voiceCard.text,
			},
		};
	});
	const sourceScenePlanHash = hashJson({
		planVersion: scenePlan.planVersion,
		dialogueSplitterVersion: scenePlan.dialogueSplitterVersion,
		chapter: scenePlan.chapter,
		scene: scenePlan.scene,
		counts: {
			semanticBlocks: scenePlan.counts.semanticBlocks,
			narrationBlocks: scenePlan.counts.narrationBlocks,
			dialogueUnits: scenePlan.counts.dialogueUnits,
		},
		voiceCards: scenePlan.voiceCards,
		narration: scenePlan.narration.map(({ cached: omitted, ...item }) => item),
		dialogueUnits: scenePlan.dialogueUnits.map(({ cached: omitted, ...item }) => item),
	});
	const planBasis = {
		version: 1,
		provider: provider.provider,
		sectionId: provider.demo.sectionId,
		api: provider.audioGenerationApi,
		audio: provider.audio,
		assembly: {
			pauseAfterMs: provider.demo.pauseAfterMs,
			mp3BitrateKbps: provider.demo.mp3BitrateKbps,
			master: provider.demo.master,
		},
		chapter: provider.demo.chapter,
		scene: provider.demo.scene,
		sourceScenePlanHash,
		sourcePlanVersion: scenePlan.planVersion,
		dialogueSplitterVersion: scenePlan.dialogueSplitterVersion,
		targets: targets.map((target) => ({
			targetId: target.targetId,
			blockId: target.blockId,
			unitIndex: target.unitIndex,
			text: target.unitText,
			synthesisText: target.synthesisText,
			speakerRef: target.speakerRef,
			voiceCard: target.voiceCard,
			annotationHash: target.annotationHash,
			instruction: instructionFor(target),
			speed: target.speed,
			pronunciations: target.pronunciations,
			providerOverride: target.providerOverride,
		})),
	};
	const targetCache = [];
	const validatedVoiceCards = new Map();
	for (const target of targets) {
		const voiceCardPath = resolve(PROJECT_ROOT, target.voiceCard.cachePath);
		if (!await pathExists(voiceCardPath)) {
			throw new Error(`${target.targetId} 的参考音色卡不存在：${target.voiceCard.cachePath}`);
		}
		let actualVoiceCardHash = validatedVoiceCards.get(voiceCardPath);
		if (!actualVoiceCardHash) {
			actualVoiceCardHash = await sha256File(voiceCardPath);
			validatedVoiceCards.set(voiceCardPath, actualVoiceCardHash);
		}
		if (actualVoiceCardHash !== target.voiceCard.fileHash) {
			throw new Error(`${target.targetId} 的参考音色卡哈希已变化，拒绝使用过期计划。`);
		}
		const synthesisPlan = synthesisPlanFor(target, provider);
		const cached = Boolean(await cachedArtifact(synthesisPlan.outputPath, synthesisPlan.synthesisHash));
		targetCache.push({
			targetId: target.targetId,
			synthesisHash: synthesisPlan.synthesisHash,
			cached,
		});
	}
	const plan = {
		...planBasis,
		planHash: hashJson(planBasis),
		cachePreview: {
			hits: targetCache.filter((item) => item.cached).length,
			misses: targetCache.filter((item) => !item.cached).length,
			targets: targetCache,
		},
	};
	await writeJsonAtomic(join(OUTPUT_DIRECTORY, 'demo-plan.json'), plan);
	if (args.dryRun) {
		console.log(`豆包 Demo 计划已生成：${join(OUTPUT_DIRECTORY, 'demo-plan.json')}`);
		console.log(`目标片段：${targets.length}；缓存 ${plan.cachePreview.hits}/${targets.length}；未调用豆包 API。`);
		return;
	}
	const credentials = await loadDoubaoCredentials(PROJECT_ROOT);
	const client = new DoubaoAudioGenerationClient({
		apiKey: credentials.apiKey,
		endpoint: provider.audioGenerationApi.endpoint,
	});
	const artifacts = [];
	for (const target of targets) {
		artifacts.push(await renderTarget({
			target,
			provider,
			client,
			allowSubtitleMismatch: args.allowSubtitleMismatch,
		}));
	}
	const whisper = await runWhisperValidation(artifacts);
	const outputs = await assembleDemo(artifacts, provider);
	const demoManifest = {
		...plan,
		fragments: artifacts.map(({ pathAbsolute: omitted, ...artifact }) => artifact),
		outputs: {
			wav: { ...outputs.wav, path: outputs.wav.path.slice(PROJECT_ROOT.length + 1).replaceAll('\\', '/') },
			mp3: { ...outputs.mp3, path: outputs.mp3.path.slice(PROJECT_ROOT.length + 1).replaceAll('\\', '/') },
			loudness: outputs.loudness,
		},
		whisper: {
			path: 'whisper-validation.json',
			model: whisper.model,
			device: whisper.device,
			counts: whisper.counts,
			cacheHits: whisper.cacheHits,
			transcriptions: whisper.transcriptions,
			structuralPass: whisper.selectionReview.structuralPass,
			needsReview: whisper.selectionReview.needsReview,
		},
		generatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(join(OUTPUT_DIRECTORY, 'demo-manifest.json'), demoManifest);
	const reviewSource = createDoubaoDemoReviewSource({
		scenePlan,
		demoManifest,
		whisperValidation: whisper,
		annotationDocument,
	});
	await writeJsonAtomic(
		join(PROJECT_ROOT, 'content', 'audio', '.cache', 'drama', provider.demo.chapter, provider.demo.scene, 'review-source.json'),
		reviewSource,
	);
	await rm(join(OUTPUT_DIRECTORY, 'concat.txt'), { force: true });
	console.log(`WAV：${outputs.wav.path}`);
	console.log(`MP3：${outputs.mp3.path}`);
}

main().catch((error) => {
	console.error(`\n[豆包 Demo 错误] ${error instanceof Error ? error.message : String(error)}`);
	process.exitCode = 1;
});
