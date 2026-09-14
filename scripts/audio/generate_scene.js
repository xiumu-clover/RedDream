#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { copyFile, mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import { chapterToAudioCandidates, hashJson, sha256 } from './audio-blocks.js';
import { normalizeLegacyNoteMarkers, stripFrontmatter } from './chapter-text.js';
import { pathExists, readJsonIfExists, sha256File, writeJsonAtomic } from './files.js';
import {
	CHARACTER_VOICE_IDS,
	DIALOGUE_SPLITTER_VERSION,
	SCENE_DEFINITIONS,
	SCENE_PLAN_VERSION,
	SCENE_RENDER_VERSION,
	SCENE_SAMPLE_RATE,
	applyPronunciationOverrides,
	alignSceneBlocks,
	buildCosyVoiceInstruction,
	chorusForBlock,
	computeSpeechLevelGain,
	cosyVoiceSpeed,
	extractSceneByAnchors,
	pauseAfterSynthesisUnit,
	passesWhisperStructuralReview,
	resolveSceneNarratorPlan,
	selectSceneVoiceCardId,
	sceneFragmentRenderHash,
	sceneOutputDirectory,
	scenePauseAfter,
	speechLevelTarget,
	splitChineseDialogueWithDelivery,
} from './scene-plan.js';
import { getValidCachedAudio } from './track.js';
import { createTtsProvider } from './tts/provider.js';
import { loadVoiceCardCatalog } from './voice-cards.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHAPTER_DIRECTORY = join(PROJECT_ROOT, 'content', 'chapters', 'guiyou');
const AUDIO_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio');
const CACHE_DIRECTORY = join(AUDIO_DIRECTORY, '.cache');
const WSL_DISTRIBUTION = 'Ubuntu-22.04';
const COSYVOICE_ROOT = '/opt/cosyvoice';
const COSYVOICE_PYTHON = '/opt/miniconda3/envs/cosyvoice/bin/python';
const COSYVOICE_MODEL = '/opt/cosyvoice/pretrained_models/CosyVoice2-0.5B';
const COSYVOICE_POLICY = {
	fp16: true,
	loadJit: true,
	speechTokenizerDevice: 'cpu',
	textFrontend: false,
	minTokenTextRatio: 2,
	maxTokenTextRatio: 12,
	jobTimeoutSeconds: 120,
	minInstructSpeakerSimilarity: 0.70,
	effectiveMethod: 'inference_zero_shot',
	fallbackFrom: 'inference_instruct2-timeout',
};
const INSTRUCT2_FALLBACK_REASON = 'inference_instruct2 两次预检均超过约 2 分钟且没有输出；改用 zero-shot，通过 speed、分句、标点和保守后处理近似情绪';
const EDGE_SYNTHESIS_VERSION = 'edge-scene-synthesis-v1';
const COSYVOICE_SYNTHESIS_VERSION = 'cosyvoice-scene-synthesis-v1';
const POSTPROCESS_VERSION = 'scene-loudness-v1';
const CHORUS_MIX_VERSION = 'single-annotation-primary-v1';
const SPEECH_EDGE_TRIM_VERSION = 'digital-silence-edge-trim-v1';
const FRAGMENT_LEVEL_VERSION = 'pcm-rms-fragment-level-v1';
const FINAL_MASTER_VERSION = 'scene-master-loudnorm-v1';
const COSYVOICE_RETRY_VERSIONS = new Map([
	// Whisper found a short unexpected tail in the first render. Including the
	// retry version in the render hash preserves that sample and creates a fresh
	// cache entry instead of overwriting evidence.
	['081-b0034:2:jia-baoyu:grieving-shock', 2],
	['081-b0040:1:dou-guan', 2],
	['081-b0042:3:xiren:assertive-rivalry', 1],
	['081-b0051:1:ai-guan', 1],
]);
function multistyleVoiceCardSource(speakerRef, styleId, version) {
	const directory = `content/audio/.cache/voice-cards/multistyle/${speakerRef}/${styleId}-v${version}`;
	return {
		speakerRef,
		styleId,
		path: `${directory}/voice-card-delivery.wav`,
		metadataPath: `${directory}/generation.json`,
		generationCardPath: `${directory}/voice-card.wav`,
		catalogCharacter: speakerRef,
		catalogStyle: styleId,
		readText: (metadata) => metadata.voiceCard?.text,
		readHash: (_metadata, catalogEntry) => catalogEntry?.deliveryWavSha256,
		readGenerationHash: (metadata) => metadata.voiceCard?.sha256,
		readEngine: (metadata) => ({
			name: metadata.engine,
			model: metadata.modelDir,
			version: basename(metadata.modelDir || ''),
		}),
		readGenerationParameters: (metadata) => ({
			speed: metadata.speed,
			seed: metadata.seed,
			minTokenTextRatio: metadata.minTokenTextRatio,
			maxTokenTextRatio: metadata.maxTokenTextRatio,
			fp16: metadata.fp16,
			loadJit: metadata.loadJit,
			textFrontend: metadata.textFrontend,
			speechTokenizerDevice: metadata.speechTokenizerDevice,
		}),
		sourceType: 'user-selected-multistyle-voice-card',
	};
}

const VOICE_CARD_SOURCES = {
	'jia-baoyu:anxious-indignant': multistyleVoiceCardSource('jia-baoyu', 'anxious-indignant', 1),
	'jia-baoyu:restrained-sadness': multistyleVoiceCardSource('jia-baoyu', 'restrained-sadness', 2),
	'jia-baoyu:grieving-shock': multistyleVoiceCardSource('jia-baoyu', 'grieving-shock', 2),
	'xiren:assertive-rivalry': multistyleVoiceCardSource('xiren', 'assertive-rivalry', 1),
	'ai-guan': {
		speakerRef: 'ai-guan',
		styleId: 'proxy-default',
		path: 'content/audio.cache/voice-cards/ai-guan/ai-guan-voice-card.wav',
		metadataPath: 'content/audio.cache/voice-cards/ai-guan/ai-guan-generation.json',
		readText: (metadata) => metadata.texts?.voiceCard,
		readHash: (metadata) => metadata.files?.voiceCardWav?.sha256,
		readEngine: (metadata) => ({
			name: metadata.engine?.name,
			model: metadata.engine?.model,
			version: basename(metadata.engine?.model || ''),
		}),
	},
	'dou-guan': {
		speakerRef: 'dou-guan',
		styleId: 'proxy-default',
		path: 'content/audio.cache/voice-cards/dou-guan/dou-guan-voice-card.wav',
		metadataPath: 'content/audio.cache/voice-cards/dou-guan/dou-guan-generation.json',
		readText: (metadata) => metadata.texts?.voiceCard,
		readHash: (metadata) => metadata.files?.voiceCardWav?.sha256,
		readEngine: (metadata) => ({
			name: metadata.engine?.name,
			model: metadata.engine?.model,
			version: basename(metadata.engine?.model || ''),
		}),
	},
	'kui-guan': {
		speakerRef: 'kui-guan',
		styleId: 'proxy-default',
		path: 'content/audio.cache/voice-cards/kui-guan/kui-guan-voice-card.wav',
		metadataPath: 'content/audio.cache/voice-cards/kui-guan/kui-guan-generation.json',
		readText: (metadata) => metadata.texts?.voiceCard,
		readHash: (metadata) => metadata.files?.voiceCardWav?.sha256,
		readEngine: (metadata) => ({
			name: metadata.engine?.name,
			model: metadata.engine?.model,
			version: basename(metadata.engine?.model || ''),
		}),
	},
};

function projectRelative(path) {
	return relative(PROJECT_ROOT, path).replaceAll('\\', '/');
}

function ensureSupportedNodeVersion() {
	const [major, minor] = process.versions.node.split('.').map(Number);
	if (major < 22 || (major === 22 && minor < 12)) {
		throw new Error(`当前 Node.js 为 ${process.versions.node}；本项目要求 Node.js 22.12.0 或更高版本。`);
	}
}

function parseArguments(argv) {
	const options = {};
	const booleanOptions = new Set(['plan-only', 'skip-whisper']);
	for (let index = 0; index < argv.length; index += 1) {
		const value = argv[index];
		if (!value.startsWith('--')) throw new Error(`无法识别参数 ${value}。`);
		const [rawName, inlineValue] = value.slice(2).split('=', 2);
		if (booleanOptions.has(rawName) && inlineValue === undefined) {
			options[rawName] = true;
			continue;
		}
		const argument = inlineValue ?? argv[++index];
		if (!argument || argument.startsWith('--')) throw new Error(`参数 --${rawName} 缺少值。`);
		options[rawName] = argument;
	}
	const chapter = String(options.chapter || '').padStart(3, '0');
	const scene = String(options.scene || '');
	if (!/^\d{3}$/u.test(chapter)) throw new Error('--chapter 必须是回目编号，例如 081。');
	if (!scene) throw new Error('--scene 不能为空。');
	return {
		chapter,
		scene,
		planOnly: options['plan-only'] === true || options['plan-only'] === 'true',
		skipWhisper: options['skip-whisper'] === true || options['skip-whisper'] === 'true',
	};
}

async function findChapterPath(chapterId) {
	const entries = await readdir(CHAPTER_DIRECTORY, { withFileTypes: true });
	const matches = entries.filter((entry) => entry.isFile()
		&& (entry.name === `${chapterId}.md` || entry.name.startsWith(`${chapterId}-`)));
	if (matches.length !== 1) {
		throw new Error(`第 ${chapterId} 回正文应唯一命中，实际命中 ${matches.length} 个文件。`);
	}
	return join(CHAPTER_DIRECTORY, matches[0].name);
}

function toWslPath(path) {
	if (path.startsWith('/')) return path;
	const absolute = resolve(path);
	const match = /^([A-Za-z]):[\\/](.*)$/u.exec(absolute);
	if (!match) throw new Error(`无法转换为 WSL 路径：${absolute}`);
	return `/mnt/${match[1].toLowerCase()}/${match[2].replaceAll('\\', '/')}`;
}

