import { basename, extname, join } from 'node:path';
import { hashJson, voiceAnnotationHash } from './audio-blocks.js';
import { pathExists, readJsonIfExists, sha256File, writeJsonAtomic } from './files.js';
import { passesWhisperStructuralReview, selectSceneVoiceCardId, splitChineseDialogueWithDelivery } from './scene-plan.js';

export const REVIEW_SOURCE_VERSION = 1;

function annotationSnapshot(annotation) {
	return {
		speakerRef: annotation.speakerRef,
		emotion: annotation.emotion,
		pace: annotation.pace,
		pitch: annotation.pitch,
		energy: annotation.energy,
		timbre: annotation.timbre,
		modifiers: annotation.modifiers,
		...(annotation.pronunciations ? { pronunciations: annotation.pronunciations } : {}),
		...(annotation.delivery ? { delivery: annotation.delivery } : {}),
		...(annotation.note ? { note: annotation.note } : {}),
	};
}

function targetId(blockId, unitIndex) {
	return `dialogue:${blockId}:u${String(unitIndex + 1).padStart(2, '0')}`;
}

function nearbyContext(blocks, index) {
	return {
		previous: index > 0 ? { blockId: blocks[index - 1].blockId, text: blocks[index - 1].text } : null,
		next: index + 1 < blocks.length
			? { blockId: blocks[index + 1].blockId, text: blocks[index + 1].text } : null,
	};
}

async function audioBinding(projectRoot, levelEntry, sourceRenderHash) {
	if (!levelEntry?.path) return null;
	const path = join(projectRoot, ...levelEntry.path.split('/'));
	if (!await pathExists(path)) return null;
	const metadata = await readJsonIfExists(`${path}.json`);
	return {
		cachePath: levelEntry.path,
		renderHash: metadata?.renderHash || basename(path, extname(path)),
		sourceRenderHash,
		fileHash: await sha256File(path),
		durationSeconds: levelEntry.outputLevels?.durationSeconds ?? metadata?.durationSeconds ?? null,
		levels: levelEntry.outputLevels || null,
	};
}

function selectedResult(whisper, blockId, unitIndex) {
	return whisper?.selectionReview?.results?.find((item) => (
		item.blockId === blockId && item.unitIndex === unitIndex
	));
}

function rawWhisperResult(whisper, selected) {
	if (!selected) return undefined;
	return whisper?.results?.find((item) => item.id === selected.id);
}

