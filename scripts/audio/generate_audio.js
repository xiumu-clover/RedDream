#!/usr/bin/env node

import { readFile, readdir, rm } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import { writeAnnotationRequest } from './annotation-request.js';
import {
	AUDIO_BLOCK_SCHEMA_VERSION,
	SEGMENTER_VERSION,
	chapterToAudioCandidates,
	reconcileAudioBlocks,
	resolveChapterAnnotations,
	sha256,
	voiceAnnotationHash,
} from './audio-blocks.js';
import { normalizeLegacyNoteMarkers, stripFrontmatter } from './chapter-text.js';
import { readJsonIfExists, writeJsonAtomic } from './files.js';
import { resolveBlockRenderSpec } from './render-plan.js';
import {
	assembleMp3Track,
	getValidCachedAudio,
	inspectAudioArtifact,
	trackHashForFragments,
} from './track.js';
import { createTtsProvider } from './tts/provider.js';
import { loadVoiceCardCatalog } from './voice-cards.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const CHAPTER_DIRECTORY = join(PROJECT_ROOT, 'content', 'chapters', 'guiyou');
const AUDIO_CONTENT_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio');
const CONFIG_PATH = join(AUDIO_CONTENT_DIRECTORY, 'config.json');
const ANNOTATION_DIRECTORY = join(AUDIO_CONTENT_DIRECTORY, 'annotations');
const MAP_DIRECTORY = join(AUDIO_CONTENT_DIRECTORY, 'maps');
const CACHE_DIRECTORY = join(AUDIO_CONTENT_DIRECTORY, '.cache');
const FRAGMENT_DIRECTORY = join(CACHE_DIRECTORY, 'fragments');
const TRACK_DIRECTORY = join(CACHE_DIRECTORY, 'tracks');
const PENDING_DIRECTORY = join(CACHE_DIRECTORY, 'pending');

class ChapterInputError extends Error {}
class AnnotationPendingError extends Error {}

function projectRelative(path) {
	return relative(PROJECT_ROOT, path).replaceAll('\\', '/');
}

function ensureSupportedNodeVersion() {
	const [major, minor] = process.versions.node.split('.').map(Number);
	if (major < 22 || (major === 22 && minor < 12)) {
		throw new Error(
			`当前 Node.js 为 ${process.versions.node}；本项目要求 Node.js 22.12.0 或更高版本。`,
		);
	}
}

function normalizeChapterNumber(input, config) {
	const value = String(input ?? '').trim();
	const minimum = Number(config.chapterRange?.min);
	const maximum = Number(config.chapterRange?.max);
	if (!/^\d{1,3}$/u.test(value)) {
		throw new ChapterInputError(`回目编号必须是 ${minimum} 到 ${maximum} 的数字，例如 81 或 081。`);
	}
	const number = Number(value);
	if (!Number.isInteger(number) || number < minimum || number > maximum) {
		throw new ChapterInputError(`有声书只生成第 ${minimum} 至 ${maximum} 回。`);
	}
	return String(number).padStart(3, '0');
}

async function loadConfig() {
	const config = await readJsonIfExists(CONFIG_PATH);
	const narratorVariants = config?.narratorProfiles && typeof config.narratorProfiles === 'object'
		? Object.keys(config.narratorProfiles)
		: [];
	if (Number(config?.version) !== 1
		|| !Number.isInteger(config?.chapterRange?.min)
		|| !Number.isInteger(config?.chapterRange?.max)
		|| config.chapterRange.min > config.chapterRange.max
		|| narratorVariants.length !== 1
		|| !config.narratorProfiles?.[config.defaultVariant]) {
		throw new Error('content/audio/config.json 的版本、回目范围或单一旁白配置无效。');
	}
	return config;
}

