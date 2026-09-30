#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { hashJson, sha256, voiceAnnotationHash } from './audio-blocks.js';
import { DoubaoAudioGenerationClient, loadDoubaoCredentials, writeBufferAtomic } from './doubao-client.js';
import {
	pathExists,
	readJsonIfExists,
	replaceFileAtomic,
	sha256File,
	writeJsonAtomic,
	writeTextAtomic,
} from './files.js';
import {
	applyPronunciationOverrides,
	buildCosyVoiceInstruction,
	passesWhisperStructuralReview,
	pauseAfterSynthesisUnit,
	splitChineseDialogue,
	splitChineseDialogueWithDelivery,
} from './scene-plan.js';
import { createTtsProvider } from './tts/provider.js';

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PROVIDER_CONFIG_PATH = join(PROJECT_ROOT, 'content', 'audio', 'providers', 'doubao.json');
const CHAPTER_ID = '081';
const PENDING_MAP_PATH = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'pending', `${CHAPTER_ID}.json`);
const ANNOTATION_PATH = join(PROJECT_ROOT, 'content', 'audio', 'annotations', `${CHAPTER_ID}.json`);
const SCENE_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'drama', CHAPTER_ID, 'xiren-three-opera');
const SCENE_PLAN_PATH = join(SCENE_DIRECTORY, 'scene-plan.json');
const DEMO_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'doubao', 'demos', CHAPTER_ID, 'xiren-three-opera');
const OUTPUT_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'doubao', 'chapters', CHAPTER_ID);
const PRODUCTION_STATUS_PATH = join(PROJECT_ROOT, 'content', 'audio', 'production', 'chapters', CHAPTER_ID, 'doubao-chapter-demo.json');
const WSL_DISTRIBUTION = 'Ubuntu-22.04';
const COSYVOICE_PYTHON = '/opt/miniconda3/envs/cosyvoice/bin/python';

function projectRelative(path) {
	return relative(PROJECT_ROOT, path).replaceAll('\\', '/');
}

