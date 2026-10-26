#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { chapterToAudioCandidates, hashJson, reconcileAudioBlocks, sha256, voiceAnnotationHash } from './audio-blocks.js';
import { normalizeLegacyNoteMarkers, stripFrontmatter } from './chapter-text.js';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import { DoubaoAudioGenerationClient, loadDoubaoCredentials, writeBufferAtomic } from './doubao-client.js';
import { pathExists, readJsonIfExists, replaceFileAtomic, sha256File, writeJsonAtomic, writeTextAtomic, copyFileAtomic } from './files.js';
import {
	applyPronunciationOverrides,
	buildCosyVoiceInstruction,
	passesWhisperStructuralReview,
	pauseAfterSynthesisUnit,
	splitChineseDialogue,
	splitChineseDialogueWithDelivery,
} from './scene-plan.js';
import { limitPcmSilence, stretchInternalPcmSilence, splicePcmSuffix, trimPcmTail } from './wav-silence.js';

const execFileAsync = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHAPTER = '081';
const WSL = 'Ubuntu-22.04';
const WHISPER_PYTHON = '/opt/miniconda3/envs/cosyvoice/bin/python';
const SECTION_CONFIG = join(ROOT, 'content/audio/production/chapters/081/sections.json');
const PENDING_MAP = join(ROOT, 'content/audio/.cache/pending/081.json');
const ANNOTATIONS = join(ROOT, 'content/audio/annotations/081.json');
const APPROVALS = join(ROOT, 'content/audio/.cache/voice-cards/review-decisions.json');
const PROVIDER = join(ROOT, 'content/audio/providers/doubao.json');
const LEGACY_PLAN = join(ROOT, 'content/audio/.cache/doubao/chapters/081/chapter-plan.json');
const LEGACY_MANIFEST = join(ROOT, 'content/audio/.cache/doubao/chapters/081/chapter-manifest.json');
const REVIEW_SCENE_PLAN = join(ROOT, 'content/audio/production/chapters/081/plan.json');

function absolute(relativePath) {
	return resolve(ROOT, ...relativePath.split('/'));
}

function relativePath(path) {
	return relative(ROOT, path).replaceAll('\\', '/');
}

function wslPath(path) {
	const value = resolve(path).replaceAll('\\', '/');
	const match = /^([A-Za-z]):\/(.*)$/u.exec(value);
	return match ? `/mnt/${match[1].toLowerCase()}/${match[2]}` : value;
}

function normalizedText(value) {
	return String(value || '').normalize('NFKC').replace(/[\s\p{P}\p{S}]/gu, '').toLowerCase();
}

export function selectSectionBlocks(blocks, { startAnchor, endAnchor }) {
	const starts = blocks.map((block, index) => block.text.startsWith(startAnchor) ? index : -1).filter((index) => index >= 0);
	const ends = blocks.map((block, index) => block.text.endsWith(endAnchor) ? index : -1).filter((index) => index >= 0);
	if (starts.length !== 1 || ends.length !== 1 || ends[0] < starts[0]) {
		throw new Error(`小节文本锚点不唯一或顺序错误：start=${starts.length}, end=${ends.length}。`);
	}
	return blocks.slice(starts[0], ends[0] + 1);
}

function instructionFor(kind, annotation, delivery, override) {
	const semantic = buildCosyVoiceInstruction(annotation)
		.replace(/<\|endofprompt\|>/gu, '')
		.replace(/[。；;\s]+$/gu, '');
	const role = kind === 'dialogue'
		? '以人物身份自然说话，不读角色名、引号或舞台说明'
		: kind === 'poetry'
			? '以古典章回小说的诗词旁白口吻，保留诗句层次，含蓄而清楚'
			: '以沉稳、含蓄、连贯的古典小说旁白口吻，不用新闻播报腔';
	const extra = [delivery?.instruction, override?.instructionSuffix].filter(Boolean).join(' ');
	return `请${role}；${semantic}；只朗读给定正文，不增加、删减或改写字词。${extra ? ` ${extra}` : ''}`;
}

export function buildSectionTargets({ blocks, annotations, references, provider, section, segmenterVersion }) {
	const targets = [];
	const config = provider.chapterDemo;
	for (const block of blocks) {
		const annotation = annotations[block.blockId];
		if (!annotation || annotation.textHash !== block.textHash || annotation.contextHash !== block.contextHash) {
			throw new Error(`${block.blockId} 与当前标注不对齐。`);
		}
		const referenceKey = section.voiceCardByBlock?.[block.blockId] || annotation.speakerRef;
		const reference = references[referenceKey];
		if (!reference) throw new Error(`${block.blockId} 缺少获批的 ${referenceKey} 音色卡。`);
		const maxChars = block.kind === 'dialogue' ? config.maxDialogueChars : config.maxNarrationChars;
		const units = block.kind === 'dialogue'
			? splitChineseDialogueWithDelivery(block.text, annotation.delivery, maxChars)
			: [...block.text].length > maxChars
				? splitChineseDialogue(block.text, maxChars).map((text) => ({ text }))
				: [{ text: block.text }];
		if (units.map((unit) => unit.text).join('') !== block.text) throw new Error(`${block.blockId} 分句改变了正文。`);
		for (const [unitIndex, unit] of units.entries()) {
			const targetId = `${block.kind}:${block.blockId}:u${String(unitIndex + 1).padStart(2, '0')}`;
			const override = section.targetOverrides?.[targetId] || null;
			const synthesisText = applyPronunciationOverrides(unit.text, annotation.pronunciations);
			const target = {
				targetId, order: targets.length + 1, blockOrder: block.order, blockId: block.blockId,
				unitIndex, kind: block.kind, text: unit.text, synthesisText, textHash: sha256(unit.text),
				blockTextHash: block.textHash, speakerRef: annotation.speakerRef, voiceCardRoute: referenceKey, annotation,
				annotationHash: voiceAnnotationHash(annotation), reference,
				providerOverride: override ? {
					...(override.retryVersion === undefined ? {} : { retryVersion: override.retryVersion }),
					...(override.promptMode ? { promptMode: override.promptMode } : {}),
				} : null,
				instruction: instructionFor(block.kind, annotation, unit.delivery, override),
				assemblyGainDb: section.assemblyGainsDb?.[targetId] || 0,
				normalizationMode: section.normalizationOverrides?.[targetId] || null,
				splitVersion: `${segmenterVersion}:${config.maxNarrationChars}:${config.maxDialogueChars}`,
			};
			targets.push(target);
		}
	}
	for (const [index, target] of targets.entries()) {
		const next = targets[index + 1];
		let pauseAfterMs = 0;
		if (next) {
			if (target.blockId === next.blockId) pauseAfterMs = Math.max(config.pause.withinBlockMs, pauseAfterSynthesisUnit(target.text));
			else if (target.kind === 'poetry') pauseAfterMs = config.pause.afterPoetryMs;
			else if (target.kind !== 'dialogue' && next.kind === 'dialogue') pauseAfterMs = config.pause.narrationToDialogueMs;
			else if (target.kind === 'dialogue' && next.kind !== 'dialogue') pauseAfterMs = config.pause.dialogueToNarrationMs;
			else pauseAfterMs = config.pause.betweenBlocksMs;
		}
		target.pauseAfterMs = section.pauseAfterMs?.[target.targetId] ?? pauseAfterMs;
	}
	return targets;
}