function runProcess(command, args, { echo = false, timeoutMs = 0 } = {}) {
	return new Promise((resolvePromise, reject) => {
		const child = spawn(command, args, {
			cwd: PROJECT_ROOT,
			windowsHide: true,
			stdio: ['ignore', 'pipe', 'pipe'],
		});
		let stdout = '';
		let stderr = '';
		let timer;
		if (timeoutMs > 0) {
			timer = setTimeout(() => child.kill(), timeoutMs);
		}
		child.stdout.on('data', (chunk) => {
			const value = chunk.toString('utf8');
			stdout += value;
			if (echo) process.stdout.write(value);
		});
		child.stderr.on('data', (chunk) => {
			const value = chunk.toString('utf8');
			stderr += value;
			if (echo) process.stderr.write(value);
		});
		child.on('error', reject);
		child.on('close', (code, signal) => {
			if (timer) clearTimeout(timer);
			if (code === 0) {
				resolvePromise({ stdout, stderr });
				return;
			}
			reject(new Error(
				`${command} 执行失败（exit ${code ?? 'null'}${signal ? `, ${signal}` : ''}）：`
				+ `${stderr.trim() || stdout.trim()}`,
			));
		});
	});
}

function runWsl(args, options) {
	return runProcess('wsl.exe', ['-d', WSL_DISTRIBUTION, '--', ...args], options);
}

async function replaceCompletedFile(temporaryPath, outputPath) {
	const backupPath = `${outputPath}.${process.pid}.${Date.now()}.previous`;
	let hadPrevious = false;
	try {
		try {
			await rename(outputPath, backupPath);
			hadPrevious = true;
		} catch (error) {
			if (error?.code !== 'ENOENT') throw error;
		}
		await rename(temporaryPath, outputPath);
	} catch (error) {
		await rm(outputPath, { force: true });
		if (hadPrevious) await rename(backupPath, outputPath);
		throw error;
	} finally {
		await rm(temporaryPath, { force: true });
	}
	if (hadPrevious) await rm(backupPath, { force: true });
}