export async function createReviewSourceFromArtifacts({
	projectRoot,
	chapter,
	scene,
	source,
	annotationSetHash,
	blocks,
	voiceCards,
	levelReport,
	whisper,
	sceneAudio,
}) {
	const levelEntries = levelReport?.entries || [];
	const targets = [];
	for (let blockIndex = 0; blockIndex < blocks.length; blockIndex += 1) {
		const block = blocks[blockIndex];
		if (block.kind !== 'dialogue') continue;
		for (const fragment of block.fragments || []) {
			const unitIndex = fragment.unitIndex ?? 0;
			const cardId = fragment.components?.[0]?.voiceCardId
				|| selectSceneVoiceCardId({ ...block, annotation: block.annotationSnapshot }, block.speakerRef);
			const card = voiceCards[cardId];
			const levelEntry = levelEntries.find((item) => (
				item.kind === 'dialogue' && item.blockId === block.blockId && item.unitIndex === unitIndex
			));
			const audio = await audioBinding(projectRoot, levelEntry, fragment.selected?.renderHash);
			const automatic = selectedResult(whisper, block.blockId, unitIndex);
			const raw = rawWhisperResult(whisper, automatic);
			const technicalIssues = [];
			if (audio && !automatic?.structuralPass) technicalIssues.push('Whisper 结构检查未通过或尚未完成。');
			if (audio?.levels?.peakDbfs > -2.9) technicalIssues.push('片段峰值接近或超过技术上限。');
			const rendered = Boolean(audio);
			const autoPassed = rendered && automatic?.structuralPass === true;
			targets.push({
				targetId: targetId(block.blockId, unitIndex),
				kind: 'dialogue_fragment',
				blockId: block.blockId,
				unitIndex,
				blockText: block.text,
				unitText: fragment.text,
				context: nearbyContext(blocks, blockIndex),
				speakerRef: block.speakerRef,
				annotationSnapshot: block.annotationSnapshot || block.semantics,
				annotationHash: block.annotationHash,
				voiceCard: card ? {
					id: cardId,
					styleId: card.styleId || fragment.components?.[0]?.voiceCardStyleId || 'default',
					label: card.label || cardId,
					cachePath: card.path,
					fileHash: card.fileHash,
					text: card.text,
				} : { id: cardId, styleId: null, label: cardId, cachePath: null, fileHash: null, text: null },
				audio,
				performance: {
					synthesisText: fragment.synthesisText || fragment.text,
					instruction: fragment.instruction || block.cosyvoice?.instruction || null,
					speed: fragment.speed ?? block.cosyvoice?.speed ?? null,
					delivery: fragment.delivery || null,
				},
				automaticCheck: automatic ? {
					structuralPass: automatic.structuralPass,
					rawStatus: automatic.rawStatus,
					characterSimilarity: automatic.characterSimilarity,
					lengthRatio: automatic.lengthRatio,
					transcript: raw?.transcript || null,
					note: automatic.note,
				} : null,
				technicalIssues,
				milestones: { planned: true, rendered, autoPassed },
				reviewState: autoPassed ? 'pending_review' : rendered ? 'rendered' : 'planned',
			});
		}
	}

	const narrationBlocks = blocks.filter((block) => block.kind === 'narration');
	const narrationReady = narrationBlocks.filter((block) => levelEntries.some((entry) => (
		entry.kind === 'narration' && entry.blockId === block.blockId
	))).length;
	const narrationPassed = narrationBlocks.filter((block) => {
		const hasAudio = levelEntries.some((entry) => entry.kind === 'narration' && entry.blockId === block.blockId);
		const result = whisper?.results?.find((item) => item.kind === 'narration-check' && item.blockId === block.blockId);
		return hasAudio && result && passesWhisperStructuralReview(result);
	}).length;
	const narration = {
		total: narrationBlocks.length,
		rendered: narrationReady,
		autoPassed: whisper?.narrationSpotCheck?.passedNoMarkupReading === true ? narrationPassed : 0,
		allAutoPassed: narrationBlocks.length > 0
			&& narrationPassed === narrationBlocks.length
			&& whisper?.narrationSpotCheck?.passedNoMarkupReading === true,
		machineCheck: whisper?.narrationSpotCheck || null,
	};
	const sceneBasisHash = hashJson({
		version: REVIEW_SOURCE_VERSION,
		annotationSetHash,
		fragments: targets.map((target) => ({
			targetId: target.targetId,
			annotationHash: target.annotationHash,
			voiceCardId: target.voiceCard?.id,
			voiceCardFileHash: target.voiceCard?.fileHash,
			renderHash: target.audio?.renderHash,
			fileHash: target.audio?.fileHash,
		})),
		narration,
	});
	if (sceneAudio?.cachePath && sceneAudio.fileHash && sceneAudio.renderHash) {
		targets.push({
			targetId: `scene:${scene}`,
			kind: 'scene_mix',
			blockId: null,
			unitIndex: null,
			blockText: `第${Number(chapter)}回 · ${scene} · 整场试听`,
			unitText: '请从头到尾完整试听正式场景。',
			context: null,
			speakerRef: '$scene',
			annotationSnapshot: null,
			annotationHash: annotationSetHash,
			voiceCard: null,
			audio: sceneAudio,
			automaticCheck: { structuralPass: true, note: '仅表示正式场景文件技术生成完成。' },
			technicalIssues: [],
			milestones: { planned: true, rendered: true, autoPassed: true },
			reviewState: 'pending_review',
		});
	}
	return {
		version: REVIEW_SOURCE_VERSION,
		chapter,
		scene,
		source,
		annotationSetHash,
		sceneBasisHash,
		narration,
		targets,
	};
}