async function findChapterPath(chapterId) {
	let entries;
	try {
		entries = await readdir(CHAPTER_DIRECTORY, { withFileTypes: true });
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error('找不到 content/chapters/guiyou/ 目录。');
		throw error;
	}
	const candidates = entries.filter((entry) => entry.isFile()
		&& entry.name.toLowerCase().endsWith('.md')
		&& (entry.name === `${chapterId}.md` || entry.name.startsWith(`${chapterId}-`)));
	if (candidates.length === 0) throw new Error(`找不到第 ${chapterId} 回的 Markdown 文件。`);
	if (candidates.length > 1) {
		throw new Error(`第 ${chapterId} 回匹配到多个文件：${candidates.map(({ name }) => name).join('、')}。`);
	}
	return join(CHAPTER_DIRECTORY, candidates[0].name);
}

function validateMap(map, chapterId, label) {
	if (!map) return undefined;
	if (Number(map.version) !== AUDIO_BLOCK_SCHEMA_VERSION || map.chapter !== chapterId
		|| map.segmenterVersion !== SEGMENTER_VERSION || !Array.isArray(map.blocks)) {
		throw new Error(`${label} 的版本、回目或分块器版本无效。`);
	}
	return map;
}

function pendingMapMatchesCandidates(map, candidates) {
	return map?.blocks?.length === candidates.length && map.blocks.every((block, index) => (
		block.kind === candidates[index].kind && block.textHash === candidates[index].textHash
	));
}

function restorePendingReconciliation(pendingMap, candidates) {
	const blocks = candidates.map((candidate, index) => ({
		...candidate,
		blockId: pendingMap.blocks[index].blockId,
		matchStatus: pendingMap.blocks[index].matchStatus,
		...(pendingMap.blocks[index].reviewReason
			? { reviewReason: pendingMap.blocks[index].reviewReason } : {}),
		...(pendingMap.blocks[index].changeRatio === undefined
			? {} : { changeRatio: pendingMap.blocks[index].changeRatio }),
	}));
	return {
		blocks,
		nextBlockNumber: pendingMap.nextBlockNumber,
		sourceSpeechHash: pendingMap.sourceSpeechHash,
		changes: pendingMap.changes,
	};
}

function pendingMapDocument({ chapterId, source, sourceFileHash, reconciliation }) {
	return {
		version: AUDIO_BLOCK_SCHEMA_VERSION,
		chapter: chapterId,
		source,
		sourceFileHash,
		segmenterVersion: SEGMENTER_VERSION,
		sourceSpeechHash: reconciliation.sourceSpeechHash,
		nextBlockNumber: reconciliation.nextBlockNumber,
		changes: reconciliation.changes,
		blocks: reconciliation.blocks,
		updatedAt: new Date().toISOString(),
	};
}

async function getProvider(providers, providerName) {
	if (!providers.has(providerName)) {
		providers.set(providerName, await createTtsProvider(providerName, {
			maxChunkChars: process.env.TTS_MAX_CHARS,
			maxAttempts: process.env.TTS_RETRIES,
		}));
	}
	return providers.get(providerName);
}

async function renderFragment({
	block,
	annotation,
	variant,
	config,
	cards,
	providers,
	forcedProvider,
	previousRender,
	progress,
}) {
	const plan = resolveBlockRenderSpec({ block, annotation, variant, config, cards, forcedProvider });
	const outputPath = join(
		FRAGMENT_DIRECTORY,
		plan.spec.provider,
		plan.renderHash.slice(0, 2),
		`${plan.renderHash}.mp3`,
	);
	const expectedFileHash = previousRender?.renderHash === plan.renderHash
		? previousRender.fileHash : undefined;
	let artifact = await getValidCachedAudio(outputPath, expectedFileHash);
	let synthesized = false;
	if (!artifact) {
		const provider = await getProvider(providers, plan.spec.provider);
		await provider.synthesizeToFile({
			segments: [{ text: block.text, ...plan.spec }],
			outputPath,
			onProgress: ({ index, total, attempt }) => progress({
				blockId: block.blockId,
				variant,
				index,
				total,
				attempt,
			}),
		});
		artifact = await inspectAudioArtifact(outputPath);
		synthesized = true;
	}
	return {
		path: outputPath,
		synthesized,
		warnings: plan.warnings,
		record: {
			renderHash: plan.renderHash,
			fileHash: artifact.fileHash,
			bytes: artifact.bytes,
			durationSeconds: artifact.durationSeconds,
			provider: plan.spec.provider,
			voice: plan.spec.voice,
			rate: plan.spec.rate,
			pitch: plan.spec.pitch,
			volume: plan.spec.volume,
			cachePath: projectRelative(outputPath),
		},
	};
}