export function buildExcerptTargets(targets, name, profile) {
	if (!/^[a-z0-9-]+$/u.test(name) || (!profile?.targetIds?.length && !profile?.targetRange)) throw new Error('小样名称或片段配置无效。');
	const rangeIds = profile?.targetRange
		? (() => {
			const start = targets.findIndex((target) => target.targetId === profile.targetRange.startTargetId);
			const end = targets.findIndex((target) => target.targetId === profile.targetRange.endTargetId);
			if (start < 0 || end < start) throw new Error('小样目标范围无效。');
			return targets.slice(start, end + 1).map((target) => target.targetId);
		})()
		: profile.targetIds;
	const selectedTargetIds = rangeIds;
	const positions = new Map(targets.map((target, index) => [target.targetId, index]));
	const indexes = selectedTargetIds.map((id) => positions.get(id));
	if (indexes.some((index) => index === undefined) || indexes.some((index, position) => position && index <= indexes[position - 1])) {
		throw new Error('小样片段缺失、重复或不按正文顺序。');
	}
	const verbatim = new Set(profile.verbatimSynthesisText || []);
	if ([...verbatim].some((id) => !selectedTargetIds.includes(id))) throw new Error('小样逐字合成目标不在本小样中。');
	if (Object.keys(profile.sourceOverrides || {}).some((id) => !verbatim.has(id))) throw new Error('小样源音频覆盖必须指向逐字合成目标。');
	if (Object.keys(profile.targetOverrides || {}).some((id) => !selectedTargetIds.includes(id))) throw new Error('小样重录目标不在本小样中。');
	if (Object.keys(profile.tailRepairs || {}).some((id) => !selectedTargetIds.includes(id))) throw new Error('小样尾部修整目标不在本小样中。');
	if (profile.performanceReference && (!profile.performanceReference.id || !profile.performanceReference.path
		|| !/^[a-f0-9]{64}$/u.test(profile.performanceReference.fileHash || ''))) {
		throw new Error('小样表演参考必须包含 id、相对路径和 SHA-256。');
	}
	return selectedTargetIds.map((id) => {
		const target = targets[positions.get(id)];
		const isVerbatim = verbatim.has(id);
		const override = profile.targetOverrides?.[id];
		return { ...target,
			...(profile.performanceReference ? { performanceReference: profile.performanceReference } : {}),
			...(isVerbatim ? {
				synthesisText: target.text,
				instruction: `${target.instruction} ${profile.instructionSuffix || ''}`.trim(),
				providerOverride: { ...target.providerOverride, excerptProfile: `${name}:v${profile.version}` },
			} : {}),
			...(override ? {
				...(override.synthesisText ? { synthesisText: override.synthesisText } : {}),
				instruction: override.instruction || `${target.instruction} ${profile.instructionSuffix || ''}`.trim(),
				providerOverride: { ...target.providerOverride,
					...(isVerbatim ? { excerptProfile: `${name}:v${profile.version}` } : {}),
					retryVersion: override.retryVersion },
			} : {}),
			pauseAfterMs: profile.pauseAfterMs?.[id] ?? target.pauseAfterMs,
		};
	});
}

export function synthesisSpec(target, provider, splitVersion) {
	return {
		version: 'doubao-section-synthesis-v1',
		provider: provider.provider,
		model: provider.audioGenerationApi.model,
		apiVersion: provider.audioGenerationApi.requestVersion,
		targetId: target.targetId,
		blockTextHash: target.blockTextHash,
		textHash: sha256(target.text),
		synthesisText: target.synthesisText,
		annotationHash: target.annotationHash,
		speakerRef: target.speakerRef,
		voiceCardId: target.reference.id,
		voiceCardPath: target.reference.path,
		voiceCardFileHash: target.reference.fileHash,
		voiceCardText: target.reference.text || null,
		...(target.reference.assetKind && target.reference.assetKind !== 'voiceCardWav'
			? { voiceCardAssetKind: target.reference.assetKind } : {}),
		...(target.performanceReference ? { performanceReference: target.performanceReference } : {}),
		instruction: target.instruction,
		providerOverride: target.providerOverride || null,
		splitVersion,
		audioConfig: { format: provider.audio.format, sampleRate: provider.audio.sampleRate, speechRate: 0, loudnessRate: 0, pitchRate: 0, enableSubtitle: true },
	};
}

export function canReuseLegacy(target, oldTarget, fragment) {
	return Boolean(oldTarget && fragment
		&& target.targetId === oldTarget.targetId && target.targetId === fragment.targetId
		&& target.text === oldTarget.text && target.text === fragment.text
		&& target.synthesisText === oldTarget.synthesisText && target.synthesisText === fragment.synthesisText
		&& target.annotationHash === oldTarget.annotationHash && target.annotationHash === fragment.annotationHash
		&& target.instruction === oldTarget.instruction
		&& hashJson(target.performanceReference ?? null) === hashJson(oldTarget.performanceReference ?? null)
		&& hashJson(target.providerOverride ?? null) === hashJson(oldTarget.providerOverride ?? null)
		&& target.reference.id === oldTarget.reference?.id && target.reference.id === fragment.referenceId
		&& target.reference.fileHash === oldTarget.reference?.fileHash && target.reference.fileHash === fragment.referenceFileHash
		&& fragment.subtitleExact === true && fragment.fileHash && fragment.path);
}

export function withCurrentAssemblySettings(cached, target) {
	return { ...cached, pauseAfterMs: target.pauseAfterMs,
		assemblyGainDb: target.assemblyGainDb, normalizationMode: target.normalizationMode };
}

export function shouldConditionArtifact(artifact, conditioning) {
	return Boolean(conditioning) && artifact.approvedAssembly?.preserveReviewedAudio !== true;
}

export function approvedArtifactText(target, source) {
	const synthesisText = source.synthesisText || target.synthesisText;
	return { synthesisText, subtitleText: synthesisText };
}

function assertAssemblyBinding(target, binding, label) {
	if (!target || binding?.textHash !== target.textHash || binding?.annotationHash !== target.annotationHash) {
		throw new Error(`${label} 与当前正文或标注不一致，已停止拼接。`);
	}
}

async function verifyReviewedAssemblySource(source, label) {
	if (!source?.path || !/^[a-f0-9]{64}$/u.test(source.fileHash || '')) {
		throw new Error(`${label} 缺少源路径或 SHA-256。`);
	}
	const sourcePath = absolute(source.path);
	if (!await pathExists(sourcePath) || await sha256File(sourcePath) !== source.fileHash) {
		throw new Error(`${label} 的源音频缺失或哈希不符。`);
	}
	pcmLevels(await readFile(sourcePath));
	const review = source.review;
	const manifest = review?.manifestPath ? await readJsonIfExists(absolute(review.manifestPath)) : null;
	const reviewedOutput = manifest?.output?.[review?.outputKey || 'wav'];
	if (!manifest || reviewedOutput?.path !== review.outputPath || reviewedOutput?.fileHash !== review.outputFileHash
		|| !await pathExists(absolute(review.outputPath))
		|| await sha256File(absolute(review.outputPath)) !== review.outputFileHash) {
		throw new Error(`${label} 无法绑定到已试听成品。`);
	}
	if ((manifest.whisper?.dialoguePassed || 0) < (review.minimumDialoguePassed || 0)) {
		throw new Error(`${label} 的既有 Whisper 验证不足。`);
	}
	return { sourcePath, review: { manifestPath: review.manifestPath, outputKey: review.outputKey || 'wav',
		outputPath: review.outputPath, outputFileHash: review.outputFileHash,
		dialoguePassed: manifest.whisper?.dialoguePassed || 0, whisperPath: manifest.whisper?.path || null } };
}

export async function resolveApprovedAssembly(targets, section) {
	const config = section.approvedAssembly || {};
	const positions = new Map(targets.map((target, index) => [target.targetId, index]));
	const coveredTargetIds = new Set();
	const sourceByTarget = new Map();
	const groupByFirst = new Map();
	const reviewRecords = [];
	for (const [targetId, source] of Object.entries(config.sourceOverrides || {})) {
		const target = targets[positions.get(targetId)];
		assertAssemblyBinding(target, source.binding, `核验入片 ${targetId}`);
		if (coveredTargetIds.has(targetId)) throw new Error(`${targetId} 被重复覆盖。`);
		const verified = await verifyReviewedAssemblySource(source, `核验入片 ${targetId}`);
		coveredTargetIds.add(targetId);
		sourceByTarget.set(targetId, { ...source, ...verified });
		reviewRecords.push({ type: 'source', id: targetId, targetIds: [targetId], fileHash: source.fileHash,
			path: source.path, synthesisText: source.synthesisText || target.synthesisText,
			reason: source.reason, review: verified.review });
	}
	for (const group of config.groupOverrides || []) {
		if (!group?.id || !group.targetIds?.length || group.targetIds.length !== group.bindings?.length) {
			throw new Error('获批组合入片配置不完整。');
		}
		const indexes = group.targetIds.map((targetId) => positions.get(targetId));
		if (indexes.some((index) => index === undefined)
			|| indexes.some((index, position) => position && index !== indexes[position - 1] + 1)) {
			throw new Error(`获批组合入片 ${group.id} 不是当前正文中的连续单元。`);
		}
		for (const [index, targetId] of group.targetIds.entries()) {
			assertAssemblyBinding(targets[indexes[index]], group.bindings[index], `获批组合入片 ${group.id}/${targetId}`);
			if (coveredTargetIds.has(targetId)) throw new Error(`${targetId} 被重复覆盖。`);
			coveredTargetIds.add(targetId);
		}
		const verified = await verifyReviewedAssemblySource(group, `获批组合入片 ${group.id}`);
		const resolved = { ...group, ...verified, indexes };
		groupByFirst.set(group.targetIds[0], resolved);
		reviewRecords.push({ type: 'group', id: group.id, targetIds: group.targetIds, fileHash: group.fileHash,
			path: group.path, reason: group.reason, review: verified.review });
	}
	return { coveredTargetIds, sourceByTarget, groupByFirst, reviewRecords };
}