export function createDoubaoDemoReviewSource({
	scenePlan,
	demoManifest,
	whisperValidation,
	annotationDocument,
}) {
	if (!scenePlan?.source?.path || !scenePlan.source.fileHash
		|| scenePlan.chapter !== demoManifest?.chapter
		|| scenePlan.scene !== demoManifest?.scene
		|| !Array.isArray(scenePlan.dialogueUnits)
		|| !Array.isArray(scenePlan.dialogueBlocks)
		|| !Array.isArray(demoManifest.fragments)
		|| !annotationDocument?.annotations) {
		throw new Error('豆包审核源输入不完整或场景不一致。');
	}
	const blocks = new Map(scenePlan.dialogueBlocks.map((block) => [block.blockId, block]));
	const fragments = new Map(demoManifest.fragments.map((fragment) => [fragment.targetId, fragment]));
	const rawWhisper = new Map((whisperValidation?.results || []).map((result) => [result.id, result]));
	const selectedWhisper = new Map((whisperValidation?.selectionReview?.results || [])
		.map((result) => [result.id, result]));
	const targets = scenePlan.dialogueUnits.map((unit) => {
		const block = blocks.get(unit.blockId);
		const annotation = annotationDocument.annotations[unit.blockId];
		if (!block || !annotation || voiceAnnotationHash(annotation) !== unit.annotationHash) {
			throw new Error(`豆包审核目标 ${unit.targetId} 的正文或标注绑定已经变化。`);
		}
		const card = scenePlan.voiceCards?.[unit.voiceCardId];
		if (!card || card.fileHash !== unit.voiceCardFileHash) {
			throw new Error(`豆包审核目标 ${unit.targetId} 的音色卡绑定已经变化。`);
		}
		const fragment = fragments.get(unit.targetId);
		const selected = selectedWhisper.get(unit.targetId);
		const raw = rawWhisper.get(unit.targetId);
		const technicalIssues = [];
		let audio = null;
		if (fragment) {
			if (fragment.blockId !== unit.blockId
				|| fragment.unitIndex !== unit.unitIndex
				|| fragment.annotationHash !== unit.annotationHash
				|| fragment.voiceCardId !== unit.voiceCardId
				|| fragment.voiceCardFileHash !== unit.voiceCardFileHash) {
				throw new Error(`豆包片段 ${unit.targetId} 的审核绑定与当前计划不一致。`);
			}
			if (fragment.subtitleExact !== true) technicalIssues.push('豆包返回字幕未与合成文本精确一致。');
			if (selected?.structuralPass !== true) technicalIssues.push('Whisper 结构检查未通过或尚未完成。');
			audio = {
				cachePath: fragment.path,
				renderHash: fragment.synthesisHash,
				sourceRenderHash: fragment.synthesisHash,
				fileHash: fragment.fileHash,
				durationSeconds: fragment.durationSeconds,
				levels: null,
			};
		}
		const rendered = Boolean(audio);
		const autoPassed = rendered && technicalIssues.length === 0;
		return {
			targetId: unit.targetId,
			kind: 'dialogue_fragment',
			provider: 'doubao',
			blockId: unit.blockId,
			unitIndex: unit.unitIndex,
			blockText: block.text,
			unitText: unit.text,
			context: block.context,
			speakerRef: unit.speakerRef,
			annotationSnapshot: block.annotationSnapshot,
			annotationHash: unit.annotationHash,
			voiceCard: {
				id: unit.voiceCardId,
				styleId: unit.voiceCardId.includes(':') ? unit.voiceCardId.split(':').at(-1) : 'default',
				label: unit.voiceCardId,
				cachePath: card.path,
				fileHash: card.fileHash,
				text: card.text,
			},
			audio,
			performance: {
				synthesisText: unit.synthesisText || unit.text,
				instruction: unit.instruction,
				speed: unit.speed,
				delivery: block.annotationSnapshot?.delivery || null,
			},
			automaticCheck: fragment ? {
				structuralPass: selected?.structuralPass === true,
				rawStatus: selected?.rawStatus || raw?.status || null,
				characterSimilarity: selected?.characterSimilarity ?? raw?.characterSimilarity ?? null,
				lengthRatio: selected?.lengthRatio ?? raw?.lengthRatio ?? null,
				transcript: raw?.transcript || fragment.subtitleText || null,
				note: '豆包字幕精确匹配；Whisper 仅检查漏字、乱序、重复和异常拖尾，不代替人工表演审核。',
			} : null,
			technicalIssues,
			milestones: { planned: true, rendered, autoPassed },
			reviewState: autoPassed ? 'pending_review' : rendered ? 'rendered' : 'planned',
		};
	});
	const annotationSetHash = hashJson(annotationDocument.annotations);
	const narration = {
		total: scenePlan.counts.narrationBlocks,
		rendered: 0,
		autoPassed: 0,
		allAutoPassed: false,
		machineCheck: null,
	};
	return {
		version: REVIEW_SOURCE_VERSION,
		chapter: scenePlan.chapter,
		scene: scenePlan.scene,
		source: scenePlan.source,
		annotationSetHash,
		sceneBasisHash: hashJson({
			version: REVIEW_SOURCE_VERSION,
			provider: 'doubao',
			annotationSetHash,
			fragments: targets.map((target) => ({
				targetId: target.targetId,
				annotationHash: target.annotationHash,
				voiceCardId: target.voiceCard.id,
				voiceCardFileHash: target.voiceCard.fileHash,
				renderHash: target.audio?.renderHash,
				fileHash: target.audio?.fileHash,
			})),
			narration,
		}),
		narration,
		targets,
	};
}