async function copyFileAtomic(sourcePath, outputPath) {
	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		await copyFile(sourcePath, temporaryPath);
		await replaceCompletedFile(temporaryPath, outputPath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

async function inspectWithFfprobe(path) {
	const { stdout } = await runWsl([
		'ffprobe', '-v', 'error', '-select_streams', 'a:0',
		'-show_entries', 'stream=codec_name,sample_fmt,sample_rate,channels,bit_rate:format=duration,size,bit_rate',
		'-of', 'json', toWslPath(path),
	]);
	const parsed = JSON.parse(stdout);
	const stream = parsed.streams?.[0];
	if (!stream) throw new Error(`FFprobe 未在 ${path} 中找到音轨。`);
	return {
		codec: stream.codec_name,
		sampleFormat: stream.sample_fmt,
		sampleRate: Number(stream.sample_rate),
		channels: Number(stream.channels),
		bitRate: Number(stream.bit_rate || parsed.format?.bit_rate || 0),
		durationSeconds: Number(parsed.format?.duration),
		bytes: Number(parsed.format?.size),
	};
}

async function fullDecode(path) {
	await runWsl(['ffmpeg', '-nostdin', '-v', 'error', '-i', toWslPath(path), '-f', 'null', '-']);
}

async function inspectWavArtifact(path) {
	const [probe, fileHash] = await Promise.all([inspectWithFfprobe(path), sha256File(path)]);
	if (probe.sampleRate !== SCENE_SAMPLE_RATE || probe.channels !== 1 || !probe.codec?.startsWith('pcm_')) {
		throw new Error(`${projectRelative(path)} 不是 24 kHz 单声道 PCM WAV。`);
	}
	return { ...probe, fileHash };
}

async function getCachedWav(path, renderHash) {
	try {
		const metadata = await readJsonIfExists(`${path}.json`);
		if (metadata?.renderHash !== renderHash || !metadata.fileHash) return undefined;
		const result = await stat(path);
		if (result.size <= 44) return undefined;
		const actualHash = await sha256File(path);
		if (actualHash !== metadata.fileHash) return undefined;
		return metadata;
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		return undefined;
	}
}

async function renderFfmpegWav({ inputPath, outputPath, filter }) {
	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.wav`;
	try {
		const args = ['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', toWslPath(inputPath)];
		if (filter) args.push('-af', filter);
		args.push(
			'-ar', String(SCENE_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
			toWslPath(temporaryPath),
		);
		await runWsl(args);
		const result = await stat(temporaryPath);
		if (result.size <= 44) throw new Error('FFmpeg 生成了空 WAV。');
		await replaceCompletedFile(temporaryPath, outputPath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

function loudnessTarget(annotation, kind) {
	if (kind === 'narration') return -20.5;
	const energyOffset = { light: -1.2, medium: 0, heavy: 1.2 }[annotation.energy] || 0;
	return Number((-19.8 + energyOffset).toFixed(1));
}

function postprocessFilter(annotation, kind) {
	const target = loudnessTarget(annotation, kind);
	return {
		targetLufs: target,
		filter: `loudnorm=I=${target}:TP=-3:LRA=7`,
	};
}

async function loadAndValidateVoiceCards() {
	const cards = {};
	const multistyleCatalog = await readJsonIfExists(join(
		CACHE_DIRECTORY,
		'voice-cards',
		'multistyle',
		'catalog.json',
	));
	for (const [id, source] of Object.entries(VOICE_CARD_SOURCES)) {
		const path = join(PROJECT_ROOT, ...source.path.split('/'));
		const metadataPath = join(PROJECT_ROOT, ...source.metadataPath.split('/'));
		const metadata = await readJsonIfExists(metadataPath);
		if (!metadata) throw new Error(`找不到音色卡元数据 ${source.metadataPath}。`);
		const catalogEntry = source.catalogCharacter
			? multistyleCatalog?.characters?.[source.catalogCharacter]?.[source.catalogStyle]
			: undefined;
		if (source.catalogCharacter && !catalogEntry) {
			throw new Error(`本地多情绪音色卡目录缺少 ${source.catalogCharacter}/${source.catalogStyle}。`);
		}
		const text = source.readText(metadata);
		const expectedHash = String(source.readHash(metadata, catalogEntry) || '').toLowerCase();
		if (typeof text !== 'string' || !text.trim() || !/^[0-9a-f]{64}$/u.test(expectedHash)) {
			throw new Error(`音色卡 ${id} 的准确文本或 SHA-256 元数据无效。`);
		}
		if (source.generationCardPath) {
			const generationCardPath = join(PROJECT_ROOT, ...source.generationCardPath.split('/'));
			const generationHash = String(source.readGenerationHash(metadata) || '').toLowerCase();
			if (!/^[0-9a-f]{64}$/u.test(generationHash)) {
				throw new Error(`音色卡 ${id} 的 generation.json 未记录标准卡 SHA-256。`);
			}
			if (await sha256File(generationCardPath) !== generationHash) {
				throw new Error(`音色卡 ${source.generationCardPath} 的 SHA-256 与 generation.json 不一致。`);
			}
			if (catalogEntry.cardText !== text) {
				throw new Error(`音色卡 ${id} 的 catalog 文本与 generation.json 准确文本不一致。`);
			}
		}
		const result = await stat(path);
		if (!result.isFile() || result.size <= 44) throw new Error(`音色卡 ${source.path} 缺失或为空。`);
		const actualHash = await sha256File(path);
		if (actualHash !== expectedHash) {
			throw new Error(`音色卡 ${source.path} 的 SHA-256 与 generation JSON 不一致。`);
		}
		const probe = await inspectWithFfprobe(path);
		await fullDecode(path);
		if (probe.sampleRate !== SCENE_SAMPLE_RATE || probe.channels !== 1 || !probe.codec.startsWith('pcm_')) {
			throw new Error(`音色卡 ${source.path} 必须是 24 kHz 单声道可解码 WAV。`);
		}
		cards[id] = {
			id,
			speakerRef: source.speakerRef || id,
			styleId: source.styleId || 'default',
			path,
			pathRelative: source.path,
			metadataPath: source.metadataPath,
			text,
			fileHash: actualHash,
			bytes: result.size,
			format: probe,
			engine: source.readEngine(metadata),
			generationParameters: source.readGenerationParameters?.(metadata),
			sourceType: source.sourceType || metadata.sourceType || 'approved-voice-card',
			disclaimer: metadata.disclaimer,
		};
	}
	return cards;
}

function alignmentReport({ chapterId, sceneId, source, sourceFileHash, pendingMap, extracted, aligned }) {
	return {
		version: 1,
		planVersion: SCENE_PLAN_VERSION,
		chapter: chapterId,
		scene: sceneId,
		source,
		sourceFileHash,
		pendingSource: pendingMap.source,
		pendingSourceFileHash: pendingMap.sourceFileHash,
		anchors: {
			configuredStart: SCENE_DEFINITIONS[sceneId].startAnchor,
			configuredEnd: SCENE_DEFINITIONS[sceneId].endAnchor,
			actualStartText: extracted.actualStartText,
			actualEndText: extracted.actualEndText,
		},
		counts: {
			blocks: aligned.length,
			aligned: aligned.filter((block) => block.alignmentStatus === 'aligned').length,
			paused: aligned.filter((block) => block.alignmentStatus === 'paused').length,
		},
		blocks: aligned.map((block) => ({
			currentOrder: block.order,
			oldOrder: block.oldOrder,
			blockId: block.blockId,
			kind: block.kind,
			text: block.text,
			textHash: block.textHash,
			contextHash: block.contextHash,
			status: block.alignmentStatus,
			method: block.alignmentMethod,
			contextExact: block.contextExact,
			changeRatio: block.changeRatio,
			reason: block.alignmentReason,
			annotationTextHash: block.annotation?.textHash,
			annotationContextHash: block.annotation?.contextHash,
			speakerRef: block.annotation?.speakerRef,
		})),
		createdAt: new Date().toISOString(),
	};
}

function edgeRenderHash({ block, plan, narratorCard }) {
	return sceneFragmentRenderHash({
		textHash: block.textHash,
		annotationHash: block.annotationHash,
		voiceCardId: 'narrator',
		voiceCardFileHash: null,
		voiceCardText: null,
		provider: 'edge',
		modelVersion: plan.spec.voice,
		prosodyOrInstruction: {
			rate: plan.spec.rate,
			pitch: plan.spec.pitch,
			volume: plan.spec.volume,
			voiceCardConfigHash: hashJson(narratorCard),
		},
		renderParameters: {
			semantics: {
				emotion: block.annotation.emotion,
				pace: block.annotation.pace,
				pitch: block.annotation.pitch,
				energy: block.annotation.energy,
				timbre: block.annotation.timbre,
				modifiers: block.annotation.modifiers,
			},
			version: POSTPROCESS_VERSION,
			sampleRate: SCENE_SAMPLE_RATE,
			channels: 1,
			...postprocessFilter(block.annotation, block.kind),
		},
	});
}

function edgeSynthesisHash({ block, plan, narratorCard }) {
	return hashJson({
		version: EDGE_SYNTHESIS_VERSION,
		provider: 'edge',
		textHash: block.textHash,
		voice: plan.spec.voice,
		rate: plan.spec.rate,
		pitch: plan.spec.pitch,
		volume: plan.spec.volume,
		voiceCardConfigHash: hashJson(narratorCard),
	});
}

function cosySynthesisHash({ synthesisText, voiceCard, instruction, speed, retryVersion = 0 }) {
	return hashJson({
		version: COSYVOICE_SYNTHESIS_VERSION,
		provider: 'cosyvoice',
		modelVersion: voiceCard.engine,
		effectiveMethod: COSYVOICE_POLICY.effectiveMethod,
		synthesisTextHash: sha256(synthesisText),
		voiceCardId: voiceCard.id,
		voiceCardFileHash: voiceCard.fileHash,
		voiceCardText: voiceCard.text,
		voiceCardGenerationParameters: voiceCard.generationParameters,
		instruction,
		speed,
		minTokenTextRatio: COSYVOICE_POLICY.minTokenTextRatio,
		maxTokenTextRatio: COSYVOICE_POLICY.maxTokenTextRatio,
		...(retryVersion > 0 ? { retryVersion } : {}),
	});
}

function cosyRenderHash({
	block,
	text,
	synthesisText,
	unitIndex,
	voiceCard,
	instruction,
	speed,
	retryVersion = 0,
}) {
	return sceneFragmentRenderHash({
		textHash: block.textHash,
		annotationHash: block.annotationHash,
		voiceCardId: voiceCard.id,
		voiceCardFileHash: voiceCard.fileHash,
		voiceCardText: voiceCard.text,
		provider: 'cosyvoice',
		modelVersion: voiceCard.engine,
		prosodyOrInstruction: instruction,
		renderParameters: {
			...COSYVOICE_POLICY,
			voiceCardStyleId: voiceCard.styleId,
			voiceCardGenerationParameters: voiceCard.generationParameters,
			speed,
			unitIndex,
			...(retryVersion > 0 ? { retryVersion } : {}),
			unitTextHash: sha256(text),
			...(synthesisText === text ? {} : { synthesisTextHash: sha256(synthesisText) }),
			sampleRate: SCENE_SAMPLE_RATE,
			postprocess: {
				version: POSTPROCESS_VERSION,
				channels: 1,
				...postprocessFilter(block.annotation, block.kind),
			},
		},
	});
}

async function renderEdgeBlocks({ blocks, outputDirectory, config, catalog }) {
	const fragmentDirectory = join(outputDirectory, 'fragments', 'edge');
	const sourceDirectory = join(fragmentDirectory, 'source');
	const results = new Map();
	let provider;
	const stats = {
		synthesisCalls: 0,
		cacheHits: 0,
		sourceCacheConversions: 0,
		sourceCacheMigrations: 0,
	};
	for (const block of blocks.filter((item) => item.kind === 'narration')) {
		const plan = resolveSceneNarratorPlan({ block, annotation: block.annotation, config, cards: catalog.cards });
		const renderHash = edgeRenderHash({ block, plan, narratorCard: catalog.cards.narrator });
		const synthesisHash = edgeSynthesisHash({ block, plan, narratorCard: catalog.cards.narrator });
		const outputPath = join(fragmentDirectory, `${renderHash}.wav`);
		const sourcePath = join(sourceDirectory, `${synthesisHash}.mp3`);
		const legacySourcePath = join(sourceDirectory, `${renderHash}.mp3`);
		let artifact = await getCachedWav(outputPath, renderHash);
		let sourceArtifact = await getValidCachedAudio(sourcePath);
		if (!sourceArtifact && synthesisHash !== renderHash) {
			const legacySource = await getValidCachedAudio(legacySourcePath);
			if (legacySource) {
				await copyFileAtomic(legacySourcePath, sourcePath);
				sourceArtifact = await getValidCachedAudio(sourcePath, legacySource.fileHash);
				stats.sourceCacheMigrations += 1;
			}
		}
		if (artifact) {
			stats.cacheHits += 1;
		} else {
			if (!sourceArtifact) {
				provider ||= await createTtsProvider('edge');
				console.log(`Edge 合成 ${block.blockId}...`);
				await provider.synthesizeToFile({
					segments: [{ text: block.text, ...plan.spec }],
					outputPath: sourcePath,
				});
				stats.synthesisCalls += 1;
			} else {
				stats.sourceCacheConversions += 1;
			}
			const postprocess = postprocessFilter(block.annotation, block.kind);
			await renderFfmpegWav({ inputPath: sourcePath, outputPath, filter: postprocess.filter });
			const inspected = await inspectWavArtifact(outputPath);
			artifact = {
				version: 1,
				renderHash,
				synthesisHash,
				provider: 'edge',
				modelVersion: plan.spec.voice,
				voiceCardId: 'narrator',
				text: block.text,
				textHash: block.textHash,
				annotationHash: block.annotationHash,
				edgeProsody: { rate: plan.spec.rate, pitch: plan.spec.pitch, volume: plan.spec.volume },
				baseProsody: { rate: plan.baseSpec.rate, pitch: plan.baseSpec.pitch, volume: plan.baseSpec.volume },
				adjustments: plan.adjustments,
				warnings: plan.warnings,
				postprocess: { ...postprocess, version: POSTPROCESS_VERSION },
				path: projectRelative(outputPath),
				...inspected,
			};
			await writeJsonAtomic(`${outputPath}.json`, artifact);
		}
		results.set(block.blockId, { ...artifact, synthesisHash, pathAbsolute: outputPath });
	}
	return { results, stats };
}

function buildDialogueRequests({ blocks, definition, voiceCards, outputDirectory }) {
	const fragmentDirectory = join(outputDirectory, 'fragments', 'cosyvoice');
	const rawDirectory = join(fragmentDirectory, 'raw');
	const requests = [];
	const blockPlans = new Map();
	for (const block of blocks.filter((item) => item.kind === 'dialogue')) {
		const baseInstruction = buildCosyVoiceInstruction(block.annotation);
		const baseSpeed = cosyVoiceSpeed(block.annotation);
		let unitSpecs = splitChineseDialogueWithDelivery(block.text, block.annotation.delivery);
		if (block.blockId === '081-b0042') {
			const difficultUnit = '如今竟敢私自偷溜进园子，拉云扒瞎、造污寻趁我来。';
			const difficultIndex = unitSpecs.findIndex((unit) => unit.text === difficultUnit);
			if (difficultIndex < 0) throw new Error('袭人生僻连语的保守分句锚点已经变化。');
			unitSpecs = [
				...unitSpecs.slice(0, difficultIndex),
				{ text: '如今竟敢私自偷溜进园子，' },
				{ text: '拉云扒瞎、造污寻趁我来。' },
				...unitSpecs.slice(difficultIndex + 1),
			];
			if (unitSpecs.map((unit) => unit.text).join('') !== block.text) {
				throw new Error('袭人对白的保守分句改变了原文。');
			}
		}
		const chorus = chorusForBlock(definition, block);
		const speakers = chorus?.voices || [block.annotation.speakerRef];
		const units = unitSpecs.map((unitSpec, unitIndex) => {
			const { text, delivery } = unitSpec;
			const deliveryInstructions = [];
			if (delivery?.continuous) deliveryInstructions.push('整句一口气连贯说完，词内不停顿');
			if (delivery?.instruction) deliveryInstructions.push(delivery.instruction);
			const instructionEnd = '<|endofprompt|>';
			const instruction = deliveryInstructions.length === 0 ? baseInstruction
				: `${baseInstruction.slice(0, -instructionEnd.length)}；${deliveryInstructions.join('；')}${instructionEnd}`;
			const speed = delivery?.speed ?? baseSpeed;
			const synthesisText = applyPronunciationOverrides(
				text,
				block.annotation.pronunciations,
			);
			const components = speakers.map((speakerRef) => {
				const voiceCardId = selectSceneVoiceCardId(block, speakerRef);
				const voiceCard = voiceCards[voiceCardId];
				if (!voiceCard) throw new Error(`对白 ${block.blockId} 缺少 CosyVoice 音色卡 ${voiceCardId}。`);
				const retryVersion = COSYVOICE_RETRY_VERSIONS.get(
					`${block.blockId}:${unitIndex}:${voiceCardId}`,
				) || 0;
				const renderHash = cosyRenderHash({
					block,
					text,
					synthesisText,
					unitIndex,
					voiceCard,
					instruction,
					speed,
					retryVersion,
				});
				const synthesisHash = cosySynthesisHash({
					synthesisText,
					voiceCard,
					instruction,
					speed,
					retryVersion,
				});
				const path = join(fragmentDirectory, `${renderHash}.wav`);
				const rawPath = join(rawDirectory, `${synthesisHash}.wav`);
				const request = {
					id: `${block.blockId}-u${String(unitIndex + 1).padStart(2, '0')}-${voiceCardId}`,
					blockId: block.blockId,
					unitIndex,
					text,
					synthesisText,
					instruction,
					speed,
					retryVersion,
					pronunciations: block.annotation.pronunciations,
					voiceCardId,
					speakerRef,
					voiceCard,
					renderHash,
					synthesisHash,
					path,
					rawPath,
					legacyRawPath: join(rawDirectory, `${renderHash}.wav`),
				};
				requests.push(request);
				return request;
			});
			return {
				unitIndex,
				text,
				synthesisText,
				instruction,
				speed,
				delivery,
				pauseAfterMs: unitIndex === unitSpecs.length - 1 ? 0 : pauseAfterSynthesisUnit(text),
				components,
			};
		});
		blockPlans.set(block.blockId, {
			block,
			instruction: baseInstruction,
			speed: baseSpeed,
			chorus,
			units,
		});
	}
	return { requests, blockPlans };
}

async function ensureCosyRaw({ missing, outputDirectory }) {
	if (missing.length === 0) {
		return { jobs: 0, inferenceCalls: 0, fallbacks: 0, totalElapsedSeconds: 0, modelLoadSeconds: 0 };
	}
	const jobsPath = join(outputDirectory, 'cosyvoice-jobs.json');
	const resultsPath = join(outputDirectory, 'cosyvoice-run-results.latest.json');
	const historyPath = join(outputDirectory, 'cosyvoice-run-results.json');
	await writeJsonAtomic(jobsPath, {
		version: 1,
		jobs: missing.map((request) => ({
			id: request.id,
			renderHash: request.synthesisHash,
			text: request.synthesisText,
			sourceText: request.text,
			pronunciations: request.pronunciations,
			instruction: request.instruction,
			speed: request.speed,
			seed: Number.parseInt(request.synthesisHash.slice(0, 8), 16),
			voiceCardId: request.voiceCardId,
			speakerRef: request.speakerRef,
			voiceCardPath: toWslPath(request.voiceCard.path),
			voiceCardText: request.voiceCard.text,
			voiceCardFileHash: request.voiceCard.fileHash,
			outputPath: toWslPath(request.rawPath),
			metadataPath: toWslPath(`${request.rawPath}.json`),
			instructAttemptPath: toWslPath(join(
				outputDirectory,
				'fragments',
				'cosyvoice',
				'attempts',
				`${request.synthesisHash}-instruct.wav`,
			)),
			forceZeroShot: COSYVOICE_POLICY.effectiveMethod === 'inference_zero_shot',
			fallbackReason: INSTRUCT2_FALLBACK_REASON,
		})),
	});
	console.log(`CosyVoice 串行合成 ${missing.length} 个角色短句单元...`);
	await runWsl([
		COSYVOICE_PYTHON,
		toWslPath(join(PROJECT_ROOT, 'scripts', 'audio', 'cosyvoice_scene.py')),
		'--cosyvoice-root', COSYVOICE_ROOT,
		'--model-dir', COSYVOICE_MODEL,
		'--jobs', toWslPath(jobsPath),
		'--results-output', toWslPath(resultsPath),
		'--fp16',
		'--load-jit',
		'--speech-tokenizer-cpu',
		'--disable-text-frontend',
		'--min-token-text-ratio', String(COSYVOICE_POLICY.minTokenTextRatio),
		'--max-token-text-ratio', String(COSYVOICE_POLICY.maxTokenTextRatio),
		'--job-timeout-seconds', String(COSYVOICE_POLICY.jobTimeoutSeconds),
		'--min-instruct-speaker-similarity', String(COSYVOICE_POLICY.minInstructSpeakerSimilarity),
	], { echo: process.env.AUDIO_VERBOSE === '1' });
	const result = await readJsonIfExists(resultsPath);
	if (!result || result.results?.length !== missing.length) {
		throw new Error('CosyVoice 结果清单缺失或数量不符；已完成片段仍保留在缓存。');
	}
	const fallbacks = result.results.filter((item) => item.methodUsed === 'inference_zero_shot').length;
	const inferenceCalls = result.results.reduce((count, item) => (
		count + 1 + (item.instructAttempted && item.methodUsed === 'inference_zero_shot' ? 1 : 0)
	), 0);
	const previous = await readJsonIfExists(historyPath);
	const mergedResults = new Map((previous?.results || []).map((item) => [item.renderHash, item]));
	for (const item of result.results) mergedResults.set(item.renderHash, item);
	const previousRuns = previous?.runs || (previous ? [{
		kind: 'imported-prior-run',
		jobs: previous.results?.length || 0,
		totalElapsedSeconds: previous.totalElapsedSeconds || 0,
		modelLoadSeconds: previous.modelLoadSeconds || 0,
	}] : []);
	await writeJsonAtomic(historyPath, {
		...result,
		version: 2,
		results: [...mergedResults.values()],
		runs: [...previousRuns, {
			kind: 'synthesis-run',
			jobs: result.results.length,
			inferenceCalls,
			fallbacks,
			totalElapsedSeconds: result.totalElapsedSeconds,
			modelLoadSeconds: result.modelLoadSeconds,
			createdAt: new Date().toISOString(),
		}],
		totalElapsedSeconds: Number((
			(previous?.totalElapsedSeconds || 0) + (result.totalElapsedSeconds || 0)
		).toFixed(3)),
		modelLoadSeconds: Number((
			(previous?.modelLoadSeconds || 0) + (result.modelLoadSeconds || 0)
		).toFixed(3)),
	});
	return {
		jobs: missing.length,
		inferenceCalls,
		fallbacks,
		totalElapsedSeconds: result.totalElapsedSeconds,
		modelLoadSeconds: result.modelLoadSeconds,
		promptCacheEntries: result.promptCacheEntries,
		promptCacheSeconds: result.promptCacheSeconds,
	};
}

async function renderCosyRequests({ requests, outputDirectory }) {
	const cached = new Map();
	const missingRaw = [];
	let cacheHits = 0;
	let rawCacheConversions = 0;
	let rawCacheMigrations = 0;
	for (const request of requests) {
		const final = await getCachedWav(request.path, request.renderHash);
		let raw = await getCachedWav(request.rawPath, request.synthesisHash);
		if (!raw && request.legacyRawPath !== request.rawPath) {
			const legacy = await getCachedWav(request.legacyRawPath, request.renderHash);
			if (legacy) {
				await renderFfmpegWav({ inputPath: request.legacyRawPath, outputPath: request.rawPath });
				const inspected = await inspectWavArtifact(request.rawPath);
				raw = {
					...legacy,
					renderHash: request.synthesisHash,
					synthesisHash: request.synthesisHash,
					sourceText: request.text,
					text: request.synthesisText,
					migratedFromRenderHash: request.renderHash,
					path: projectRelative(request.rawPath),
					...inspected,
				};
				await writeJsonAtomic(`${request.rawPath}.json`, raw);
				rawCacheMigrations += 1;
			}
		}
		if (final) {
			cacheHits += 1;
			cached.set(request.id, {
				...final,
				synthesisHash: request.synthesisHash,
				pathAbsolute: request.path,
			});
			continue;
		}
		if (!raw) missingRaw.push(request);
		else rawCacheConversions += 1;
	}
	const synthesisStats = await ensureCosyRaw({ missing: missingRaw, outputDirectory });

	for (const request of requests) {
		if (cached.has(request.id)) continue;
		const rawMetadata = await getCachedWav(request.rawPath, request.synthesisHash);
		if (!rawMetadata) throw new Error(`CosyVoice 未生成 ${request.id} 的有效原始缓存。`);
		const effectivePostprocess = request.postprocess || { targetLufs: -19.8, filter: 'loudnorm=I=-19.8:TP=-3:LRA=7' };
		await renderFfmpegWav({
			inputPath: request.rawPath,
			outputPath: request.path,
			filter: effectivePostprocess.filter,
		});
		const inspected = await inspectWavArtifact(request.path);
		const final = {
			version: 1,
			renderHash: request.renderHash,
			synthesisHash: request.synthesisHash,
			provider: 'cosyvoice',
			modelVersion: request.voiceCard.engine.version,
			preferredMethod: 'inference_instruct2',
			methodUsed: rawMetadata.methodUsed,
			fallbackReason: rawMetadata.fallbackReason,
			failedInstructAttemptPath: rawMetadata.failedInstructAttemptPath,
			cardToInstructSimilarity: rawMetadata.cardToInstructSimilarity,
			cardToFinalSimilarity: rawMetadata.cardToFinalSimilarity,
			voiceCardId: request.voiceCardId,
			speakerRef: request.speakerRef,
			voiceCardStyleId: request.voiceCard.styleId,
			voiceCardPath: request.voiceCard.pathRelative,
			voiceCardFileHash: request.voiceCard.fileHash,
			voiceCardText: request.voiceCard.text,
			text: request.text,
			synthesisText: request.synthesisText,
			unitTextHash: sha256(request.text),
			instruction: request.instruction,
			speed: request.speed,
			postprocess: { ...effectivePostprocess, version: POSTPROCESS_VERSION },
			path: projectRelative(request.path),
			...inspected,
		};
		await writeJsonAtomic(`${request.path}.json`, final);
		cached.set(request.id, { ...final, pathAbsolute: request.path });
	}
	return {
		results: cached,
		stats: {
			...synthesisStats,
			cacheHits,
			rawCacheConversions,
			rawCacheMigrations,
		},
	};
}

async function mixChorusUnit({ unit, chorus, outputDirectory, renderedComponents }) {
	const componentArtifacts = unit.components.map((request) => renderedComponents.get(request.id));
	const mixSpec = {
		version: CHORUS_MIX_VERSION,
		mainVoice: chorus.mainVoice,
		components: componentArtifacts.map((artifact, index) => ({
			renderHash: artifact.renderHash,
			voiceCardId: artifact.voiceCardId,
			gainDb: index === 0 ? 0 : index === 1 ? -6 : -7,
			delayMs: index === 0 ? 0 : index === 1 ? 45 : 78,
		})),
	};
	const renderHash = hashJson(mixSpec);
	const outputPath = join(outputDirectory, 'fragments', 'cosyvoice', 'mixes', `${renderHash}.wav`);
	let artifact = await getCachedWav(outputPath, renderHash);
	if (!artifact) {
		await mkdir(dirname(outputPath), { recursive: true });
		const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.wav`;
		const filters = mixSpec.components.map((component, index) => (
			`[${index}:a]volume=${component.gainDb}dB,adelay=${component.delayMs}:all=1[a${index}]`
		));
		filters.push(
			`${mixSpec.components.map((_, index) => `[a${index}]`).join('')}`
			+ `amix=inputs=${mixSpec.components.length}:duration=longest:dropout_transition=0:normalize=0,`
			+ 'alimiter=limit=0.89[mix]',
		);
		const filterScriptPath = `${outputPath}.filter.txt`;
		await writeFile(filterScriptPath, `${filters.join(';')}\n`, 'utf8');
		try {
			await runWsl([
				'ffmpeg', '-nostdin', '-v', 'error', '-y',
				...componentArtifacts.flatMap((component) => ['-i', toWslPath(component.pathAbsolute)]),
				'-filter_complex_script', toWslPath(filterScriptPath), '-map', '[mix]',
				'-ar', String(SCENE_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
				toWslPath(temporaryPath),
			]);
			await replaceCompletedFile(temporaryPath, outputPath);
		} catch (error) {
			await rm(temporaryPath, { force: true });
			throw error;
		}
		const inspected = await inspectWavArtifact(outputPath);
		artifact = {
			version: 1,
			renderHash,
			provider: 'cosyvoice-chorus-mix',
			text: unit.text,
			mixSpec,
			path: projectRelative(outputPath),
			...inspected,
		};
		await writeJsonAtomic(`${outputPath}.json`, artifact);
	}
	return { ...artifact, pathAbsolute: outputPath };
}

async function materializeDialoguePlans({ blockPlans, renderedComponents, outputDirectory }) {
	for (const plan of blockPlans.values()) {
		for (const unit of plan.units) {
			unit.componentArtifacts = unit.components.map((request) => renderedComponents.get(request.id));
			if (plan.chorus) {
				unit.selectedArtifact = unit.componentArtifacts[0];
				unit.chorusMode = 'single-main';
				unit.chorusFallbackReason = plan.chorus.reason;
			} else {
				unit.selectedArtifact = unit.componentArtifacts[0];
			}
		}
	}
}

async function renderSilence(outputDirectory, milliseconds) {
	const path = join(outputDirectory, 'fragments', 'silence', `${milliseconds}ms.wav`);
	if (await pathExists(path)) return path;
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp.wav`;
	try {
		await runWsl([
			'ffmpeg', '-nostdin', '-v', 'error', '-y',
			'-f', 'lavfi', '-i', `anullsrc=r=${SCENE_SAMPLE_RATE}:cl=mono`,
			'-t', (milliseconds / 1000).toFixed(3),
			'-c:a', 'pcm_s16le', toWslPath(temporaryPath),
		]);
		await replaceCompletedFile(temporaryPath, path);
		return path;
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

function dialogueValidationJobs(blockPlans, leveledPaths) {
	const jobs = [];
	for (const plan of blockPlans.values()) {
		for (const unit of plan.units) {
			for (const artifact of unit.componentArtifacts) {
				const selectedFinalPath = artifact === unit.selectedArtifact
					? leveledPaths?.get(`${plan.block.blockId}:${unit.unitIndex}`)
					: undefined;
				jobs.push({
					id: `${plan.block.blockId}-u${unit.unitIndex + 1}-${artifact.voiceCardId}`,
					blockId: plan.block.blockId,
					unitIndex: unit.unitIndex,
					voiceCardId: artifact.voiceCardId,
					speakerRef: artifact.speakerRef,
					kind: 'voice-component',
					path: toWslPath(selectedFinalPath || artifact.pathAbsolute),
					expectedText: unit.text,
				});
			}
			if (unit.mixedArtifact) {
				jobs.push({
					id: `${plan.block.blockId}-u${unit.unitIndex + 1}-chorus-mix`,
					blockId: plan.block.blockId,
					unitIndex: unit.unitIndex,
					voiceCardId: plan.chorus.mainVoice,
					kind: 'chorus-mix',
					path: toWslPath(unit.mixedArtifact.pathAbsolute),
					expectedText: unit.text,
				});
			}
		}
	}
	return jobs;
}

function narrationValidationJobs(blocks, edgeResults, leveledPaths) {
	return blocks
		.filter((block) => block.kind === 'narration')
		.map((block) => ({
			id: `${block.blockId}-narration-check`,
			blockId: block.blockId,
			voiceCardId: 'narrator',
			kind: 'narration-check',
			path: toWslPath(
				leveledPaths?.get(`${block.blockId}:narration`)
				|| edgeResults.get(block.blockId).pathAbsolute,
			),
			expectedText: block.text,
		}));
}

async function runWhisperValidation({
	blockPlans,
	blocks,
	edgeResults,
	outputDirectory,
	leveledPaths,
}) {
	const jobsPath = join(outputDirectory, 'whisper-jobs.json');
	const outputPath = join(outputDirectory, 'whisper-validation.json');
	const jobs = [
		...dialogueValidationJobs(blockPlans, leveledPaths),
		...narrationValidationJobs(blocks, edgeResults, leveledPaths),
	];
	await writeJsonAtomic(jobsPath, { version: 1, jobs });
	console.log(`Whisper small 增量检查 ${jobs.length} 个对白和旁白短片段...`);
	await runWsl([
		COSYVOICE_PYTHON,
		toWslPath(join(PROJECT_ROOT, 'scripts', 'audio', 'whisper_validate.py')),
		'--jobs', toWslPath(jobsPath),
		'--output', toWslPath(outputPath),
		'--model', 'small',
	], { echo: process.env.AUDIO_VERBOSE === '1' });
	const validation = await readJsonIfExists(outputPath);
	if (!validation || validation.results?.length !== jobs.length) {
		throw new Error('Whisper 验证结果缺失或数量不符。');
	}
	const byId = new Map(validation.results.map((item) => [item.id, item]));
	for (const plan of blockPlans.values()) {
		if (!plan.chorus) continue;
		const reasons = [];
		for (const unit of plan.units) {
			const result = byId.get(`${plan.block.blockId}-u${unit.unitIndex + 1}-chorus-mix`);
			if (!result) continue;
			if (result.repeatedUnexpectedSpan) {
				reasons.push(`单元 ${unit.unitIndex + 1} 出现非原文重复“${result.repeatedUnexpectedSpan}”`);
			} else if (result.characterSimilarity < 0.68) {
				reasons.push(`单元 ${unit.unitIndex + 1} 的 Whisper 字符相似度 ${result.characterSimilarity} 低于 0.68`);
			}
		}
		if (reasons.length > 0) {
			const reason = `整块齐声可懂度不足，回退标注主声 ${plan.chorus.mainVoice}：${reasons.join('；')}`;
			for (const unit of plan.units) {
				unit.selectedArtifact = unit.componentArtifacts[0];
				unit.chorusMode = 'single-main-fallback';
				unit.chorusFallbackReason = reason;
			}
		}
	}
	const selectedResults = [];
	for (const plan of blockPlans.values()) {
		for (const unit of plan.units) {
			const resultId = unit.mixedArtifact
				? `${plan.block.blockId}-u${unit.unitIndex + 1}-chorus-mix`
				: `${plan.block.blockId}-u${unit.unitIndex + 1}-${unit.selectedArtifact.voiceCardId}`;
			const result = byId.get(resultId);
			if (!result) throw new Error(`缺少入片单元 ${resultId} 的 Whisper 结果。`);
			const structuralPass = passesWhisperStructuralReview(result);
			selectedResults.push({
				id: resultId,
				blockId: plan.block.blockId,
				unitIndex: unit.unitIndex,
				characterSimilarity: result.characterSimilarity,
				lengthRatio: result.lengthRatio,
				rawStatus: result.status,
				structuralPass,
				note: structuralPass
					? '正文顺序和长度结构通过；原始转写差异按繁简字、同音/近音字保留，不宣称逐字一致'
					: '需人工复听或重做',
			});
		}
	}
	const narrationResults = validation.results.filter((result) => result.kind === 'narration-check');
	const markerTerms = ['脂批', '书批', '圖片', '图片', '自定义标记', 'image'];
	const unexpectedMarkerReadings = narrationResults.flatMap((result) => (
		markerTerms
			.filter((term) => result.transcript.toLowerCase().includes(term.toLowerCase()))
			.map((term) => ({ id: result.id, term }))
	));
	validation.selectionReview = {
		version: 1,
		selectedDialogueUnits: selectedResults.length,
		structuralPass: selectedResults.filter((result) => result.structuralPass).length,
		needsReview: selectedResults.filter((result) => !result.structuralPass).length,
		rejectedUnselectedRenders: validation.results
			.filter((result) => result.status.startsWith('reject-'))
			.map((result) => ({ id: result.id, status: result.status })),
		interpretation: 'Whisper small 是自动抽查而非逐字真值；繁简体及同音/近音误识保留原始差异，结构验收只排除漏长句、乱序、重复和明显拖尾。',
		results: selectedResults,
	};
	validation.narrationSpotCheck = {
		count: narrationResults.length,
		blockIds: narrationResults.map((result) => result.blockId),
		unexpectedMarkerReadings,
		passedNoMarkupReading: unexpectedMarkerReadings.length === 0,
	};
	await writeJsonAtomic(outputPath, validation);
	return validation;
}

function timelineForBlocks(blocks, edgeResults, blockPlans) {
	const timeline = [];
	for (let index = 0; index < blocks.length; index += 1) {
		const block = blocks[index];
		if (block.kind === 'narration') {
			timeline.push({
				type: 'audio',
				blockId: block.blockId,
				kind: block.kind,
				speakerRef: block.annotation.speakerRef,
				path: edgeResults.get(block.blockId).pathAbsolute,
			});
		} else {
			const plan = blockPlans.get(block.blockId);
			for (const unit of plan.units) {
				timeline.push({
					type: 'audio',
					blockId: block.blockId,
					unitIndex: unit.unitIndex,
					kind: block.kind,
					speakerRef: block.annotation.speakerRef,
					path: unit.selectedArtifact.pathAbsolute,
				});
				if (unit.pauseAfterMs > 0) timeline.push({ type: 'silence', milliseconds: unit.pauseAfterMs });
			}
		}
		const pause = scenePauseAfter(block, blocks[index + 1]);
		if (pause > 0) timeline.push({ type: 'silence', milliseconds: pause });
	}
	return timeline;
}

function timelineAudioKey(item) {
	return `${item.blockId}:${item.unitIndex ?? 'narration'}`;
}

async function inspectPcm16Levels(path) {
	const buffer = await readFile(path);
	if (buffer.length < 44 || buffer.toString('ascii', 0, 4) !== 'RIFF'
		|| buffer.toString('ascii', 8, 12) !== 'WAVE') {
		throw new Error(`${projectRelative(path)} 不是可识别的 WAV。`);
	}
	let cursor = 12;
	let format;
	let dataOffset;
	let dataLength;
	while (cursor + 8 <= buffer.length) {
		const id = buffer.toString('ascii', cursor, cursor + 4);
		const length = buffer.readUInt32LE(cursor + 4);
		const offset = cursor + 8;
		if (id === 'fmt ' && length >= 16) {
			format = {
				audioFormat: buffer.readUInt16LE(offset),
				channels: buffer.readUInt16LE(offset + 2),
				sampleRate: buffer.readUInt32LE(offset + 4),
				bitsPerSample: buffer.readUInt16LE(offset + 14),
			};
		}
		if (id === 'data') {
			dataOffset = offset;
			dataLength = Math.min(length, buffer.length - offset);
			break;
		}
		cursor = offset + length + (length % 2);
	}
	if (!format || format.audioFormat !== 1 || format.channels !== 1
		|| format.sampleRate !== SCENE_SAMPLE_RATE || format.bitsPerSample !== 16
		|| dataOffset === undefined || dataLength < 2) {
		throw new Error(`${projectRelative(path)} 不是 24 kHz 单声道 PCM s16 WAV。`);
	}
	const sampleCount = Math.floor(dataLength / 2);
	const activeThreshold = 32768 * (10 ** (-45 / 20));
	let sumSquares = 0;
	let peak = 0;
	let activeSamples = 0;
	for (let index = 0; index < sampleCount; index += 1) {
		const value = Math.abs(buffer.readInt16LE(dataOffset + index * 2));
		sumSquares += value * value;
		if (value > peak) peak = value;
		if (value >= activeThreshold) activeSamples += 1;
	}
	const toDbfs = (value) => (value > 0 ? 20 * Math.log10(value / 32768) : Number.NEGATIVE_INFINITY);
	return {
		durationSeconds: Number((sampleCount / format.sampleRate).toFixed(3)),
		rmsDbfs: Number(toDbfs(Math.sqrt(sumSquares / sampleCount)).toFixed(3)),
		peakDbfs: Number(toDbfs(peak).toFixed(3)),
		activeSampleRatio: Number((activeSamples / sampleCount).toFixed(4)),
	};
}

async function levelTimelineSpeech({ timeline, outputDirectory }) {
	const directory = join(outputDirectory, 'fragments', 'leveled');
	const pathByKey = new Map();
	const entries = [];
	let cacheHits = 0;
	let transformations = 0;
	for (const item of timeline.filter((entry) => entry.type === 'audio')) {
		const inputLevels = await inspectPcm16Levels(item.path);
		if (inputLevels.durationSeconds < 0.15 || inputLevels.peakDbfs < -50
			|| inputLevels.activeSampleRatio < 0.005) {
			throw new Error(`短片段 ${timelineAudioKey(item)} 疑似空音频，拒绝拼接。`);
		}
		const targetRmsDbfs = speechLevelTarget(item.kind);
		const peakLimitDbfs = -3;
		const gainDb = computeSpeechLevelGain({
			rmsDbfs: inputLevels.rmsDbfs,
			peakDbfs: inputLevels.peakDbfs,
			targetRmsDbfs,
			peakLimitDbfs,
		});
		if (gainDb > 24) {
			throw new Error(`短片段 ${timelineAudioKey(item)} 需要提升 ${gainDb} dB，疑似合成失败。`);
		}
		const sourceHash = await sha256File(item.path);
		const renderHash = hashJson({
			version: FRAGMENT_LEVEL_VERSION,
			sourceHash,
			targetRmsDbfs,
			peakLimitDbfs,
			gainDb,
		});
		const outputPath = join(directory, `${renderHash}.wav`);
		let artifact = await getCachedWav(outputPath, renderHash);
		if (artifact) {
			cacheHits += 1;
		} else {
			await renderFfmpegWav({
				inputPath: item.path,
				outputPath,
				filter: `volume=${gainDb}dB`,
			});
			const inspected = await inspectWavArtifact(outputPath);
			const outputLevels = await inspectPcm16Levels(outputPath);
			artifact = {
				version: 1,
				renderHash,
				provider: 'ffmpeg-fragment-level',
				sourcePath: projectRelative(item.path),
				sourceHash,
				targetRmsDbfs,
				peakLimitDbfs,
				gainDb,
				inputLevels,
				outputLevels,
				path: projectRelative(outputPath),
				...inspected,
			};
			await writeJsonAtomic(`${outputPath}.json`, artifact);
			transformations += 1;
		}
		const outputLevels = artifact.outputLevels || await inspectPcm16Levels(outputPath);
		if (outputLevels.peakDbfs < -30 || outputLevels.activeSampleRatio < 0.005) {
			throw new Error(`短片段 ${timelineAudioKey(item)} 校准后仍疑似空音频。`);
		}
		item.unleveledPath = item.path;
		item.path = outputPath;
		pathByKey.set(timelineAudioKey(item), outputPath);
		entries.push({
			blockId: item.blockId,
			unitIndex: item.unitIndex,
			kind: item.kind,
			speakerRef: item.speakerRef,
			path: projectRelative(outputPath),
			targetRmsDbfs,
			gainDb,
			inputLevels,
			outputLevels,
		});
	}
	const report = {
		version: 1,
		levelVersion: FRAGMENT_LEVEL_VERSION,
		counts: {
			fragments: entries.length,
			cacheHits,
			transformations,
			largeCorrections: entries.filter((entry) => Math.abs(entry.gainDb) >= 6).length,
		},
		limits: { silentPeakDbfs: -50, minimumActiveSampleRatio: 0.005, maximumGainDb: 24 },
		entries,
		createdAt: new Date().toISOString(),
	};
	await writeJsonAtomic(join(outputDirectory, 'fragment-quality-report.json'), report);
	return { timeline, pathByKey, report };
}

async function trimTimelineSpeech({ timeline, outputDirectory }) {
	const directory = join(outputDirectory, 'fragments', 'trimmed');
	const results = new Map();
	let cacheHits = 0;
	let transformations = 0;
	for (const item of timeline.filter((entry) => entry.type === 'audio')) {
		const sourceHash = await sha256File(item.path);
		const renderHash = hashJson({
			version: SPEECH_EDGE_TRIM_VERSION,
			sourceHash,
			startThresholdDb: -60,
			startDurationMs: 40,
			startSilenceMs: 30,
			endThresholdDb: -60,
			endDurationMs: 100,
			endSilenceMs: 80,
		});
		const outputPath = join(directory, `${renderHash}.wav`);
		let artifact = results.get(renderHash) || await getCachedWav(outputPath, renderHash);
		if (artifact) {
			cacheHits += 1;
		} else {
			const filter = [
				'silenceremove=start_periods=1:start_duration=0.04:start_threshold=-60dB:start_silence=0.03',
				'areverse',
				'silenceremove=start_periods=1:start_duration=0.10:start_threshold=-60dB:start_silence=0.08',
				'areverse',
			].join(',');
			await renderFfmpegWav({ inputPath: item.path, outputPath, filter });
			artifact = {
				version: 1,
				renderHash,
				provider: 'ffmpeg-speech-edge-trim',
				sourcePath: projectRelative(item.path),
				sourceHash,
				filter,
				path: projectRelative(outputPath),
				...(await inspectWavArtifact(outputPath)),
			};
			await writeJsonAtomic(`${outputPath}.json`, artifact);
			transformations += 1;
		}
		results.set(renderHash, artifact);
		item.untrimmedPath = item.path;
		item.path = outputPath;
	}
	return { timeline, stats: { version: SPEECH_EDGE_TRIM_VERSION, transformations, cacheHits } };
}

async function assembleLossless({ timeline, outputDirectory }) {
	for (const item of timeline.filter((entry) => entry.type === 'silence')) {
		item.path = await renderSilence(outputDirectory, item.milliseconds);
	}
	const listPath = join(outputDirectory, 'scene-concat.txt');
	const listText = timeline.map((item) => `file '${toWslPath(item.path).replaceAll("'", "'\\''")}'`).join('\n');
	await writeFile(listPath, `${listText}\n`, 'utf8');
	const outputPath = join(outputDirectory, 'scene-unnormalized.wav');
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.wav`;
	try {
		await runWsl([
			'ffmpeg', '-nostdin', '-v', 'error', '-y',
			'-f', 'concat', '-safe', '0', '-i', toWslPath(listPath),
			'-ar', String(SCENE_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
			toWslPath(temporaryPath),
		]);
		await replaceCompletedFile(temporaryPath, outputPath);
		return outputPath;
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

function parseLoudnormJson(stderr) {
	const matches = [...stderr.matchAll(/\{\s*"input_i"[\s\S]*?\}/gu)];
	if (matches.length === 0) throw new Error('FFmpeg loudnorm 没有输出测量 JSON。');
	return JSON.parse(matches.at(-1)[0]);
}

async function measureLoudness(path, target = -19) {
	const { stderr } = await runWsl([
		'ffmpeg', '-nostdin', '-hide_banner', '-i', toWslPath(path),
		'-af', `loudnorm=I=${target}:TP=-2:LRA=11:print_format=json`,
		'-f', 'null', '-',
	]);
	return parseLoudnormJson(stderr);
}

async function masterScene({ inputPath, outputDirectory }) {
	const firstPass = await measureLoudness(inputPath);
	const outputPath = join(outputDirectory, 'scene.wav');
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.wav`;
	const filter = [
		'loudnorm=I=-19:TP=-2:LRA=11',
		`measured_I=${firstPass.input_i}`,
		`measured_LRA=${firstPass.input_lra}`,
		`measured_TP=${firstPass.input_tp}`,
		`measured_thresh=${firstPass.input_thresh}`,
		`offset=${firstPass.target_offset}`,
		'linear=true',
		'print_format=summary',
	].join(':');
	try {
		await runWsl([
			'ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', toWslPath(inputPath),
			'-af', filter, '-ar', String(SCENE_SAMPLE_RATE), '-ac', '1', '-c:a', 'pcm_s16le',
			toWslPath(temporaryPath),
		]);
		await replaceCompletedFile(temporaryPath, outputPath);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
	const finalMeasure = await measureLoudness(outputPath);
	return { path: outputPath, firstPass, finalMeasure };
}

async function encodeMp3({ inputPath, outputDirectory }) {
	const outputPath = join(outputDirectory, 'scene.mp3');
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp.mp3`;
	try {
		await runWsl([
			'ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', toWslPath(inputPath),
			'-ar', String(SCENE_SAMPLE_RATE), '-ac', '1', '-c:a', 'libmp3lame', '-b:a', '128k',
			toWslPath(temporaryPath),
		]);
		await fullDecode(temporaryPath);
		await replaceCompletedFile(temporaryPath, outputPath);
		return outputPath;
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}

async function qualityChecks(path) {
	const peak = await runWsl([
		'ffmpeg', '-nostdin', '-hide_banner', '-i', toWslPath(path),
		'-af', 'astats=metadata=1:reset=0', '-f', 'null', '-',
	]);
	const silence = await runWsl([
		'ffmpeg', '-nostdin', '-hide_banner', '-i', toWslPath(path),
		'-af', 'silencedetect=noise=-45dB:d=0.8', '-f', 'null', '-',
	]);
	const peakLevels = [...peak.stderr.matchAll(/Peak level dB:\s*([^\r\n]+)/gu)].map((match) => match[1].trim());
	const rmsLevels = [...peak.stderr.matchAll(/RMS level dB:\s*([^\r\n]+)/gu)].map((match) => match[1].trim());
	const silenceEvents = silence.stderr.split(/\r?\n/gu).filter((line) => /silence_(?:start|end|duration)/u.test(line));
	return {
		peakLevelDbfs: Number(peakLevels.at(-1)),
		rmsLevelDbfs: Number(rmsLevels.at(-1)),
		silencesLongerThan800ms: silenceEvents,
	};
}

function serializeBlock(block, edgeResults, blockPlans) {
	const common = {
		blockId: block.blockId,
		currentOrder: block.order,
		oldOrder: block.oldOrder,
		kind: block.kind,
		text: block.text,
		textHash: block.textHash,
		contextHash: block.contextHash,
		annotationHash: block.annotationHash,
		speakerRef: block.annotation.speakerRef,
		semantics: {
			emotion: block.annotation.emotion,
			pace: block.annotation.pace,
			pitch: block.annotation.pitch,
			energy: block.annotation.energy,
			timbre: block.annotation.timbre,
			modifiers: block.annotation.modifiers,
		},
		pauseAfterMs: 0,
	};
	if (block.kind === 'narration') {
		const artifact = edgeResults.get(block.blockId);
		return {
			...common,
			route: { provider: 'edge', voice: artifact.modelVersion, trackType: 'narrator' },
			edge: {
				rate: artifact.edgeProsody.rate,
				pitch: artifact.edgeProsody.pitch,
				volume: artifact.edgeProsody.volume,
				adjustments: artifact.adjustments,
				warnings: artifact.warnings,
			},
			fragments: [{
				renderHash: artifact.renderHash,
				synthesisHash: artifact.synthesisHash,
				path: artifact.path,
				fileHash: artifact.fileHash,
				bytes: artifact.bytes,
				durationSeconds: artifact.durationSeconds,
			}],
		};
	}
	const plan = blockPlans.get(block.blockId);
	const selectedVoiceCardIds = [...new Set(plan.units.map((unit) => unit.selectedArtifact.voiceCardId))];
	return {
		...common,
		route: {
			provider: 'cosyvoice',
			speakerRef: block.annotation.speakerRef,
			voiceCardIds: selectedVoiceCardIds,
		},
		cosyvoice: {
			instruction: plan.instruction,
			speed: plan.speed,
			preferredMethod: 'inference_instruct2',
			chorus: plan.chorus ? {
				label: plan.chorus.label,
				mainVoice: plan.chorus.mainVoice,
				voices: plan.chorus.voices,
				configuredMode: plan.chorus.mode,
				reason: plan.chorus.reason,
				units: plan.units.map((unit) => ({
					mode: unit.chorusMode,
					fallbackReason: unit.chorusFallbackReason,
				})),
			} : undefined,
		},
		fragments: plan.units.map((unit) => ({
			unitIndex: unit.unitIndex,
			text: unit.text,
			synthesisText: unit.synthesisText,
			instruction: unit.instruction,
			speed: unit.speed,
			delivery: unit.delivery,
			unitTextHash: sha256(unit.text),
			pauseAfterMs: unit.pauseAfterMs,
			selected: {
				renderHash: unit.selectedArtifact.renderHash,
				path: unit.selectedArtifact.path,
				fileHash: unit.selectedArtifact.fileHash,
				bytes: unit.selectedArtifact.bytes,
				durationSeconds: unit.selectedArtifact.durationSeconds,
			},
			components: unit.componentArtifacts.map((artifact) => ({
				voiceCardId: artifact.voiceCardId,
				speakerRef: artifact.speakerRef,
				voiceCardStyleId: artifact.voiceCardStyleId,
				renderHash: artifact.renderHash,
				synthesisHash: artifact.synthesisHash,
				path: artifact.path,
				fileHash: artifact.fileHash,
				durationSeconds: artifact.durationSeconds,
				methodUsed: artifact.methodUsed,
				cardToInstructSimilarity: artifact.cardToInstructSimilarity,
				cardToFinalSimilarity: artifact.cardToFinalSimilarity,
				fallbackReason: artifact.fallbackReason,
			})),
		})),
	};
}

async function writeScenePlanPreview({
	aligned,
	dialogue,
	voiceCards,
	config,
	catalog,
	outputDirectory,
	chapterId,
	sceneId,
}) {
	const narration = [];
	for (const block of aligned.filter((item) => item.kind === 'narration')) {
		const plan = resolveSceneNarratorPlan({
			block,
			annotation: block.annotation,
			config,
			cards: catalog.cards,
		});
		const renderHash = edgeRenderHash({ block, plan, narratorCard: catalog.cards.narrator });
		const synthesisHash = edgeSynthesisHash({ block, plan, narratorCard: catalog.cards.narrator });
		const path = join(outputDirectory, 'fragments', 'edge', `${renderHash}.wav`);
		narration.push({
			blockId: block.blockId,
			text: block.text,
			provider: 'edge',
			voice: plan.spec.voice,
			prosody: { rate: plan.spec.rate, pitch: plan.spec.pitch, volume: plan.spec.volume },
			synthesisHash,
			renderHash,
			cached: Boolean(await getCachedWav(path, renderHash)),
		});
	}
	const dialogueUnits = [];
	for (const request of dialogue.requests) {
		dialogueUnits.push({
			id: request.id,
			blockId: request.blockId,
			unitIndex: request.unitIndex,
			text: request.text,
			synthesisText: request.synthesisText,
			voiceCardId: request.voiceCardId,
			voiceCardFileHash: request.voiceCard.fileHash,
			instruction: request.instruction,
			speed: request.speed,
			synthesisHash: request.synthesisHash,
			renderHash: request.renderHash,
			cached: Boolean(await getCachedWav(request.path, request.renderHash)),
		});
	}
	const preview = {
		version: 1,
		chapter: chapterId,
		scene: sceneId,
		planOnly: true,
		noSynthesisPerformed: true,
		counts: {
			semanticBlocks: aligned.length,
			narrationBlocks: narration.length,
			dialogueUnits: dialogueUnits.length,
			narrationCacheHits: narration.filter((item) => item.cached).length,
			dialogueCacheHits: dialogueUnits.filter((item) => item.cached).length,
		},
		voiceCards: Object.fromEntries(Object.entries(voiceCards).map(([id, card]) => [id, {
			path: card.pathRelative,
			fileHash: card.fileHash,
			text: card.text,
		}])),
		narration,
		dialogueUnits,
		createdAt: new Date().toISOString(),
	};
	await writeJsonAtomic(join(outputDirectory, 'scene-plan.json'), preview);
	return preview;
}

async function main() {
	ensureSupportedNodeVersion();
	const {
		chapter: chapterId,
		scene: sceneId,
		planOnly,
		skipWhisper,
	} = parseArguments(process.argv.slice(2));
	const definition = SCENE_DEFINITIONS[sceneId];
	if (!definition) throw new Error(`未知场景 ${sceneId}。可用：${Object.keys(SCENE_DEFINITIONS).join('、')}。`);
	if (definition.chapter !== chapterId) throw new Error(`场景 ${sceneId} 属于第 ${definition.chapter} 回。`);
	const outputDirectory = sceneOutputDirectory(PROJECT_ROOT, chapterId, sceneId);
	if (resolve(outputDirectory).toLowerCase().startsWith(resolve(PROJECT_ROOT, 'public', 'audio').toLowerCase())) {
		throw new Error('剧情试听禁止写入 public/audio。');
	}

	const chapterPath = await findChapterPath(chapterId);
	const source = projectRelative(chapterPath);
	const rawSource = await readFile(chapterPath, 'utf8');
	const sourceFileHash = sha256(rawSource);
	const compiled = compileChapter(
		normalizeLegacyNoteMarkers(stripFrontmatter(rawSource)),
		{ sourceName: source },
	);
	const candidates = chapterToAudioCandidates(compiled);
	const extracted = extractSceneByAnchors(candidates, definition);
	const pendingPath = join(CACHE_DIRECTORY, 'pending', `${chapterId}.json`);
	const annotationsPath = join(AUDIO_DIRECTORY, 'annotations', `${chapterId}.json`);
	const [pendingMap, annotationDocument, config] = await Promise.all([
		readJsonIfExists(pendingPath),
		readJsonIfExists(annotationsPath),
		readJsonIfExists(join(AUDIO_DIRECTORY, 'config.json')),
	]);
	if (!pendingMap || !annotationDocument || !config) {
		throw new Error('缺少 pending map、annotations 或 audio config。');
	}
	const aligned = alignSceneBlocks({
		sceneBlocks: extracted.blocks,
		pendingMap,
		annotationDocument,
	});
	const report = alignmentReport({
		chapterId,
		sceneId,
		source,
		sourceFileHash,
		pendingMap,
		extracted,
		aligned,
	});
	await writeJsonAtomic(join(outputDirectory, 'alignment-report.json'), report);
	const paused = aligned.filter((block) => block.alignmentStatus === 'paused');
	if (paused.length > 0) {
		throw new Error(
			`${paused.length} 个块无法可靠对齐，已只在 alignment-report.json 中暂停这些块；未静默套用旧标注。`,
		);
	}

	const catalog = await loadVoiceCardCatalog(PROJECT_ROOT);
	const voiceCards = await loadAndValidateVoiceCards();
	for (const block of aligned.filter((item) => item.kind === 'dialogue')) {
		if (!CHARACTER_VOICE_IDS.has(block.annotation.speakerRef)) {
			throw new Error(`对白 ${block.blockId} 未路由到五张指定 CosyVoice 卡。`);
		}
	}
	const dialogue = buildDialogueRequests({ blocks: aligned, definition, voiceCards, outputDirectory });
	if (planOnly) {
		const preview = await writeScenePlanPreview({
			aligned,
			dialogue,
			voiceCards,
			config,
			catalog,
			outputDirectory,
			chapterId,
			sceneId,
		});
		console.log(
			`计划已写入 scene-plan.json；旁白缓存 ${preview.counts.narrationCacheHits}/${preview.counts.narrationBlocks}，`
			+ `对白缓存 ${preview.counts.dialogueCacheHits}/${preview.counts.dialogueUnits}，未合成音频。`,
		);
		return;
	}

	const edge = await renderEdgeBlocks({
		blocks: aligned,
		outputDirectory,
		config,
		catalog,
	});
	await writeJsonAtomic(join(outputDirectory, 'instruct2-failure.json'), {
		version: 1,
		preferredMethod: 'inference_instruct2',
		outcome: 'timeout-no-output',
		attempts: 2,
		shortSentenceTimeoutSeconds: COSYVOICE_POLICY.jobTimeoutSeconds,
		failedSamples: [],
		reason: INSTRUCT2_FALLBACK_REASON,
		firstText: dialogue.requests[0]?.text,
		fullSemanticInstructionsRetainedInManifest: true,
		fallback: {
			method: 'inference_zero_shot',
			controls: ['speed', 'natural punctuation splitting', 'punctuation', 'conservative loudness post-processing'],
		},
		createdAt: new Date().toISOString(),
	});
	for (const request of dialogue.requests) {
		request.postprocess = postprocessFilter(
			aligned.find((block) => block.blockId === request.blockId).annotation,
			'dialogue',
		);
	}
	const cosy = await renderCosyRequests({ requests: dialogue.requests, outputDirectory });
	await materializeDialoguePlans({
		blockPlans: dialogue.blockPlans,
		renderedComponents: cosy.results,
		outputDirectory,
	});

	// The CosyVoice process has fully exited before Whisper starts, so CUDA model
	// memory is no longer shared by the two workloads.
	const gpuAfterCosy = await runWsl([
		'/usr/lib/wsl/lib/nvidia-smi', '--query-gpu=memory.used', '--format=csv,noheader,nounits',
	]);
	const timeline = timelineForBlocks(aligned, edge.results, dialogue.blockPlans);
	const trimmedTimeline = await trimTimelineSpeech({ timeline, outputDirectory });
	const leveledTimeline = await levelTimelineSpeech({
		timeline: trimmedTimeline.timeline,
		outputDirectory,
	});
	const whisper = skipWhisper ? {
		skipped: true,
		model: null,
		counts: {},
		countsByKind: {},
		cacheHits: 0,
		transcriptions: 0,
		selectionReview: { passed: 0, failed: 0, results: [] },
		narrationSpotCheck: { count: 0, blockIds: [], passedNoMarkupReading: null },
	} : await runWhisperValidation({
		blockPlans: dialogue.blockPlans,
		blocks: aligned,
		edgeResults: edge.results,
		outputDirectory,
		leveledPaths: leveledTimeline.pathByKey,
	});
	const losslessPath = await assembleLossless({ timeline: leveledTimeline.timeline, outputDirectory });
	const master = await masterScene({ inputPath: losslessPath, outputDirectory });
	const mp3Path = await encodeMp3({ inputPath: master.path, outputDirectory });
	const [wavInfo, mp3Info, wavHash, mp3Hash, quality] = await Promise.all([
		inspectWithFfprobe(master.path),
		inspectWithFfprobe(mp3Path),
		sha256File(master.path),
		sha256File(mp3Path),
		qualityChecks(master.path),
	]);
	await fullDecode(master.path);
	await fullDecode(mp3Path);

	const roleCounts = Object.fromEntries(
		['$narrator', ...CHARACTER_VOICE_IDS].map((id) => [
			id,
			aligned.filter((block) => block.annotation.speakerRef === id).length,
		]),
	);
	const serializedBlocks = aligned.map((block) => serializeBlock(block, edge.results, dialogue.blockPlans));
	for (let index = 0; index < serializedBlocks.length; index += 1) {
		serializedBlocks[index].pauseAfterMs = scenePauseAfter(aligned[index], aligned[index + 1]);
	}
	const allVoiceFragments = [...cosy.results.values()].map((artifact) => ({
		voiceCardId: artifact.voiceCardId,
		speakerRef: artifact.speakerRef,
		voiceCardStyleId: artifact.voiceCardStyleId,
		synthesisHash: artifact.synthesisHash,
		renderHash: artifact.renderHash,
		path: artifact.path,
		fileHash: artifact.fileHash,
		bytes: artifact.bytes,
		durationSeconds: artifact.durationSeconds,
	}));
	const cosyHistory = await readJsonIfExists(join(outputDirectory, 'cosyvoice-run-results.json'));
	const manifest = {
		version: 1,
		planVersion: SCENE_PLAN_VERSION,
		renderVersion: SCENE_RENDER_VERSION,
		chapter: chapterId,
		scene: sceneId,
		localOnly: true,
		aiGeneratedAudio: true,
		publication: { publicAudioWritten: false, websiteManifestUpdated: false, cloudflarePublished: false },
		source: { path: source, fileHash: sourceFileHash },
		anchors: report.anchors,
		counts: {
			semanticBlocks: aligned.length,
			narrationBlocks: aligned.filter((block) => block.kind === 'narration').length,
			dialogueBlocks: aligned.filter((block) => block.kind === 'dialogue').length,
			bySpeaker: roleCounts,
			cosyVoiceSynthesisUnits: dialogue.requests.length,
		},
		voiceCards: Object.fromEntries(Object.entries(voiceCards).map(([id, card]) => [id, {
			speakerRef: card.speakerRef,
			styleId: card.styleId,
			path: card.pathRelative,
			metadataPath: card.metadataPath,
			text: card.text,
			fileHash: card.fileHash,
			format: card.format,
			generationParameters: card.generationParameters,
			sourceType: card.sourceType,
			disclaimer: card.disclaimer,
		}])),
		proxyVoiceDisclaimer: '艾官、荳官、葵官使用代理声源，并非人物或演员本人的原声。',
		instruct2Fallback: {
			path: 'instruct2-failure.json',
			reason: INSTRUCT2_FALLBACK_REASON,
			failedSamples: [],
		},
		synthesis: {
			edge: {
				currentRun: edge.stats,
				cacheInventory: edge.results.size,
				lifetimeSuccessfulSynthesisCalls: edge.results.size,
			},
			cosyvoice: {
				currentRun: cosy.stats,
				cacheInventory: cosy.results.size,
				lifetimeSuccessfulSynthesisJobs: cosyHistory?.results?.length || cosy.results.size,
				lifetimeTotalElapsedSeconds: cosyHistory?.totalElapsedSeconds || cosy.stats.totalElapsedSeconds,
				lifetimeModelLoadSeconds: cosyHistory?.modelLoadSeconds || cosy.stats.modelLoadSeconds,
			},
			gpuMemoryUsedMiBAfterCosyExit: Number(gpuAfterCosy.stdout.trim()),
		},
		policies: {
			cosyvoice: COSYVOICE_POLICY,
			edgeSynthesisVersion: EDGE_SYNTHESIS_VERSION,
			cosyvoiceSynthesisVersion: COSYVOICE_SYNTHESIS_VERSION,
			postprocessVersion: POSTPROCESS_VERSION,
			chorusMixVersion: CHORUS_MIX_VERSION,
			speechEdgeTrim: trimmedTimeline.stats,
			fragmentLeveling: {
				path: 'fragment-quality-report.json',
				version: FRAGMENT_LEVEL_VERSION,
				counts: leveledTimeline.report.counts,
			},
			finalMasterVersion: FINAL_MASTER_VERSION,
			dialogueSplitterVersion: DIALOGUE_SPLITTER_VERSION,
		},
		blocks: serializedBlocks,
		voiceFragments: allVoiceFragments,
		chorus: [...dialogue.blockPlans.values()].filter((plan) => plan.chorus).map((plan) => ({
			blockId: plan.block.blockId,
			label: plan.chorus.label,
			mainVoice: plan.chorus.mainVoice,
			voices: plan.chorus.voices,
			configuredMode: plan.chorus.mode,
			reason: plan.chorus.reason,
			units: plan.units.map((unit) => ({
				unitIndex: unit.unitIndex,
				mode: unit.chorusMode,
				fallbackReason: unit.chorusFallbackReason,
			})),
		})),
		whisperValidation: {
			skipped: whisper.skipped || false,
			path: whisper.skipped ? null : 'whisper-validation.json',
			model: whisper.model,
			counts: whisper.counts,
			countsByKind: whisper.countsByKind,
			cacheHits: whisper.cacheHits,
			transcriptions: whisper.transcriptions,
			selectionReview: whisper.selectionReview,
			narrationValidation: whisper.narrationSpotCheck,
		},
		outputs: {
			losslessConcatenation: {
				path: projectRelative(losslessPath),
				fileHash: await sha256File(losslessPath),
				...(await inspectWithFfprobe(losslessPath)),
			},
			wav: { path: projectRelative(master.path), fileHash: wavHash, ...wavInfo },
			mp3: { path: projectRelative(mp3Path), fileHash: mp3Hash, ...mp3Info },
			loudness: {
				targetLufs: -19,
				truePeakLimitDbfs: -2,
				measurement: master.finalMeasure,
			},
			quality,
		},
		generatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(join(outputDirectory, 'scene-manifest.json'), manifest);

	console.log(`场景：${sceneId}，语义块 ${aligned.length}（旁白 ${manifest.counts.narrationBlocks}、对白 ${manifest.counts.dialogueBlocks}）。`);
	console.log(`Edge：合成 ${edge.stats.synthesisCalls}，缓存命中 ${edge.stats.cacheHits}。`);
	console.log(`CosyVoice：作业 ${cosy.stats.jobs}，推理 ${cosy.stats.inferenceCalls}，缓存命中 ${cosy.stats.cacheHits}，耗时 ${cosy.stats.totalElapsedSeconds}s。`);
	console.log(`WAV：${manifest.outputs.wav.durationSeconds.toFixed(2)}s，${wavHash}`);
	console.log(`MP3：${projectRelative(mp3Path)}，${mp3Hash}`);
}

main().catch((error) => {
	console.error(`\n[错误] ${error instanceof Error ? error.message : String(error)}`);
	if (process.env.TTS_DEBUG === '1' && error instanceof Error) console.error(error.stack);
	process.exitCode = 1;
});