export async function resolveReviewSceneSources(targets, reviewPlan) {
	const sourceByTarget = new Map();
	if (reviewPlan?.chapter !== CHAPTER || reviewPlan?.scene !== 'xiren-three-opera' || !reviewPlan?.planHash) {
		return sourceByTarget;
	}
	const candidates = new Map((reviewPlan.targets || []).map((item) => [item.targetId, item]));
	for (const target of targets) {
		const source = candidates.get(target.targetId);
		if (!source || source.kind !== 'dialogue_fragment' || source.provider !== 'doubao'
			|| source.unitText !== target.text || source.performance?.synthesisText !== target.synthesisText
			|| target.providerOverride?.retryVersion !== undefined
			|| source.annotationHash !== target.annotationHash
			|| source.voiceCard?.id !== target.reference.id
			|| source.voiceCard?.fileHash !== target.reference.fileHash
			|| source.voiceCard?.cachePath !== target.reference.path
			|| source.automaticCheck?.structuralPass !== true
			|| !source.audio?.cachePath || !/^[a-f0-9]{64}$/u.test(source.audio.fileHash || '')) continue;
		const sourcePath = absolute(source.audio.cachePath);
		if (!await pathExists(sourcePath) || await sha256File(sourcePath) !== source.audio.fileHash) continue;
		sourceByTarget.set(target.targetId, { source, sourcePath, planHash: reviewPlan.planHash });
	}
	return sourceByTarget;
}

function cardPromptText(metadata, assetKind = 'voiceCardWav') {
	if (assetKind === 'sourceReferenceMp3' || assetKind === 'sourceReferenceWav') {
		return metadata?.exactTranscript || metadata?.sourceReferenceText || metadata?.source?.exactTranscript;
	}
	return metadata?.generation?.voiceCardText || metadata?.voiceCardText
		|| metadata?.voiceCard?.text || metadata?.texts?.voiceCard;
}

function metadataVoiceCardHashes(metadata, assetKind = 'voiceCardWav') {
	const hashes = new Set();
	if (assetKind === 'sourceReferenceMp3' && /^[a-f0-9]{64}$/u.test(metadata?.files?.sourceReferenceMp3?.sha256 || '')) {
		hashes.add(metadata.files.sourceReferenceMp3.sha256);
	}
	if (assetKind === 'sourceReferenceWav' && /^[a-f0-9]{64}$/u.test(metadata?.files?.sourceReferenceWav?.sha256 || '')) {
		hashes.add(metadata.files.sourceReferenceWav.sha256);
	}
	if (/^[a-f0-9]{64}$/u.test(metadata?.voiceCard?.sha256 || '')) hashes.add(metadata.voiceCard.sha256);
	for (const [name, file] of Object.entries(metadata?.files || {})) {
		if (/voicecard.*wav/iu.test(name) && /^[a-f0-9]{64}$/u.test(file?.sha256 || '')) hashes.add(file.sha256);
	}
	return hashes;
}

export async function verifiedReferences(section, decisions) {
	const disabledCards = await readJsonIfExists(absolute('content/audio/voice-cards/disabled-cards.json'));
	const approved = new Map(decisions.decisions.filter((item) => item.decision === 'approved-by-user').map((item) => [item.id, item]));
	const references = {};
	for (const [speakerRef, config] of Object.entries(section.voiceCards || {})) {
		const decision = approved.get(config.approvalId);
		const assetKind = config.assetKind || 'voiceCardWav';
		const approvedHash = assetKind === 'sourceReferenceMp3'
			? decision?.reviewedAudio?.sourceSha256
			: assetKind === 'sourceReferenceWav'
				? decision?.reviewedAudio?.sourceWavSha256
				: decision?.reviewedAudio?.voiceCardWavSha256;
		const localSelection = config.localDraftSelection;
		const scopedDraftSelection = !approvedHash && localSelection?.scope === `${CHAPTER}:${section.id}:draft`;
		if (!approvedHash && !scopedDraftSelection) throw new Error(`${speakerRef} 没有绑定 WAV 哈希的人工批准或本节草稿选卡记录。`);
		const metadata = await readJsonIfExists(absolute(config.generationPath));
		const text = cardPromptText(metadata, assetKind);
		if (!text) throw new Error(`${speakerRef} 的元数据缺少音色卡准确文本。`);
		const fileHash = await sha256File(absolute(config.path));
		if (disabledCards?.cards?.some(card => card.fileHash === fileHash && card.status === 'disabled-by-user')) throw new Error(`${speakerRef} 声卡已被用户禁用：${fileHash}`);
		if (fileHash !== (approvedHash || localSelection.fileHash)) throw new Error(`${speakerRef} 的音色卡已变化，选卡记录失效。`);
		if (scopedDraftSelection && !metadataVoiceCardHashes(metadata, assetKind).has(fileHash)) {
			throw new Error(`${speakerRef} 本节草稿卡的元数据哈希不符。`);
		}
		references[speakerRef] = { id: config.id, approvalId: approvedHash ? config.approvalId : null,
			...(scopedDraftSelection ? { selectionId: config.approvalId, selectionStatus: 'user-selected-local-draft' } : {}),
			...(config.proxyNote ? { proxyNote: config.proxyNote } : {}), path: config.path, fileHash, text,
			assetKind };
	}
	const narrator = section.narratorReference;
	if (!narrator || await sha256File(absolute(narrator.path)) !== narrator.fileHash) {
		throw new Error('豆包旁白参考音频缺失或哈希不符。');
	}
	references.$narrator = { ...narrator, text: null };
	return references;
}

async function wsl(command, arguments_, options = {}) {
	return execFileAsync('wsl.exe', ['-d', WSL, '--', command, ...arguments_], {
		windowsHide: true,
		maxBuffer: 16 * 1024 * 1024,
		...options,
	});
}