export async function buildLegacyReviewSource({ projectRoot, chapter, scene }) {
	const directory = join(projectRoot, 'content', 'audio', '.cache', 'drama', chapter, scene);
	const [manifest, annotations, levelReport, whisper] = await Promise.all([
		readJsonIfExists(join(directory, 'scene-manifest.json')),
		readJsonIfExists(join(projectRoot, 'content', 'audio', 'annotations', `${chapter}.json`)),
		readJsonIfExists(join(directory, 'fragment-quality-report.json')),
		readJsonIfExists(join(directory, 'whisper-validation.json')),
	]);
	if (!manifest || !annotations || !levelReport || !whisper) {
		throw new Error('缺少可导入的旧场景 manifest、标注、片段质检或 Whisper 报告。');
	}
	const sourcePath = join(projectRoot, ...manifest.source.path.split('/'));
	if (!await pathExists(sourcePath) || await sha256File(sourcePath) !== manifest.source.fileHash) {
		throw new Error('正文已经不同于旧场景，不能把旧缓存导入当前审核计划。');
	}
	const blocks = [];
	for (const oldBlock of manifest.blocks) {
		const annotation = annotations.annotations?.[oldBlock.blockId];
		if (!annotation) throw new Error(`缺少当前标注 ${oldBlock.blockId}。`);
		const currentHash = voiceAnnotationHash(annotation);
		if (oldBlock.kind !== 'dialogue') {
			blocks.push({
				...oldBlock,
				annotationHash: currentHash,
				annotationSnapshot: annotationSnapshot(annotation),
				fragments: currentHash === oldBlock.annotationHash ? oldBlock.fragments : [],
			});
			continue;
		}
		const oldFragments = currentHash === oldBlock.annotationHash ? oldBlock.fragments : [];
		const currentUnits = splitChineseDialogueWithDelivery(oldBlock.text, annotation.delivery);
		const fragments = currentUnits.map((unit, unitIndex) => {
			const old = oldFragments.find((item) => item.unitIndex === unitIndex && item.text === unit.text);
			return old || { unitIndex, text: unit.text, selected: null, components: [] };
		});
		blocks.push({
			...oldBlock,
			speakerRef: annotation.speakerRef,
			annotationHash: currentHash,
			annotationSnapshot: annotationSnapshot(annotation),
			fragments,
		});
	}
	const currentLevel = {
		...levelReport,
		entries: levelReport.entries.filter((entry) => {
			const block = blocks.find((item) => item.blockId === entry.blockId);
			if (!block) return false;
			if (block.kind === 'narration') return block.fragments.length > 0;
			return block.fragments.some((fragment) => (
				fragment.unitIndex === entry.unitIndex && fragment.selected
			));
		}),
	};
	const source = await createReviewSourceFromArtifacts({
		projectRoot,
		chapter,
		scene,
		source: manifest.source,
		annotationSetHash: hashJson(annotations.annotations),
		blocks,
		voiceCards: manifest.voiceCards,
		levelReport: currentLevel,
		whisper,
	});
	await writeJsonAtomic(join(directory, 'review-source.json'), source);
	return source;
}

export async function loadOrBuildReviewSource({ projectRoot, chapter, scene, rebuild = false }) {
	const path = join(projectRoot, 'content', 'audio', '.cache', 'drama', chapter, scene, 'review-source.json');
	if (!rebuild) {
		const existing = await readJsonIfExists(path);
		const annotations = await readJsonIfExists(
			join(projectRoot, 'content', 'audio', 'annotations', `${chapter}.json`),
		);
		if (existing?.version === REVIEW_SOURCE_VERSION
			&& annotations?.annotations
			&& existing.annotationSetHash === hashJson(annotations.annotations)) return existing;
	}
	return buildLegacyReviewSource({ projectRoot, chapter, scene });
}