async function buildTrack({ chapterId, variant, fragmentResults, previousOutput }) {
	const renderHashes = fragmentResults.map(({ record }) => record.renderHash);
	const trackHash = trackHashForFragments(renderHashes);
	const outputPath = join(TRACK_DIRECTORY, chapterId, `${variant}-${trackHash}.mp3`);
	const expectedFileHash = previousOutput?.trackHash === trackHash
		? previousOutput.fileHash : undefined;
	let artifact = await getValidCachedAudio(outputPath, expectedFileHash);
	if (!artifact) {
		artifact = await assembleMp3Track(fragmentResults.map(({ path }) => path), outputPath);
	}
	return {
		trackHash,
		fileHash: artifact.fileHash,
		bytes: artifact.bytes,
		durationSeconds: artifact.durationSeconds,
		localPath: projectRelative(outputPath),
		assembledAt: new Date().toISOString(),
	};
}

async function main() {
	ensureSupportedNodeVersion();
	const config = await loadConfig();
	const chapterId = normalizeChapterNumber(process.argv[2], config);
	const chapterPath = await findChapterPath(chapterId);
	const source = projectRelative(chapterPath);
	const rawSource = await readFile(chapterPath, 'utf8');
	const sourceFileHash = sha256(rawSource);
	const compiled = compileChapter(
		normalizeLegacyNoteMarkers(stripFrontmatter(rawSource)),
		{ sourceName: source },
	);
	const candidates = chapterToAudioCandidates(compiled);
	if (candidates.length === 0) throw new Error(`第 ${chapterId} 回没有可朗读内容。`);

	const mapPath = join(MAP_DIRECTORY, `${chapterId}.json`);
	const pendingMapPath = join(PENDING_DIRECTORY, `${chapterId}.json`);
	const annotationPath = join(ANNOTATION_DIRECTORY, `${chapterId}.json`);
	const currentMap = validateMap(await readJsonIfExists(mapPath), chapterId, projectRelative(mapPath));
	const pendingMap = validateMap(
		await readJsonIfExists(pendingMapPath),
		chapterId,
		projectRelative(pendingMapPath),
	);
	const reconciliation = pendingMapMatchesCandidates(pendingMap, candidates)
		? restorePendingReconciliation(pendingMap, candidates)
		: reconcileAudioBlocks(chapterId, candidates, currentMap);
	const catalog = await loadVoiceCardCatalog(PROJECT_ROOT);
	const annotationDocument = await readJsonIfExists(annotationPath);
	const resolved = resolveChapterAnnotations({
		chapterId,
		blocks: reconciliation.blocks,
		document: annotationDocument,
		voiceCardIds: new Set(Object.keys(catalog.cards)),
	});

	console.log(`章节：${basename(chapterPath)}`);
	console.log(`分块：${reconciliation.blocks.length} 个（旁白 ${reconciliation.blocks.filter(({ kind }) => kind === 'narration').length}、对话 ${reconciliation.blocks.filter(({ kind }) => kind === 'dialogue').length}、诗词 ${reconciliation.blocks.filter(({ kind }) => kind === 'poetry').length}）`);
	console.log(`变化：新增 ${reconciliation.changes.new}、自动继承 ${reconciliation.changes.autoReused}、待复核 ${reconciliation.changes.needsReview}、不变 ${reconciliation.changes.unchanged}、删除 ${reconciliation.changes.removed}`);

	if (resolved.pending.length > 0) {
		await writeJsonAtomic(
			pendingMapPath,
			pendingMapDocument({ chapterId, source, sourceFileHash, reconciliation }),
		);
		if (!annotationDocument) {
			await writeJsonAtomic(annotationPath, resolved.document);
		}
		const request = await writeAnnotationRequest({
			projectRoot: PROJECT_ROOT,
			chapterId,
			source,
			blocks: reconciliation.blocks,
			pending: resolved.pending,
			voiceIndex: catalog.index,
		});
		console.log(`待标注：${resolved.pending.length} 个语音块。`);
		console.log(`标注任务：${request.relativePath}`);
		throw new AnnotationPendingError('请完成 AI 标注后重新运行；现有公开音频没有改动。');
	}

	const providers = new Map();
	const forcedProvider = process.env.TTS_PROVIDER?.trim().toLowerCase();
	const variants = Object.keys(config.narratorProfiles);
	const renderedByHash = new Map();
	const variantFragments = Object.fromEntries(variants.map((variant) => [variant, []]));
	const warningSet = new Set();
	let synthesizedBlocks = 0;

	for (const block of reconciliation.blocks) {
		const annotation = resolved.accepted[block.blockId];
		block.annotationHash = voiceAnnotationHash(annotation);
		block.renders = {};
		for (const variant of variants) {
			const preliminary = resolveBlockRenderSpec({
				block,
				annotation,
				variant,
				config,
				cards: catalog.cards,
				forcedProvider,
			});
			let fragment = renderedByHash.get(preliminary.renderHash);
			if (!fragment) {
				fragment = await renderFragment({
					block,
					annotation,
					variant,
					config,
					cards: catalog.cards,
					providers,
					forcedProvider,
					previousRender: currentMap?.blocks?.find(({ blockId }) => blockId === block.blockId)
						?.renders?.[variant],
					progress: ({ blockId, variant: activeVariant, index, total, attempt }) => {
						const retry = attempt > 1 ? `，第 ${attempt} 次尝试` : '';
						console.log(`正在合成 ${blockId}/${activeVariant}（${index}/${total}${retry}）...`);
					},
				});
				renderedByHash.set(preliminary.renderHash, fragment);
				if (fragment.synthesized) synthesizedBlocks += 1;
			}
			for (const warning of fragment.warnings) warningSet.add(warning);
			variantFragments[variant].push(fragment);
			block.renders[variant] = fragment.record;
		}
		block.lastChange = block.matchStatus;
		delete block.matchStatus;
		delete block.reviewReason;
		delete block.changeRatio;
	}

	const outputs = {};
	for (const variant of variants) {
		outputs[variant] = await buildTrack({
			chapterId,
			variant,
			fragmentResults: variantFragments[variant],
			previousOutput: currentMap?.outputs?.[variant],
		});
	}

	const nextMap = {
		version: AUDIO_BLOCK_SCHEMA_VERSION,
		chapter: chapterId,
		source,
		sourceFileHash,
		segmenterVersion: SEGMENTER_VERSION,
		sourceSpeechHash: reconciliation.sourceSpeechHash,
		nextBlockNumber: reconciliation.nextBlockNumber,
		voiceCardsHash: catalog.catalogHash,
		blocks: reconciliation.blocks,
		outputs,
		generatedAt: new Date().toISOString(),
	};
	await writeJsonAtomic(annotationPath, resolved.document);
	await writeJsonAtomic(mapPath, nextMap);
	await rm(pendingMapPath, { force: true });

	console.log(`片段：本次调用 TTS 合成 ${synthesizedBlocks} 个，其余来自缓存。`);
	for (const variant of variants) {
		const label = config.narratorProfiles[variant].label || '旁白';
		console.log(`${label}整轨：${outputs[variant].localPath}`);
	}
	if (warningSet.size > 0) {
		console.log(`能力提示：${warningSet.size} 条细腻标注只能由 Edge 近似表达。`);
	}
	console.log('生成完成。请试听后运行 publish_audio.bat 发布允许的试点回目。');
}

main().catch((error) => {
	const message = error instanceof Error ? error.message : String(error);
	console.error(`\n[错误] ${message}`);
	if (process.env.TTS_DEBUG === '1' && error instanceof Error) console.error(error.stack);
	process.exitCode = error instanceof ChapterInputError ? 2
		: error instanceof AnnotationPendingError ? 3 : 1;
});