function normalizeTranscript(text) {
	return String(text || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

function toWslPath(path) {
	const normalized = resolve(path).replaceAll('\\', '/');
	const match = /^([A-Za-z]):\/(.*)$/u.exec(normalized);
	if (!match) return normalized;
	return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function parseArguments() {
	const args = process.argv.slice(2);
	const concurrencyArg = args.find((value) => value.startsWith('--concurrency='));
	return {
		dryRun: args.includes('--dry-run'),
		skipWhisper: args.includes('--skip-whisper'),
		allowSubtitleMismatch: args.includes('--allow-subtitle-mismatch'),
		concurrency: concurrencyArg ? Number(concurrencyArg.split('=')[1]) : undefined,
	};
}

async function runFfmpeg(args) {
	try {
		return await execFileAsync('wsl.exe', [
			'-d', WSL_DISTRIBUTION, '--', 'ffmpeg', '-hide_banner', '-loglevel', 'error', '-y', ...args,
		], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`FFmpeg 处理失败：${error.stderr || error.message}`, { cause: error });
	}
}

async function normalizeWav(sourcePath, destinationPath, audio) {
	await mkdir(dirname(destinationPath), { recursive: true });
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
		], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
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

function collectSubtitleTexts(value, output = []) {
	if (typeof value === 'string') output.push(value);
	else if (Array.isArray(value)) value.forEach((item) => collectSubtitleTexts(item, output));
	else if (value && typeof value === 'object') {
		if (typeof value.text === 'string') output.push(value.text);
		else Object.values(value).forEach((item) => collectSubtitleTexts(item, output));
	}
	return output;
}

function subtitleText(value) {
	return collectSubtitleTexts(value)
		.filter(Boolean)
		.sort((left, right) => [...right].length - [...left].length)[0] || '';
}

function instructionFor(target) {
	const semantic = buildCosyVoiceInstruction(target.annotation)
		.replace(/<\|endofprompt\|>/gu, '')
		.replace(/[。；;\s]+$/gu, '');
	const role = target.kind === 'dialogue'
		? '以人物身份自然说话，不读角色名、引号或舞台说明'
		: target.kind === 'poetry'
			? '以古典章回小说的诗词旁白口吻，保留诗句层次，含蓄而清楚'
			: '以沉稳、含蓄、连贯的古典小说旁白口吻，不用新闻播报腔';
	const suffix = String(target.providerOverride?.instructionSuffix || '')
		.replace(/<\|endofprompt\|>/gu, '')
		.replace(/[。；;\s]+$/gu, '');
	return `请${role}；${semantic}${suffix ? `；${suffix}` : ''}；只朗读给定正文，不增加、删减或改写字词。`;
}

function referencePathFor(chapterConfig, speakerRef) {
	const key = speakerRef === '$narrator' ? 'narrator' : speakerRef;
	const override = chapterConfig.referenceOverrides?.[speakerRef]
		|| chapterConfig.referenceOverrides?.[key];
	if (override) return { ...override, speakerRef };
	return {
		id: `legacy-edge:${key}`,
		path: `${chapterConfig.legacyReferenceDirectory}/${key}.mp3`,
		speakerRef,
	};
}

async function prepareReference(reference, provider, cache) {
	const cacheKey = `${reference.id}:${reference.path}`;
	if (cache.has(cacheKey)) return cache.get(cacheKey);
	const sourcePath = resolve(PROJECT_ROOT, ...reference.path.split('/'));
	if (!await pathExists(sourcePath)) throw new Error(`缺少 ${reference.speakerRef} 的参考音频：${reference.path}`);
	const sourceFileHash = await sha256File(sourcePath);
	let audioPath = sourcePath;
	if (extname(sourcePath).toLowerCase() !== '.wav') {
		audioPath = join(OUTPUT_DIRECTORY, 'references', `${sourceFileHash}.wav`);
		if (!await pathExists(audioPath)) {
			await normalizeWav(sourcePath, audioPath, { ...provider.audio, targetLufs: -21, truePeakDbfs: -3 });
		}
	}
	const prepared = {
		id: reference.id,
		speakerRef: reference.speakerRef,
		path: projectRelative(audioPath),
		fileHash: await sha256File(audioPath),
		sourcePath: reference.path,
		sourceFileHash,
		...(reference.text ? { text: reference.text } : {}),
	};
	cache.set(cacheKey, prepared);
	return prepared;
}

function unitsForBlock(block, annotation, config) {
	if (block.kind === 'dialogue') {
		return splitChineseDialogueWithDelivery(block.text, annotation.delivery, config.maxDialogueChars);
	}
	if ([...block.text].length > config.maxNarrationChars) {
		return splitChineseDialogue(block.text, config.maxNarrationChars).map((text) => ({ text }));
	}
	return [{ text: block.text }];
}

function pauseBetween(current, next, config) {
	if (!next || current.part !== next.part) return 0;
	if (current.blockId === next.blockId) {
		return Math.max(config.pause.withinBlockMs, pauseAfterSynthesisUnit(current.text));
	}
	if (current.kind === 'poetry') return config.pause.afterPoetryMs;
	if (current.kind !== 'dialogue' && next.kind === 'dialogue') return config.pause.narrationToDialogueMs;
	if (current.kind === 'dialogue' && next.kind !== 'dialogue') return config.pause.dialogueToNarrationMs;
	return config.pause.betweenBlocksMs;
}

async function buildPlan({ provider, pendingMap, annotations, scenePlan }) {
	const chapterConfig = provider.chapterDemo;
	const splitIndex = pendingMap.blocks.findIndex((block) => block.blockId === chapterConfig.splitAfterBlockId);
	if (splitIndex < 0) throw new Error(`找不到分段锚点 ${chapterConfig.splitAfterBlockId}。`);
	const sceneUnits = new Map((scenePlan?.dialogueUnits || []).map((unit) => [unit.targetId, unit]));
	const referenceCache = new Map();
	const targets = [];
	for (let blockIndex = 0; blockIndex < pendingMap.blocks.length; blockIndex += 1) {
		const block = pendingMap.blocks[blockIndex];
		const annotation = annotations.annotations?.[block.blockId];
		if (!annotation || annotation.textHash !== block.textHash || annotation.contextHash !== block.contextHash) {
			throw new Error(`语音块 ${block.blockId} 的标注与当前正文不一致。`);
		}
		const annotationHash = voiceAnnotationHash(annotation);
		const units = unitsForBlock(block, annotation, chapterConfig);
		for (let unitIndex = 0; unitIndex < units.length; unitIndex += 1) {
			const unit = units[unitIndex];
			const targetId = `${block.kind}:${block.blockId}:u${String(unitIndex + 1).padStart(2, '0')}`;
			const existingSceneUnit = sceneUnits.get(targetId);
			let referenceInput;
			if (existingSceneUnit?.annotationHash === annotationHash) {
				const card = scenePlan.voiceCards?.[existingSceneUnit.voiceCardId];
				if (card) {
					referenceInput = {
						id: existingSceneUnit.voiceCardId,
						path: card.path,
						text: card.text,
						speakerRef: annotation.speakerRef,
					};
				}
			}
			if (!referenceInput) referenceInput = referencePathFor(chapterConfig, annotation.speakerRef);
			const reference = await prepareReference(referenceInput, provider, referenceCache);
			const providerOverride = chapterConfig.targetOverrides?.[targetId]
				|| provider.demo?.targetOverrides?.[targetId] || null;
			const annotatedSynthesisText = applyPronunciationOverrides(unit.text, annotation.pronunciations);
			const synthesisText = providerOverride?.synthesisTextOverride || annotatedSynthesisText;
			if (normalizeTranscript(synthesisText) !== normalizeTranscript(annotatedSynthesisText)) {
				throw new Error(`${targetId} 的 synthesisTextOverride 改变了可朗读正文。`);
			}
			const target = {
				targetId,
				order: targets.length + 1,
				part: blockIndex <= splitIndex ? 1 : 2,
				blockOrder: block.order,
				blockId: block.blockId,
				unitIndex,
				kind: block.kind,
				text: unit.text,
				synthesisText,
				textHash: sha256(unit.text),
				speakerRef: annotation.speakerRef,
				annotation,
				annotationHash,
				reference,
				providerOverride,
			};
			target.instruction = instructionFor(target);
			targets.push(target);
		}
	}
	for (let index = 0; index < targets.length; index += 1) {
		targets[index].pauseAfterMs = pauseBetween(targets[index], targets[index + 1], chapterConfig);
	}
	const source = {
		path: pendingMap.source,
		fileHash: pendingMap.sourceFileHash,
	};
	const stable = {
		version: 1,
		sectionId: chapterConfig.sectionId,
		renderVersion: chapterConfig.renderVersion,
		chapter: CHAPTER_ID,
		provider: provider.provider,
		api: provider.audioGenerationApi,
		audio: provider.audio,
		source,
		annotationSetHash: annotations.annotationSetHash || hashJson(annotations.annotations),
		splitAfterBlockId: chapterConfig.splitAfterBlockId,
		counts: {
			blocks: pendingMap.blocks.length,
			targets: targets.length,
			part1: targets.filter((target) => target.part === 1).length,
			part2: targets.filter((target) => target.part === 2).length,
		},
		references: [...new Map(targets.map((target) => [target.reference.id, target.reference])).values()],
		targets: targets.map(({ annotation: omitted, ...target }) => target),
	};
	return { ...stable, planHash: hashJson(stable), targets };
}

function synthesisPlanFor(target, provider) {
	const textPrompt = target.providerOverride?.promptMode === 'strict-text'
		? `请参考@音频1的说话人音色。必须直接朗读双引号内正文，正文前后保持静音，不说提示语，不加语气词，不续写。正文：“${target.synthesisText}”`
		: `请参考@音频1的说话人身份和音色，${target.instruction}正文：“${target.synthesisText}”`;
	const spec = {
		version: provider.chapterDemo.renderVersion,
		provider: provider.provider,
		model: provider.audioGenerationApi.model,
		targetId: target.targetId,
		blockId: target.blockId,
		unitIndex: target.unitIndex,
		kind: target.kind,
		text: target.text,
		synthesisText: target.synthesisText,
		speakerRef: target.speakerRef,
		annotationHash: target.annotationHash,
		referenceId: target.reference.id,
		referenceFileHash: target.reference.fileHash,
		instruction: target.instruction,
		providerOverride: target.providerOverride,
		textPrompt,
		audio: provider.audio,
	};
	const synthesisHash = hashJson(spec);
	return {
		spec,
		textPrompt,
		synthesisHash,
		rawPath: join(OUTPUT_DIRECTORY, 'fragments', `${synthesisHash}.source.wav`),
		outputPath: join(OUTPUT_DIRECTORY, 'fragments', `${synthesisHash}.wav`),
	};
}

async function cachedArtifact(path, synthesisHash) {
	const metadata = await readJsonIfExists(`${path}.json`);
	if (!metadata || metadata.synthesisHash !== synthesisHash || !await pathExists(path)) return undefined;
	if (metadata.fileHash !== await sha256File(path)) return undefined;
	return metadata;
}

async function reusableDemoArtifacts(scenePlan, demoManifest, whisperValidation) {
	const result = new Map();
	const sceneUnits = new Map((scenePlan?.dialogueUnits || []).map((unit) => [unit.targetId, unit]));
	const whisper = new Map((whisperValidation?.selectionReview?.results || []).map((item) => [item.id, item]));
	for (const fragment of demoManifest?.fragments || []) {
		const unit = sceneUnits.get(fragment.targetId);
		const path = resolve(PROJECT_ROOT, ...String(fragment.path || '').split('/'));
		if (!unit || fragment.subtitleExact !== true || whisper.get(fragment.targetId)?.structuralPass !== true
			|| !await pathExists(path) || await sha256File(path) !== fragment.fileHash) continue;
		result.set(fragment.targetId, { fragment, unit, path });
	}
	return result;
}

async function renderTarget({
	target,
	provider,
	client,
	demoArtifacts,
	referenceAudio,
	fallbackProviders,
	allowSubtitleMismatch,
}) {
	const demo = demoArtifacts.get(target.targetId);
	if (demo
		&& demo.unit.annotationHash === target.annotationHash
		&& demo.unit.voiceCardId === target.reference.id
		&& demo.unit.voiceCardFileHash === target.reference.fileHash
		&& demo.unit.text === target.text
		&& (demo.unit.synthesisText || demo.unit.text) === target.synthesisText) {
		const inspected = await inspectAudio(demo.path);
		return {
			targetId: target.targetId,
			blockId: target.blockId,
			unitIndex: target.unitIndex,
			kind: target.kind,
			part: target.part,
			text: target.text,
			synthesisText: target.synthesisText,
			speakerRef: target.speakerRef,
			annotationHash: target.annotationHash,
			referenceId: target.reference.id,
			referenceFileHash: target.reference.fileHash,
			synthesisHash: demo.fragment.synthesisHash,
			fileHash: demo.fragment.fileHash,
			path: projectRelative(demo.path),
			pathAbsolute: demo.path,
			durationSeconds: inspected.durationSeconds,
			pauseAfterMs: target.pauseAfterMs,
			subtitleText: demo.fragment.subtitleText,
			subtitleExact: true,
			reusedFrom: 'xiren-three-opera-demo',
		};
	}

	const plan = synthesisPlanFor(target, provider);
	const cached = await cachedArtifact(plan.outputPath, plan.synthesisHash);
	if (cached) return { ...cached, pathAbsolute: plan.outputPath };
	if (target.providerOverride?.fallbackProvider === 'edge') {
		const voice = target.providerOverride.fallbackVoice || 'zh-CN-YunjianNeural';
		const providerKey = `edge:${voice}`;
		let edgeProvider = fallbackProviders.get(providerKey);
		if (!edgeProvider) {
			edgeProvider = await createTtsProvider('edge', { voice });
			fallbackProviders.set(providerKey, edgeProvider);
		}
		const sourcePath = join(OUTPUT_DIRECTORY, 'fragments', `${plan.synthesisHash}.source.mp3`);
		await edgeProvider.synthesizeToFile({ text: target.synthesisText, outputPath: sourcePath });
		await normalizeWav(sourcePath, plan.outputPath, provider.audio);
		const inspected = await inspectAudio(plan.outputPath);
		const artifact = {
			targetId: target.targetId,
			blockId: target.blockId,
			unitIndex: target.unitIndex,
			kind: target.kind,
			part: target.part,
			text: target.text,
			synthesisText: target.synthesisText,
			speakerRef: target.speakerRef,
			annotationHash: target.annotationHash,
			referenceId: providerKey,
			referenceFileHash: target.reference.fileHash,
			synthesisHash: plan.synthesisHash,
			fileHash: await sha256File(plan.outputPath),
			path: projectRelative(plan.outputPath),
			durationSeconds: inspected.durationSeconds,
			pauseAfterMs: target.pauseAfterMs,
			subtitleText: target.synthesisText,
			subtitleExact: true,
			provider: 'edge',
			voice,
			generatedAt: new Date().toISOString(),
		};
		await writeJsonAtomic(`${plan.outputPath}.json`, artifact);
		return { ...artifact, pathAbsolute: plan.outputPath };
	}
	const referencePath = resolve(PROJECT_ROOT, ...target.reference.path.split('/'));
	let audioData = referenceAudio.get(referencePath);
	if (!audioData) {
		audioData = (await readFile(referencePath)).toString('base64');
		referenceAudio.set(referencePath, audioData);
	}
	const response = await client.synthesize({
		model: provider.audioGenerationApi.model,
		text_prompt: plan.textPrompt,
		references: [{ audio_data: audioData }],
		audio_config: {
			format: provider.audio.format,
			sample_rate: provider.audio.sampleRate,
			speech_rate: 0,
			loudness_rate: 0,
			pitch_rate: 0,
			enable_subtitle: true,
		},
	});
	await writeBufferAtomic(plan.rawPath, response.audio);
	await normalizeWav(plan.rawPath, plan.outputPath, provider.audio);
	const transcript = subtitleText(response.subtitle);
	const exact = normalizeTranscript(transcript) === normalizeTranscript(target.synthesisText);
	if (!exact && !allowSubtitleMismatch) {
		throw new Error(`${target.targetId} 的豆包字幕与正文不一致：${JSON.stringify(transcript)}`);
	}
	const inspected = await inspectAudio(plan.outputPath);
	const artifact = {
		targetId: target.targetId,
		blockId: target.blockId,
		unitIndex: target.unitIndex,
		kind: target.kind,
		part: target.part,
		text: target.text,
		synthesisText: target.synthesisText,
		speakerRef: target.speakerRef,
		annotationHash: target.annotationHash,
		referenceId: target.reference.id,
		referenceFileHash: target.reference.fileHash,
		synthesisHash: plan.synthesisHash,
		fileHash: await sha256File(plan.outputPath),
		path: projectRelative(plan.outputPath),
		durationSeconds: inspected.durationSeconds,
		pauseAfterMs: target.pauseAfterMs,
		subtitleText: transcript,
		subtitleExact: exact,
		request: { requestId: response.requestId, logId: response.logId, attempt: response.attempt },
		usage: response.usage || null,
		generatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(`${plan.outputPath}.json`, artifact);
	return { ...artifact, pathAbsolute: plan.outputPath };
}

async function renderAll({ targets, provider, client, demoArtifacts, concurrency, allowSubtitleMismatch }) {
	const artifacts = new Array(targets.length);
	const referenceAudio = new Map();
	const fallbackProviders = new Map();
	let nextIndex = 0;
	let completed = 0;
	let fatal;
	async function worker() {
		while (!fatal) {
			const index = nextIndex;
			nextIndex += 1;
			if (index >= targets.length) return;
			const target = targets[index];
			try {
				artifacts[index] = await renderTarget({
					target,
					provider,
					client,
					demoArtifacts,
					referenceAudio,
					fallbackProviders,
					allowSubtitleMismatch,
				});
				completed += 1;
				const mode = artifacts[index].reusedFrom ? '复用场景' : artifacts[index].request ? '新生成' : '缓存';
				console.log(`[${completed}/${targets.length}] ${target.targetId}（${target.speakerRef}，${mode}）`);
			} catch (error) {
				fatal = error;
			}
		}
	}
	await Promise.all(Array.from({ length: concurrency }, () => worker()));
	if (fatal) throw fatal;
	return artifacts;
}

async function runWhisperValidation(artifacts) {
	const jobsPath = join(OUTPUT_DIRECTORY, 'whisper-jobs.json');
	const outputPath = join(OUTPUT_DIRECTORY, 'whisper-validation.json');
	const jobs = artifacts.map((artifact) => ({
		id: artifact.targetId,
		blockId: artifact.blockId,
		unitIndex: artifact.unitIndex,
		voiceCardId: artifact.referenceId,
		kind: artifact.kind,
		path: toWslPath(artifact.pathAbsolute),
		expectedText: artifact.synthesisText,
	}));
	await writeJsonAtomic(jobsPath, { version: 1, jobs });
	console.log(`Whisper small 正在检查 ${jobs.length} 个整章片段...`);
	let result;
	try {
		result = await execFileAsync('wsl.exe', [
			'-d', WSL_DISTRIBUTION, '--', COSYVOICE_PYTHON,
			toWslPath(join(PROJECT_ROOT, 'scripts', 'audio', 'whisper_validate.py')),
			'--jobs', toWslPath(jobsPath),
			'--output', toWslPath(outputPath),
			'--model', 'small',
			'--verbose',
		], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
	} catch (error) {
		throw new Error(`Whisper 检查失败：${error.stderr || error.message}`, { cause: error });
	}
	if (result.stdout?.trim()) console.log(result.stdout.trim());
	const validation = await readJsonIfExists(outputPath);
	if (!validation || validation.results?.length !== jobs.length) throw new Error('Whisper 检查结果缺失或数量不符。');
	validation.selectionReview = {
		version: 1,
		structuralPass: 0,
		needsReview: 0,
		results: validation.results.map((item) => ({
			id: item.id,
			characterSimilarity: item.characterSimilarity,
			lengthRatio: item.lengthRatio,
			rawStatus: item.status,
			structuralPass: passesWhisperStructuralReview(item),
		})),
		interpretation: 'Whisper small 只检查漏字、乱序、重复和异常拖尾；同音字误识不替代艺术判断。',
	};
	validation.selectionReview.structuralPass = validation.selectionReview.results.filter((item) => item.structuralPass).length;
	validation.selectionReview.needsReview = jobs.length - validation.selectionReview.structuralPass;
	await writeJsonAtomic(outputPath, validation);
	if (validation.selectionReview.needsReview > 0) {
		const failed = validation.selectionReview.results.filter((item) => !item.structuralPass).map((item) => item.id);
		throw new Error(`Whisper 结构检查有 ${failed.length} 条未通过：${failed.slice(0, 12).join('、')}${failed.length > 12 ? '……' : ''}`);
	}
	return validation;
}

function concatQuote(path) {
	return toWslPath(path).replaceAll("'", "'\\''");
}

async function silencePath(milliseconds, sampleRate) {
	const path = join(OUTPUT_DIRECTORY, 'silence', `${milliseconds}ms.wav`);
	if (!await pathExists(path)) {
		await mkdir(dirname(path), { recursive: true });
		await runFfmpeg([
			'-f', 'lavfi', '-i', `anullsrc=r=${sampleRate}:cl=mono`,
			'-t', (milliseconds / 1000).toFixed(3), '-c:a', 'pcm_s16le', toWslPath(path),
		]);
	}
	return path;
}

async function assemblePart(part, artifacts, provider) {
	const selected = artifacts.filter((artifact) => artifact.part === part);
	const concatPath = join(OUTPUT_DIRECTORY, `part-${part}-concat.txt`);
	const premasterPath = join(OUTPUT_DIRECTORY, `chapter-${CHAPTER_ID}-part-${part}-premaster.wav`);
	const wavPath = join(OUTPUT_DIRECTORY, `chapter-${CHAPTER_ID}-part-${part}-doubao-seed-audio.wav`);
	const mp3Path = join(OUTPUT_DIRECTORY, `chapter-${CHAPTER_ID}-part-${part}-doubao-seed-audio.mp3`);
	const lines = [];
	for (let index = 0; index < selected.length; index += 1) {
		const artifact = selected[index];
		lines.push(`file '${concatQuote(artifact.pathAbsolute)}'`);
		if (index < selected.length - 1 && artifact.pauseAfterMs > 0) {
			const silence = await silencePath(artifact.pauseAfterMs, provider.audio.sampleRate);
			lines.push(`file '${concatQuote(silence)}'`);
		}
	}
	await writeTextAtomic(concatPath, `${lines.join('\n')}\n`);
	await runFfmpeg([
		'-f', 'concat', '-safe', '0', '-i', toWslPath(concatPath),
		'-ac', String(provider.audio.channels), '-ar', String(provider.audio.sampleRate),
		'-c:a', 'pcm_s16le', toWslPath(premasterPath),
	]);
	const measurement = await analyzeLoudness(premasterPath, provider.chapterDemo.master);
	const filter = secondPassLoudnormFilter(measurement, provider.chapterDemo.master);
	const wavTemporary = `${wavPath}.${process.pid}.tmp.wav`;
	const mp3Temporary = `${mp3Path}.${process.pid}.tmp.mp3`;
	try {
		await runFfmpeg([
			'-i', toWslPath(premasterPath), '-af', filter,
			'-ac', String(provider.audio.channels), '-ar', String(provider.audio.sampleRate),
			'-c:a', 'pcm_s16le', toWslPath(wavTemporary),
		]);
		await runFfmpeg([
			'-i', toWslPath(wavTemporary),
			'-ac', String(provider.audio.channels), '-ar', String(provider.audio.sampleRate),
			'-c:a', 'libmp3lame',
			'-b:a', `${provider.chapterDemo.mp3BitrateKbps}k`, toWslPath(mp3Temporary),
		]);
		await replaceFileAtomic(wavTemporary, wavPath);
		await replaceFileAtomic(mp3Temporary, mp3Path);
		await Promise.all([fullDecode(wavPath), fullDecode(mp3Path)]);
		const [wavInfo, mp3Info, wavHash, mp3Hash, loudness] = await Promise.all([
			inspectAudio(wavPath), inspectAudio(mp3Path), sha256File(wavPath), sha256File(mp3Path),
			analyzeLoudness(wavPath, provider.chapterDemo.master),
		]);
		return {
			part,
			targets: selected.length,
			firstTargetId: selected[0].targetId,
			lastTargetId: selected.at(-1).targetId,
			wav: { path: projectRelative(wavPath), fileHash: wavHash, ...wavInfo },
			mp3: { path: projectRelative(mp3Path), fileHash: mp3Hash, ...mp3Info },
			loudness,
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
	const args = parseArguments();
	const [provider, pendingMap, annotations, scenePlan, demoManifest, demoWhisper] = await Promise.all([
		readJsonIfExists(PROVIDER_CONFIG_PATH),
		readJsonIfExists(PENDING_MAP_PATH),
		readJsonIfExists(ANNOTATION_PATH),
		readJsonIfExists(SCENE_PLAN_PATH),
		readJsonIfExists(join(DEMO_DIRECTORY, 'demo-manifest.json')),
		readJsonIfExists(join(DEMO_DIRECTORY, 'whisper-validation.json')),
	]);
	if (!provider?.chapterDemo || provider.chapterDemo.chapter !== CHAPTER_ID) throw new Error('缺少第81回豆包整章配置。');
	if (!pendingMap?.blocks || pendingMap.chapter !== CHAPTER_ID) throw new Error('缺少第81回当前正文分块计划。');
	if (!annotations?.annotations || annotations.chapter !== CHAPTER_ID) throw new Error('缺少第81回当前音频标注。');
	const sourcePath = resolve(PROJECT_ROOT, ...pendingMap.source.split('/'));
	if (!await pathExists(sourcePath) || await sha256File(sourcePath) !== pendingMap.sourceFileHash) {
		throw new Error('第81回正文已经变化，请先重新生成分块与标注计划。');
	}
	const plan = await buildPlan({ provider, pendingMap, annotations, scenePlan });
	await writeJsonAtomic(join(OUTPUT_DIRECTORY, 'chapter-plan.json'), {
		...plan,
		targets: plan.targets.map(({ annotation: omitted, ...target }) => target),
	});
	console.log(`第81回：${plan.counts.blocks} 个正文块，${plan.counts.targets} 个实际生成单元。`);
	console.log(`前半 ${plan.counts.part1} 单元，后半 ${plan.counts.part2} 单元；分界 ${provider.chapterDemo.splitAfterBlockId}。`);
	if (args.dryRun) {
		console.log(`整章计划：${join(OUTPUT_DIRECTORY, 'chapter-plan.json')}；未调用豆包 API。`);
		return;
	}
	const concurrency = args.concurrency ?? provider.chapterDemo.concurrency;
	if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4) throw new Error('并发数必须为 1 到 4。');
	const credentials = await loadDoubaoCredentials(PROJECT_ROOT);
	const client = new DoubaoAudioGenerationClient({
		apiKey: credentials.apiKey,
		endpoint: provider.audioGenerationApi.endpoint,
	});
	const demoArtifacts = await reusableDemoArtifacts(scenePlan, demoManifest, demoWhisper);
	console.log(`可直接复用三官场景片段 ${demoArtifacts.size} 个；其余按哈希缓存生成。`);
	const artifacts = await renderAll({
		targets: plan.targets,
		provider,
		client,
		demoArtifacts,
		concurrency,
		allowSubtitleMismatch: args.allowSubtitleMismatch,
	});
	const whisper = args.skipWhisper ? null : await runWhisperValidation(artifacts);
	const outputs = [];
	for (const part of [1, 2]) {
		console.log(`正在合成第81回第 ${part} 部分整轨...`);
		outputs.push(await assemblePart(part, artifacts, provider));
	}
	const reviewResults = new Map((whisper?.selectionReview?.results || []).map((item) => [item.id, item]));
	const approvedTargets = artifacts.map((artifact) => ({
		...Object.fromEntries(Object.entries(artifact).filter(([key]) => key !== 'pathAbsolute')),
		automaticCheck: {
			subtitleExact: artifact.subtitleExact,
			whisperStructuralPass: args.skipWhisper ? null : reviewResults.get(artifact.targetId)?.structuralPass === true,
		},
		approval: args.skipWhisper ? { status: 'pending_review', reason: 'Whisper 检查被显式跳过。' } : {
			status: 'approved',
			reviewer: 'project-owner',
			source: 'project-owner-default-policy',
			binding: {
				annotationHash: artifact.annotationHash,
				referenceId: artifact.referenceId,
				referenceFileHash: artifact.referenceFileHash,
				renderHash: artifact.synthesisHash,
				fileHash: artifact.fileHash,
			},
		},
	}));
	const generatedAt = new Date().toISOString();
	const manifest = {
		...Object.fromEntries(Object.entries(plan).filter(([key]) => key !== 'targets')),
		fragments: approvedTargets,
		whisper: whisper ? {
			path: projectRelative(join(OUTPUT_DIRECTORY, 'whisper-validation.json')),
			model: whisper.model,
			device: whisper.device,
			counts: whisper.counts,
			cacheHits: whisper.cacheHits,
			transcriptions: whisper.transcriptions,
			structuralPass: whisper.selectionReview.structuralPass,
			needsReview: whisper.selectionReview.needsReview,
		} : null,
		outputs,
		generatedAt,
	};
	await writeJsonAtomic(join(OUTPUT_DIRECTORY, 'chapter-manifest.json'), manifest);
	await writeJsonAtomic(PRODUCTION_STATUS_PATH, {
		version: 1,
		chapter: CHAPTER_ID,
		kind: 'doubao-full-chapter-demo',
		planHash: plan.planHash,
		status: args.skipWhisper ? 'pending_review' : 'approved',
		approvalPolicy: 'project-owner-default-policy',
		counts: {
			blocks: plan.counts.blocks,
			fragments: artifacts.length,
			approved: args.skipWhisper ? 0 : artifacts.length,
			pendingReview: args.skipWhisper ? artifacts.length : 0,
			rejected: 0,
		},
		outputs,
		manifest: projectRelative(join(OUTPUT_DIRECTORY, 'chapter-manifest.json')),
		generatedAt,
	});
	for (const output of outputs) {
		console.log(`第 ${output.part} 部分 MP3：${resolve(PROJECT_ROOT, ...output.mp3.path.split('/'))}`);
	}
}

main().catch((error) => {
	console.error(`\n[豆包整章错误] ${error instanceof Error ? error.message : String(error)}`);
	if (process.env.TTS_DEBUG === '1' && error instanceof Error) console.error(error.stack);
	process.exitCode = 1;
});