async function ffmpeg(arguments_) {
	try {
		return await wsl('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...arguments_]);
	} catch (error) {
		throw new Error(`FFmpeg 失败：${error.stderr || error.message}`, { cause: error });
	}
}

async function probe(path) {
	const { stdout } = await wsl('ffprobe', [
		'-v', 'error', '-select_streams', 'a:0',
		'-show_entries', 'stream=codec_name,sample_rate,channels:format=duration,size',
		'-of', 'json', wslPath(path),
	]);
	const data = JSON.parse(stdout);
	const stream = data.streams?.[0];
	if (!stream) throw new Error(`${path} 没有音轨。`);
	return { codec: stream.codec_name, sampleRate: Number(stream.sample_rate), channels: Number(stream.channels), durationSeconds: Number(data.format.duration), bytes: Number(data.format.size) };
}

export async function validateWav(path) {
	const info = await probe(path);
	if (info.codec !== 'pcm_s16le' || info.sampleRate !== 24000 || info.channels !== 1 || info.durationSeconds <= 0.15) {
		throw new Error(`${path} 不是有效的 24 kHz 单声道 PCM16 片段。`);
	}
	await ffmpeg(['-xerror', '-i', wslPath(path), '-f', 'null', '-']);
	return info;
}

async function normalizeWav(source, output, provider, mode = null) {
	await mkdir(dirname(output), { recursive: true });
	const temporary = `${output}.${process.pid}.tmp.wav`;
	const monoSource = `${output}.${process.pid}.source-mono.tmp.wav`;
	try {
		let filter = `loudnorm=I=${provider.audio.targetLufs}:TP=${provider.audio.truePeakDbfs}:LRA=7`;
		let input = source;
		if (mode === 'short-safe-peak-v1') {
			await ffmpeg(['-i', wslPath(source), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wslPath(monoSource)]);
			await validateWav(monoSource);
			const level = pcmLevels(await readFile(monoSource));
			if (level.activeWindowRatio < 0.12 || level.activeRmsDbfs < -43) throw new Error(`${source} 原始短句近乎静音，不能靠增益补救。`);
			const gainDb = Math.max(-6, Math.min(6, -24 - level.activeRmsDbfs, -3 - level.peakDbfs));
			filter = `volume=${gainDb.toFixed(2)}dB`;
			input = monoSource;
		} else if (mode) throw new Error(`未知短片段标准化模式 ${mode}。`);
		await ffmpeg(['-i', wslPath(input), '-ac', '1', '-ar', '24000', '-af', filter,
			'-c:a', 'pcm_s16le', wslPath(temporary)]);
		await validateWav(temporary);
		await replaceFileAtomic(temporary, output);
	} finally {
		await Promise.all([rm(temporary, { force: true }), rm(monoSource, { force: true })]);
	}
}

function subtitleText(value) {
	if (typeof value === 'string') return value;
	if (Array.isArray(value)) return value.map(subtitleText).sort((a, b) => b.length - a.length)[0] || '';
	if (value && typeof value === 'object') return typeof value.text === 'string' ? value.text : subtitleText(Object.values(value));
	return '';
}

export async function renderTarget(target, provider, client, directory, oldTarget, oldFragment) {
	const spec = synthesisSpec(target, provider, target.splitVersion);
	const synthesisHash = hashJson(spec);
	const renderHash = hashJson({ synthesisHash, normalization: provider.audio,
		...(target.normalizationMode ? { normalizationMode: target.normalizationMode } : {}) });
	const output = join(directory, 'fragments', `${renderHash}.wav`);
	const metadataPath = `${output}.json`;
	const source = join(directory, 'fragments', `${synthesisHash}.source.wav`);
	const cached = await readJsonIfExists(metadataPath);
	if (cached?.renderHash === renderHash && await pathExists(output)
		&& cached.fileHash === await sha256File(output)) {
		await validateWav(output);
		return { ...withCurrentAssemblySettings(cached, target), pathAbsolute: output, cacheType: 'section' };
	}
	if (target.normalizationMode && await pathExists(source)) {
		const previousHash = hashJson({ synthesisHash, normalization: provider.audio });
		const previous = await readJsonIfExists(join(directory, 'fragments', `${previousHash}.wav.json`));
		if (previous?.synthesisHash === synthesisHash && previous.subtitleExact === true
			&& previous.synthesisText === target.synthesisText) {
			await normalizeWav(source, output, provider, target.normalizationMode);
			const info = await validateWav(output);
			const artifact = { ...target, synthesisHash, renderHash, fileHash: await sha256File(output),
				path: relativePath(output), durationSeconds: info.durationSeconds,
				subtitleText: previous.subtitleText, subtitleExact: true, cacheType: 'renormalized',
				sourceSynthesisHash: synthesisHash, sourceRequest: previous.request };
			await writeJsonAtomic(metadataPath, artifact);
			return { ...artifact, pathAbsolute: output };
		}
	}
	if (canReuseLegacy(target, oldTarget, oldFragment)) {
		const path = absolute(oldFragment.path);
		if (await pathExists(path) && await sha256File(path) === oldFragment.fileHash) {
			if (target.normalizationMode) {
				await normalizeWav(path, output, provider, target.normalizationMode);
				const info = await validateWav(output);
				const artifact = { ...target, synthesisHash, renderHash, fileHash: await sha256File(output),
					path: relativePath(output), durationSeconds: info.durationSeconds,
					subtitleText: oldFragment.subtitleText, subtitleExact: true,
					cacheType: 'legacy-renormalized', sourceSynthesisHash: oldFragment.synthesisHash,
					sourceLegacyPath: oldFragment.path, sourceLegacyFileHash: oldFragment.fileHash };
				await writeJsonAtomic(metadataPath, artifact);
				return { ...artifact, pathAbsolute: output };
			}
			const info = await validateWav(path);
			return { ...target, synthesisHash, renderHash, fileHash: oldFragment.fileHash,
				path: oldFragment.path, pathAbsolute: path, durationSeconds: info.durationSeconds,
				subtitleText: oldFragment.subtitleText, subtitleExact: true, cacheType: 'legacy-verified',
				sourceSynthesisHash: oldFragment.synthesisHash };
		}
	}
	const referenceData = (await readFile(absolute(target.reference.path))).toString('base64');
	const requestReferences = [{ audio_data: referenceData }];
	if (target.performanceReference) {
		const performancePath = absolute(target.performanceReference.path);
		if (!await pathExists(performancePath)
			|| await sha256File(performancePath) !== target.performanceReference.fileHash) {
			throw new Error(`${target.targetId} 的表演参考缺失或哈希不符。`);
		}
		requestReferences.push({ audio_data: (await readFile(performancePath)).toString('base64') });
	}
	const performanceGuidance = target.performanceReference?.guidance
		|| '语速、停顿、怅然情绪和问句尾音';
	const performancePrompt = target.performanceReference?.sameSpeaker
		? `请同时参考@音频1和@音频2，它们属于同一人物；以@音频1作为标准音色，以@音频2保持${performanceGuidance}。${target.instruction}正文：“${target.synthesisText}”`
		: `请参考@音频1的说话人身份和音色；参考@音频2的${performanceGuidance}，但绝不使用@音频2的说话人音色。${target.instruction}正文：“${target.synthesisText}”`;
	const textPrompt = target.providerOverride?.promptMode === 'strict-text'
		? `请参考@音频1的说话人音色。${target.instruction} 必须直接朗读双引号内正文，正文前后保持静音，不说提示语，不加语气词，不续写。正文：“${target.synthesisText}”`
		: target.performanceReference
			? performancePrompt
			: `请参考@音频1的说话人身份和音色，${target.instruction}正文：“${target.synthesisText}”`;
	const started = Date.now();
	const response = await client.synthesize({
		model: provider.audioGenerationApi.model,
		text_prompt: textPrompt,
		references: requestReferences,
		audio_config: { format: 'wav', sample_rate: 24000, speech_rate: 0, loudness_rate: 0, pitch_rate: 0, enable_subtitle: true },
	});
	await writeBufferAtomic(source, response.audio);
	const transcript = subtitleText(response.subtitle);
	if (normalizedText(transcript) !== normalizedText(target.synthesisText)) {
		throw new Error(`${target.targetId} 的豆包字幕不符；原始失败样本已保留：${JSON.stringify(transcript)}`);
	}
	await normalizeWav(source, output, provider, target.normalizationMode);
	const info = await validateWav(output);
	const artifact = { ...target, synthesisHash, renderHash, fileHash: await sha256File(output),
		path: relativePath(output), durationSeconds: info.durationSeconds, subtitleText: transcript,
		subtitleExact: true, cacheType: 'generated', synthesisSeconds: Number(((Date.now() - started) / 1000).toFixed(2)),
		request: { requestId: response.requestId, logId: response.logId, attempt: response.attempt } };
	await writeJsonAtomic(metadataPath, artifact);
	return { ...artifact, pathAbsolute: output };
}

async function whisperCheck(artifacts, directory) {
	const selected = artifacts.filter((item) => item.kind === 'dialogue'
		|| ['081-b0001', '081-b0003', '081-b0004', '081-b0012', '081-b0010', '081-b0021'].includes(item.blockId));
	const jobsPath = join(directory, 'whisper-jobs.json');
	const outputPath = join(directory, 'whisper-validation.json');
	await writeJsonAtomic(jobsPath, { version: 1, jobs: selected.map((item) => ({
		id: item.targetId, blockId: item.blockId, unitIndex: item.unitIndex,
		voiceCardId: item.reference.id, kind: item.kind,
		path: wslPath(item.pathAbsolute), expectedText: item.synthesisText,
	})) });
	await wsl(WHISPER_PYTHON, [wslPath(join(ROOT, 'scripts/audio/whisper_validate.py')),
		'--jobs', wslPath(jobsPath), '--output', wslPath(outputPath), '--model', 'small']);
	const report = await readJsonIfExists(outputPath);
	if (report?.results?.length !== selected.length) throw new Error('Whisper 结果缺失。');
	const failures = report.results.filter((item) => item.kind === 'dialogue' && !passesWhisperStructuralReview(item));
	if (failures.length) throw new Error(`Whisper 发现 ${failures.length} 个对白待返工：${failures.map((item) => item.id).join('、')}。`);
	return { path: relativePath(outputPath), checked: selected.length, dialoguePassed: report.results.filter((item) => item.kind === 'dialogue').length,
		results: report.results.map((item) => ({ id: item.id, kind: item.kind, status: item.status,
			transcript: item.transcript, characterSimilarity: item.characterSimilarity,
			structuralPass: passesWhisperStructuralReview(item) })) };
}

export function pcmLevels(buffer, gainDb = 0) {
	if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') throw new Error('不是 WAV。');
	let position = 12;
	let data;
	while (position + 8 <= buffer.length) {
		const tag = buffer.toString('ascii', position, position + 4);
		const length = buffer.readUInt32LE(position + 4);
		if (tag === 'data') { data = buffer.subarray(position + 8, position + 8 + length); break; }
		position += 8 + length + (length % 2);
	}
	if (!data || data.length < 4800) throw new Error('WAV 没有足够 PCM 数据。');
	const windowSamples = 480;
	const windows = [];
	let peak = 0;
	for (let start = 0; start < data.length / 2; start += windowSamples) {
		let squared = 0;
		const count = Math.min(windowSamples, data.length / 2 - start);
		for (let index = 0; index < count; index += 1) {
			const sample = data.readInt16LE((start + index) * 2) / 32768;
			peak = Math.max(peak, Math.abs(sample));
			squared += sample * sample;
		}
		windows.push(20 * Math.log10(Math.max(1e-8, Math.sqrt(squared / count))) + gainDb);
	}
	const active = windows.filter((value) => value > -48).sort((a, b) => a - b);
	return { activeRmsDbfs: active.length ? Number(active[Math.floor(active.length / 2)].toFixed(2)) : -160,
		peakDbfs: Number((20 * Math.log10(Math.max(1e-8, peak)) + gainDb).toFixed(2)),
		activeWindowRatio: Number((active.length / windows.length).toFixed(3)) };
}

function assemblyLevels(buffer, gainDb = 0) {
	const source = pcmLevels(buffer);
	const assembled = gainDb ? pcmLevels(buffer, gainDb) : source;
	return {
		activeRmsDbfs: assembled.activeRmsDbfs,
		peakDbfs: assembled.peakDbfs,
		activeWindowRatio: assembled.activeWindowRatio,
		sourceActiveRmsDbfs: source.activeRmsDbfs,
		sourcePeakDbfs: source.peakDbfs,
		assemblyGainDb: gainDb,
	};
}

async function loudness(path, master) {
	const { stderr } = await wsl('ffmpeg', ['-hide_banner', '-nostats', '-i', wslPath(path),
		'-af', `loudnorm=I=${master.targetLufs}:TP=${master.truePeakDbfs}:LRA=${master.loudnessRange}:print_format=json`,
		'-f', 'null', '-']);
	const match = /\{\s*"input_i"[\s\S]*?\}/u.exec(stderr);
	if (!match) throw new Error('无法解析响度测量。');
	return JSON.parse(match[0]);
}

async function prepareExcerptArtifact(artifact, excerptDirectory, policy, pauseTargetsMs = null,
	suffixReplacement = null, tailRepair = null) {
	if (suffixReplacement && (!artifact.text.endsWith(suffixReplacement.text)
		|| await sha256File(absolute(suffixReplacement.path)) !== suffixReplacement.fileHash)) {
		throw new Error(`${artifact.targetId} 句尾替换文字或源文件哈希不符。`);
	}
	const trimHash = hashJson({ version: 'pcm-silence-limit-v2', sourceFileHash: artifact.fileHash, policy, pauseTargetsMs,
		...(suffixReplacement ? { suffixReplacement } : {}), ...(tailRepair ? { tailRepair } : {}) });
	const output = join(excerptDirectory, 'fragments', `${trimHash}.wav`);
	const metadataPath = `${output}.json`;
	const cached = await readJsonIfExists(metadataPath);
	if (cached?.trimHash === trimHash && await pathExists(output) && cached.fileHash === await sha256File(output)) {
		await validateWav(output);
		return { ...artifact, ...cached, pathAbsolute: output, trimCacheType: 'excerpt' };
	}
	const limited = limitPcmSilence(await readFile(artifact.pathAbsolute), policy);
	const stretched = pauseTargetsMs
		? stretchInternalPcmSilence(limited.wav, pauseTargetsMs, policy.thresholdDbfs)
		: { wav: limited.wav, additions: [] };
	const repaired = suffixReplacement
		? splicePcmSuffix(stretched.wav, await readFile(absolute(suffixReplacement.path)), suffixReplacement, policy.thresholdDbfs)
		: stretched;
	const tailRepaired = tailRepair ? trimPcmTail(repaired.wav, tailRepair.endSeconds, tailRepair.fadeOutMs) : repaired;
	const temporary = `${output}.${process.pid}.tmp.wav`;
	try {
		await writeBufferAtomic(temporary, tailRepaired.wav);
		await validateWav(temporary);
		await replaceFileAtomic(temporary, output);
	} finally {
		await rm(temporary, { force: true });
	}
	const info = await validateWav(output);
	const prepared = { trimHash, sourceFileHash: artifact.fileHash, fileHash: await sha256File(output),
		path: relativePath(output), durationSeconds: info.durationSeconds,
		silenceCuts: limited.cuts, pauseAdditions: stretched.additions,
		...(suffixReplacement ? { suffixReplacement: { ...suffixReplacement, ...repaired.splice } } : {}),
		...(tailRepair ? { tailRepair: { ...tailRepair, ...tailRepaired.repair } } : {}) };
	await writeJsonAtomic(metadataPath, prepared);
	return { ...artifact, ...prepared, pathAbsolute: output, trimCacheType: 'generated' };
}

export async function compose(artifacts, provider, directory, options = {}) {
	const silence = new Map();
	const lines = [];
	for (let index = 0; index < artifacts.length; index += 1) {
		const artifact = artifacts[index];
		let inputPath = artifact.pathAbsolute;
		if (artifact.assemblyGainDb) {
			const gainHash = hashJson({ fileHash: artifact.fileHash, gainDb: artifact.assemblyGainDb });
			const gained = join(directory, 'assembly', `${gainHash}.wav`);
			if (!await pathExists(gained)) {
				await mkdir(dirname(gained), { recursive: true });
				const temporary = `${gained}.${process.pid}.tmp.wav`;
				try {
					await ffmpeg(['-i', wslPath(inputPath), '-af', `volume=${artifact.assemblyGainDb}dB`, '-c:a', 'pcm_s16le', wslPath(temporary)]);
					await validateWav(temporary);
					await replaceFileAtomic(temporary, gained);
				} finally {
					await rm(temporary, { force: true });
				}
			}
			await validateWav(gained);
			inputPath = gained;
		}
		lines.push(`file '${wslPath(inputPath).replaceAll("'", "'\\''")}'`);
		if (index < artifacts.length - 1 && artifact.pauseAfterMs > 0) {
			const ms = artifact.pauseAfterMs;
			let path = silence.get(ms);
			if (!path) {
				path = join(directory, 'silence', `${ms}ms.wav`);
				await mkdir(dirname(path), { recursive: true });
				if (!await pathExists(path)) await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=24000:cl=mono', '-t', (ms / 1000).toFixed(3), '-c:a', 'pcm_s16le', wslPath(path)]);
				silence.set(ms, path);
			}
			lines.push(`file '${wslPath(path)}'`);
		}
	}
	const concatPath = join(directory, 'concat.txt');
	await writeTextAtomic(concatPath, `${lines.join('\n')}\n`);
	const premaster = join(directory, 'premaster.wav');
	await ffmpeg(['-f', 'concat', '-safe', '0', '-i', wslPath(concatPath), '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wslPath(premaster)]);
	await validateWav(premaster);
	let masterInput = premaster;
	if (options.tempoFactor !== undefined && options.tempoFactor !== 1) {
		if (!Number.isFinite(options.tempoFactor) || options.tempoFactor < 0.9 || options.tempoFactor > 1.1) {
			throw new Error('小样变速只能在 0.9–1.1 倍之间。');
		}
		const tempoHash = hashJson({ version: 'excerpt-atempo-v1', fileHash: await sha256File(premaster), factor: options.tempoFactor });
		const tempoPath = join(directory, 'tempo', `${tempoHash}.wav`);
		if (!await pathExists(tempoPath)) {
			await mkdir(dirname(tempoPath), { recursive: true });
			const temporary = `${tempoPath}.${process.pid}.tmp.wav`;
			try {
				await ffmpeg(['-i', wslPath(premaster), '-af', `atempo=${options.tempoFactor}`,
					'-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wslPath(temporary)]);
				await validateWav(temporary);
				await replaceFileAtomic(temporary, tempoPath);
			} finally {
				await rm(temporary, { force: true });
			}
		}
		await validateWav(tempoPath);
		masterInput = tempoPath;
	}
	const measured = await loudness(masterInput, provider.chapterDemo.master);
	const master = provider.chapterDemo.master;
	const filter = `loudnorm=I=${master.targetLufs}:TP=${master.truePeakDbfs}:LRA=${master.loudnessRange}:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
	const wav = join(directory, 'scene.wav');
	const mp3 = join(directory, 'scene.mp3');
	const mp3SampleRate = 48000;
	const mp3BitrateKbps = provider.chapterDemo.mp3BitrateKbps || 128;
	const wavTmp = `${wav}.${process.pid}.tmp.wav`;
	const mp3Tmp = `${mp3}.${process.pid}.tmp.mp3`;
	try {
		await ffmpeg(['-i', wslPath(masterInput), '-af', filter, '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le', wslPath(wavTmp)]);
		await ffmpeg(['-i', wslPath(wavTmp), '-ac', '1', '-ar', String(mp3SampleRate),
			'-c:a', 'libmp3lame', '-b:a', `${mp3BitrateKbps}k`, wslPath(mp3Tmp)]);
		await validateWav(wavTmp);
		await ffmpeg(['-xerror', '-i', wslPath(mp3Tmp), '-f', 'null', '-']);
		const mp3Info = await probe(mp3Tmp);
		if (mp3Info.codec !== 'mp3' || mp3Info.sampleRate !== mp3SampleRate || mp3Info.channels !== 1) throw new Error('最终 MP3 格式不正确。');
		await replaceFileAtomic(wavTmp, wav);
		await replaceFileAtomic(mp3Tmp, mp3);
	} finally {
		await Promise.all([rm(wavTmp, { force: true }), rm(mp3Tmp, { force: true })]);
	}
	return { wav: { path: relativePath(wav), fileHash: await sha256File(wav), ...await probe(wav) },
		mp3: { path: relativePath(mp3), fileHash: await sha256File(mp3), ...await probe(mp3) },
		loudness: await loudness(wav, master) };
}

async function approvedSourceArtifact(target, source) {
	const info = await validateWav(source.sourcePath);
	return { ...target, ...approvedArtifactText(target, source),
		fileHash: source.fileHash, path: source.path, pathAbsolute: source.sourcePath,
		durationSeconds: info.durationSeconds, subtitleExact: true,
		assemblyGainDb: source.assemblyGainDb ?? target.assemblyGainDb,
		cacheType: 'approved-assembly-source', approvedAssembly: {
			status: source.status, reason: source.reason, review: source.review,
			preserveReviewedAudio: source.preserveReviewedAudio === true,
		} };
}

async function reviewSceneSourceArtifact(target, verified) {
	const info = await validateWav(verified.sourcePath);
	const source = verified.source;
	return { ...target, instruction: source.performance.instruction,
		fileHash: source.audio.fileHash, path: source.audio.cachePath, pathAbsolute: verified.sourcePath,
		durationSeconds: info.durationSeconds, subtitleText: source.automaticCheck.transcript,
		subtitleExact: true, cacheType: 'review-scene-verified', reviewState: source.reviewState,
		reviewSceneSource: { planHash: verified.planHash, reviewKey: source.reviewKey,
			renderHash: source.audio.renderHash, performance: source.performance,
			automaticCheck: source.automaticCheck } };
}

async function approvedGroupArtifact(targets, group) {
	const info = await validateWav(group.sourcePath);
	const members = group.indexes.map((index) => targets[index]);
	const last = members.at(-1);
	return {
		targetId: `assembly-group:${group.id}`,
		targetIds: group.targetIds,
		order: members[0].order,
		blockIds: [...new Set(members.map((item) => item.blockId))],
		kind: 'approved-assembly-group',
		text: members.map((item) => item.text).join(''),
		synthesisText: members.map((item) => item.synthesisText).join(''),
		textHash: hashJson(members.map((item) => item.textHash)),
		annotationHash: hashJson(members.map((item) => item.annotationHash)),
		speakerRef: '$approved-group',
		speakerRefs: [...new Set(members.map((item) => item.speakerRef))],
		fileHash: group.fileHash,
		path: group.path,
		pathAbsolute: group.sourcePath,
		durationSeconds: info.durationSeconds,
		pauseAfterMs: last.pauseAfterMs,
		assemblyGainDb: group.assemblyGainDb || 0,
		normalizationMode: null,
		subtitleExact: true,
		cacheType: 'approved-assembly-group',
		approvedAssembly: { status: group.status, reason: group.reason, review: group.review,
			preserveReviewedAudio: group.preserveReviewedAudio === true },
	};
}

async function main() {
	const arguments_ = process.argv.slice(2);
	const chapter = arguments_.find((value, index) => arguments_[index - 1] === '--chapter') || CHAPTER;
	const sectionId = arguments_.find((value, index) => arguments_[index - 1] === '--section') || '01';
	const planOnly = arguments_.includes('--plan-only');
	const excerptName = arguments_.find((value, index) => arguments_[index - 1] === '--excerpt');
	if (arguments_.includes('--excerpt') && !excerptName) throw new Error('--excerpt 需要小样名称。');
	if (chapter !== CHAPTER) throw new Error('当前小节录音器只支持第 081 回。');
	const [sections, pending, annotations, decisions, provider, oldPlan, oldManifest, reviewScenePlan] = await Promise.all([
		readJsonIfExists(SECTION_CONFIG), readJsonIfExists(PENDING_MAP), readJsonIfExists(ANNOTATIONS),
		readJsonIfExists(APPROVALS), readJsonIfExists(PROVIDER), readJsonIfExists(LEGACY_PLAN), readJsonIfExists(LEGACY_MANIFEST),
		readJsonIfExists(REVIEW_SCENE_PLAN),
	]);
	const section = sections?.sections?.find((item) => item.id === sectionId);
	if (!section?.voiceCards || !section?.narratorReference) throw new Error(`第 ${sectionId} 节尚未配置音色卡。`);
	if (!pending?.blocks || !annotations?.annotations || !oldPlan?.targets || !oldManifest?.fragments || !decisions?.decisions) throw new Error('章节分块、标注、旧生成计划或音色卡审批记录缺失。');
	const sourceFileHash = await sha256File(absolute(pending.source));
	const sourceText = await readFile(absolute(pending.source), 'utf8');
	const candidates = chapterToAudioCandidates(compileChapter(
		normalizeLegacyNoteMarkers(stripFrontmatter(sourceText)), { sourceName: pending.source },
	));
	const current = reconcileAudioBlocks(chapter, candidates, pending);
	const blocks = selectSectionBlocks(current.blocks, section);
	const previousBlocks = new Map(pending.blocks.map((item) => [item.blockId, item]));
	const alignment = blocks.map((block) => {
		const previous = previousBlocks.get(block.blockId);
		const exact = previous?.kind === block.kind && previous.text === block.text
			&& previous.textHash === block.textHash && previous.contextHash === block.contextHash;
		return { blockId: block.blockId, exact, matchStatus: block.matchStatus,
			textHash: block.textHash, contextHash: block.contextHash };
	});
	const unaligned = alignment.filter((item) => !item.exact);
	if (unaligned.length) throw new Error(`当前正文的第一节有 ${unaligned.length} 块无法与旧缓存及标注精确对齐：${unaligned.map((item) => item.blockId).join('、')}。`);
	const references = await verifiedReferences(section, decisions);
	const oldTargets = new Map(oldPlan.targets.map((item) => [item.targetId, item]));
	const oldFragments = new Map(oldManifest.fragments.map((item) => [item.targetId, item]));
	const targets = buildSectionTargets({ blocks, annotations: annotations.annotations, references, provider, section,
		segmenterVersion: pending.segmenterVersion });
	const directory = join(ROOT, 'content/audio/.cache/doubao/sections/081', sectionId);
	if (excerptName) {
		const profile = section.excerpts?.[excerptName];
		const excerptTargets = buildExcerptTargets(targets, excerptName, profile);
		const excerptDirectory = join(directory, 'excerpts', excerptName);
		const currentSectionManifest = await readJsonIfExists(join(directory, 'scene-manifest.json'));
		const approvedAssembly = await resolveApprovedAssembly(excerptTargets, { approvedAssembly: profile.approvedAssembly });
		const reviewSceneSources = await resolveReviewSceneSources(excerptTargets, reviewScenePlan);
		const sourceOverrides = new Map();
		for (const [id, override] of Object.entries(profile.sourceOverrides || {})) {
			const target = excerptTargets.find((item) => item.targetId === id);
			const source = currentSectionManifest?.fragments?.find((item) => item.targetId === id);
			if (override.source !== 'current-section-manifest' || !target || !source
				|| source.text !== target.text || source.speakerRef !== target.speakerRef
				|| source.annotationHash !== target.annotationHash || source.fileHash !== override.fileHash
				|| !await pathExists(absolute(source.path)) || await sha256File(absolute(source.path)) !== override.fileHash) {
				throw new Error(`${id} 的小样旧入片不可信或已变化。`);
			}
			sourceOverrides.set(id, { source, override });
		}
		const cached = new Set((await Promise.all(excerptTargets.map(async (target) => {
			if (sourceOverrides.has(target.targetId) || approvedAssembly.coveredTargetIds.has(target.targetId)
				|| reviewSceneSources.has(target.targetId)) return null;
			const synthesisHash = hashJson(synthesisSpec(target, provider, target.splitVersion));
			const renderHash = hashJson({ synthesisHash, normalization: provider.audio,
				...(target.normalizationMode ? { normalizationMode: target.normalizationMode } : {}) });
			const output = join(directory, 'fragments', `${renderHash}.wav`);
			const metadata = await readJsonIfExists(`${output}.json`);
			return metadata?.renderHash === renderHash && await pathExists(output)
				&& metadata.fileHash === await sha256File(output) ? target.targetId : null;
		}))).filter(Boolean));
		const legacyCount = excerptTargets.filter((target) => !sourceOverrides.has(target.targetId)
			&& !approvedAssembly.coveredTargetIds.has(target.targetId)
			&& !reviewSceneSources.has(target.targetId) && !cached.has(target.targetId)
			&& canReuseLegacy(target, oldTargets.get(target.targetId), oldFragments.get(target.targetId))).length;
		console.log(`第 ${sectionId} 节小样 ${excerptName}：${excerptTargets.length} 单元；正文对齐 ${alignment.length}/${blocks.length}；片段缓存 ${cached.size}，获批入片 ${approvedAssembly.coveredTargetIds.size}，争吵试听复用 ${reviewSceneSources.size}，旧章候选 ${legacyCount}，核验旧入片 ${sourceOverrides.size}，待合成 ${excerptTargets.length - cached.size - legacyCount - sourceOverrides.size - approvedAssembly.coveredTargetIds.size - reviewSceneSources.size}。`);
		if (planOnly) return;
		await mkdir(excerptDirectory, { recursive: true });
		const excerptPlan = { version: 1, chapter, sectionId, excerptName, status: profile.status,
			source: { path: pending.source, fileHash: sourceFileHash }, profile,
			targets: excerptTargets.map((target) => ({ ...target,
				...(sourceOverrides.has(target.targetId)
					? { sourceOverride: sourceOverrides.get(target.targetId).override }
					: { synthesisSpec: synthesisSpec(target, provider, target.splitVersion) }) })) };
		await writeJsonAtomic(join(excerptDirectory, 'preview-plan.json'), { ...excerptPlan, planHash: hashJson(excerptPlan) });
		const credentials = await loadDoubaoCredentials(ROOT);
		const client = new DoubaoAudioGenerationClient({ apiKey: credentials.apiKey, endpoint: provider.audioGenerationApi.endpoint });
		const sourceArtifacts = [];
		for (let index = 0; index < excerptTargets.length;) {
			const target = excerptTargets[index];
			const verified = sourceOverrides.get(target.targetId);
			const reviewSource = reviewSceneSources.get(target.targetId);
			const group = approvedAssembly.groupByFirst.get(target.targetId);
			let artifact;
			if (group) {
				artifact = await approvedGroupArtifact(excerptTargets, group);
				index += group.targetIds.length;
			} else if (approvedAssembly.sourceByTarget.has(target.targetId)) {
				artifact = await approvedSourceArtifact(target, approvedAssembly.sourceByTarget.get(target.targetId));
				index += 1;
			} else if (verified) {
				artifact = { ...verified.source, pauseAfterMs: target.pauseAfterMs, cacheType: 'verified-section-source',
					previewSourceOverride: verified.override, pathAbsolute: absolute(verified.source.path) };
				index += 1;
			} else if (reviewSource) {
				artifact = await reviewSceneSourceArtifact(target, reviewSource);
				index += 1;
			} else {
				artifact = await renderTarget(target, provider, client, directory, oldTargets.get(target.targetId), oldFragments.get(target.targetId));
				index += 1;
			}
			sourceArtifacts.push(artifact);
			console.log(`[${sourceArtifacts.length}/${excerptTargets.length}] ${target.targetId}：${artifact.cacheType}`);
		}
		const artifacts = [];
		for (const artifact of sourceArtifacts) {
			artifacts.push(artifact.approvedAssembly?.preserveReviewedAudio
				? { ...artifact, trimCacheType: 'preserved-reviewed-audio' }
				: await prepareExcerptArtifact(artifact, excerptDirectory,
					profile.silencePolicy, profile.sourceOverrides?.[artifact.targetId]?.internalPauseTargetsMs,
					profile.sourceOverrides?.[artifact.targetId]?.suffixReplacement, profile.tailRepairs?.[artifact.targetId]));
		}
		const levels = [];
		for (const artifact of artifacts) {
			const level = pcmLevels(await readFile(artifact.pathAbsolute));
			levels.push({ targetId: artifact.targetId, ...level });
			if (level.activeRmsDbfs < -43 || level.peakDbfs > -0.3 || level.activeWindowRatio < 0.12) {
				throw new Error(`${artifact.targetId} 小样疑似静音、削波或严重截断。`);
			}
		}
		const whisper = await whisperCheck(artifacts, excerptDirectory);
		const output = await compose(artifacts, provider, excerptDirectory, { tempoFactor: profile.tempoFactor });
		const manifest = { version: 1, chapter, sectionId, excerptName, status: 'draft-for-user-listening',
			planHash: hashJson(excerptPlan), source: excerptPlan.source, profile,
			counts: { fragments: artifacts.length, generated: sourceArtifacts.filter((item) => item.cacheType === 'generated').length,
				cacheHits: sourceArtifacts.filter((item) => item.cacheType !== 'generated').length,
				approvedAssemblyUnits: approvedAssembly.coveredTargetIds.size,
				reviewSceneHits: reviewSceneSources.size },
			voiceCards: Object.fromEntries(Object.entries(references).filter(([speaker]) => speaker !== '$narrator')),
			approvedAssembly: approvedAssembly.reviewRecords,
			fragments: artifacts.map(({ pathAbsolute, ...item }) => item), levels, whisper, output,
			generatedAt: new Date().toISOString() };
		await writeJsonAtomic(join(excerptDirectory, 'preview-manifest.json'), manifest);
		console.log(`独立小样（整节未改）：${absolute(output.mp3.path)}`);
		return;
	}
	const approvedAssembly = await resolveApprovedAssembly(targets, section);
	const reviewSceneSources = await resolveReviewSceneSources(targets, reviewScenePlan);
	const stablePlan = { version: 1, chapter, sectionId, slug: section.slug,
		source: { path: pending.source, fileHash: sourceFileHash },
		startAnchor: section.startAnchor, endAnchor: section.endAnchor,
		outputConfig: { intermediateSampleRate: 24000, mp3SampleRate: 48000,
			mp3BitrateKbps: provider.chapterDemo.mp3BitrateKbps || 128, master: provider.chapterDemo.master },
		approvedAssembly: section.approvedAssembly || null,
		fragmentConditioning: section.fragmentConditioning || null,
		reviewSceneSource: reviewSceneSources.size ? { planHash: reviewScenePlan.planHash, scene: reviewScenePlan.scene } : null,
		blocks: blocks.length, targets: targets.map((item) => ({ ...item,
			...(reviewSceneSources.has(item.targetId)
				? { reviewSceneSource: { planHash: reviewScenePlan.planHash,
					reviewKey: reviewSceneSources.get(item.targetId).source.reviewKey,
					fileHash: reviewSceneSources.get(item.targetId).source.audio.fileHash,
					path: reviewSceneSources.get(item.targetId).source.audio.cachePath } }
				: { synthesisSpec: synthesisSpec(item, provider, item.splitVersion) }) })) };
	const planHash = hashJson(stablePlan);
	const synthesisTargets = targets.filter((target) => !approvedAssembly.coveredTargetIds.has(target.targetId)
		&& !reviewSceneSources.has(target.targetId));
	const sectionCachedIds = new Set((await Promise.all(synthesisTargets.map(async (target) => {
		const synthesisHash = hashJson(synthesisSpec(target, provider, target.splitVersion));
		const renderHash = hashJson({ synthesisHash, normalization: provider.audio,
			...(target.normalizationMode ? { normalizationMode: target.normalizationMode } : {}) });
		const output = join(directory, 'fragments', `${renderHash}.wav`);
		const metadata = await readJsonIfExists(`${output}.json`);
		return metadata?.renderHash === renderHash && await pathExists(output)
			&& metadata.fileHash === await sha256File(output) ? target.targetId : null;
	}))).filter(Boolean));
	const legacyReusable = synthesisTargets.filter((item) => !sectionCachedIds.has(item.targetId)
		&& canReuseLegacy(item, oldTargets.get(item.targetId), oldFragments.get(item.targetId))).length;
	const pendingTargets = synthesisTargets.filter((item) => !sectionCachedIds.has(item.targetId)
		&& !canReuseLegacy(item, oldTargets.get(item.targetId), oldFragments.get(item.targetId)));
	const pendingByRoute = Object.entries(pendingTargets.reduce((counts, item) => {
		counts[item.voiceCardRoute] = (counts[item.voiceCardRoute] || 0) + 1;
		return counts;
	}, {})).map(([route, count]) => `${route}=${count}`).join('，');
	console.log(`第 ${sectionId} 节：${blocks.length} 块，${targets.length} 单元；本节正文对齐 ${alignment.length}/${blocks.length}；获批入片 ${approvedAssembly.coveredTargetIds.size} 单元，当前争吵试听复用 ${reviewSceneSources.size} 单元，小节缓存 ${sectionCachedIds.size}，旧章候选 ${legacyReusable}，待合成 ${synthesisTargets.length - sectionCachedIds.size - legacyReusable}。`);
	if (pendingTargets.length) console.log(`待合成按音色路由：${pendingByRoute}。`);
	if (planOnly) return;
	await mkdir(directory, { recursive: true });
	await writeJsonAtomic(join(directory, 'alignment-report.json'), { chapter, sectionId,
		currentSourceFileHash: sourceFileHash, previousSourceFileHash: pending.sourceFileHash, blocks: alignment });
	await writeJsonAtomic(join(directory, 'section-plan.json'), { ...stablePlan, planHash });
	const credentials = await loadDoubaoCredentials(ROOT);
	const client = new DoubaoAudioGenerationClient({ apiKey: credentials.apiKey, endpoint: provider.audioGenerationApi.endpoint });
	const artifacts = [];
	for (let index = 0; index < targets.length;) {
		const target = targets[index];
		const group = approvedAssembly.groupByFirst.get(target.targetId);
		let artifact;
		if (group) {
			artifact = await approvedGroupArtifact(targets, group);
			index += group.targetIds.length;
		} else if (approvedAssembly.sourceByTarget.has(target.targetId)) {
			artifact = await approvedSourceArtifact(target, approvedAssembly.sourceByTarget.get(target.targetId));
			index += 1;
		} else if (reviewSceneSources.has(target.targetId)) {
			artifact = await reviewSceneSourceArtifact(target, reviewSceneSources.get(target.targetId));
			index += 1;
		} else {
			artifact = await renderTarget(target, provider, client, directory, oldTargets.get(target.targetId), oldFragments.get(target.targetId));
			index += 1;
		}
		const conditioning = section.fragmentConditioning?.[artifact.targetId];
		if (shouldConditionArtifact(artifact, conditioning)) artifact = await prepareExcerptArtifact(artifact, join(directory, 'conditioned'),
			conditioning.silencePolicy, null, null, conditioning.tailRepair);
		artifacts.push(artifact);
		console.log(`[${artifacts.length} 个拼接片段] ${artifact.targetId}：${artifact.cacheType}`);
	}
	const levels = [];
	for (const artifact of artifacts) {
		const level = assemblyLevels(await readFile(artifact.pathAbsolute), artifact.assemblyGainDb || 0);
		levels.push({ targetId: artifact.targetId, ...level });
		if (level.activeRmsDbfs < -43 || level.peakDbfs > -0.3 || level.activeWindowRatio < 0.12) throw new Error(`${artifact.targetId} 疑似静音、削波或严重截断。`);
	}
	const whisper = await whisperCheck(artifacts, directory);
	const output = await compose(artifacts, provider, directory);
	const manifest = { version: 1, chapter, sectionId, slug: section.slug, status: 'draft-pending-dialogue-review',
		planHash, source: stablePlan.source, startAnchor: section.startAnchor, endAnchor: section.endAnchor,
		outputConfig: stablePlan.outputConfig,
		counts: { blocks: blocks.length, fragments: artifacts.length,
			synthesisUnits: targets.length,
			narration: targets.filter((item) => item.speakerRef === '$narrator').length,
			dialogue: targets.filter((item) => item.kind === 'dialogue').length,
			approvedAssemblyUnits: approvedAssembly.coveredTargetIds.size,
			reviewSceneHits: reviewSceneSources.size,
			generated: artifacts.filter((item) => item.cacheType === 'generated').length,
			cacheHits: targets.length - artifacts.filter((item) => item.cacheType === 'generated').length },
		provider: { name: provider.provider, model: provider.audioGenerationApi.model, narratorSeed: references.$narrator },
		voiceCards: Object.fromEntries(Object.entries(references).filter(([speaker]) => speaker !== '$narrator')),
		approvedAssembly: approvedAssembly.reviewRecords,
		fragments: artifacts.map(({ pathAbsolute, ...item }) => item), levels, whisper, output,
		generatedAt: new Date().toISOString() };
	await writeJsonAtomic(join(directory, 'scene-manifest.json'), manifest);
	console.log(`试听：${absolute(output.mp3.path)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	main().catch((error) => { console.error(`[第81回小节录音错误] ${error.message}`); process.exitCode = 1; });
}
