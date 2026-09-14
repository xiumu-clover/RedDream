import { join, resolve } from 'node:path';
import { hashJson, textChangeRatio, voiceAnnotationHash } from './audio-blocks.js';
import { resolveBlockRenderSpec } from './render-plan.js';

export const SCENE_PLAN_VERSION = 'drama-scene-plan-v2';
export const SCENE_RENDER_VERSION = 'drama-scene-render-v1';
export const DIALOGUE_SPLITTER_VERSION = 'zh-natural-punctuation-v1';
export const SCENE_SAMPLE_RATE = 24000;

export const SCENE_DEFINITIONS = {
	'xiren-three-opera': {
		chapter: '081',
		startAnchor: '且说宝玉独自闷闷回怡红院来。将至门口，只见院门大开，里面一片吵嚷之声。',
		endAnchor: '说罢动了气，一面理着头发衣襟，往屋里去了。',
		chorus: {
			'081-b0032': {
				label: '三人同诉',
				mainVoice: 'ai-guan',
				voices: ['ai-guan'],
				mode: 'single-main',
				reason: '按试听反馈，以艾官作为三人同诉的单一代表声，避免群声降低可懂度。',
			},
			'081-b0053': {
				label: '齐声附和',
				mainVoice: 'dou-guan',
				voices: ['dou-guan'],
				mode: 'single-main',
				reason: '按试听反馈，以荳官作为齐声附和的单一代表声，避免群声降低可懂度。',
			},
			'081-b0065': {
				label: '三人回应',
				mainVoice: 'kui-guan',
				voices: ['kui-guan'],
				mode: 'single-main',
				reason: '按试听反馈，以葵官作为三人回应的单一代表声，避免群声降低可懂度。',
			},
		},
	},
};

export const CHARACTER_VOICE_IDS = new Set([
	'jia-baoyu',
	'xiren',
	'ai-guan',
	'dou-guan',
	'kui-guan',
]);

/**
 * Route scene dialogue to an emotion-appropriate, local CosyVoice card. The
 * style id is deliberately part of the card id so a style change invalidates
 * the render cache even when the annotated speaker remains the same.
 */
export function selectSceneVoiceCardId(block, speakerRef = block.annotation?.speakerRef) {
	if (speakerRef === 'xiren') return 'xiren:assertive-rivalry';
	// The user selected the card heard in “有什么话咱且轻轻说” as the
	// single Baoyu identity for this scene. Keep semantic emotion in the plan,
	// but do not switch identity cards mid-conversation.
	if (speakerRef === 'jia-baoyu') return 'jia-baoyu:restrained-sadness';
	if (['ai-guan', 'dou-guan', 'kui-guan'].includes(speakerRef)) return speakerRef;
	throw new Error(`对白 ${block.blockId || block.order} 没有可用的剧情音色卡路由：${speakerRef}。`);
}

export function sceneOutputDirectory(projectRoot, chapterId, sceneId) {
	return join(resolve(projectRoot), 'content', 'audio', '.cache', 'drama', chapterId, sceneId);
}

export function sceneFragmentRenderHash({
	textHash,
	annotationHash,
	voiceCardId,
	voiceCardFileHash,
	voiceCardText,
	provider,
	modelVersion,
	prosodyOrInstruction,
	splitterVersion = DIALOGUE_SPLITTER_VERSION,
	renderParameters,
}) {
	return hashJson({
		version: SCENE_RENDER_VERSION,
		textHash,
		annotationHash,
		voiceCardId,
		voiceCardFileHash,
		voiceCardText,
		provider,
		modelVersion,
		prosodyOrInstruction,
		splitterVersion,
		renderParameters,
	});
}

const VARIANT_INSTRUCTIONS = {
	'quiet-suspicion': '低声疑惑，边观察边揣测',
	'puzzled-question': '真切困惑，自问中带警觉',
	'scathing-rage': '强烈愤怒并带尖锐斥责',
	'hushed-alarm': '急切但压低声音，担心惊动外人',
	'tearful-appeal': '含泪诉冤，委屈急切但字句清楚',
	'grieving-compassion': '悲痛怜惜，接近落泪但保持可懂度',
	'weary-complaint': '含泪诉说困境，疲惫又委屈',
	'guilty-consolation': '自责而温柔地安慰，同时压低声量',
	'bitter-accusation': '积怨爆发，带苦涩的尖锐控诉',
	'defensive-indignation': '忍怒自辩，羞恼而强硬',
	'oath-bound-fury': '步步紧逼地逼人起誓，怒意强烈',
	'taunting-challenge': '带讥诮的挑衅，逼对方当场表态',
	'sullen-defiance': '羞恼而强硬地回避，怒意压在声音里',
	'inciting-anger': '趁势煽动，尖锐指控但保持可懂度',
	'collective-outcry': '同仇敌忾地附和，短促有力',
	'urgent-restraint': '急切制止冲突，警告后果',
	'hushed-reassurance': '压低声音安抚，同时坚定催促离开',
	'bitter-warning': '咬牙收手，仍带尖锐警告',
	'resolute-release': '痛定思痛后作出决断，语气坚定，悲凉仍在',
	'forced-agreement': '表面嘴硬地同意，内里发虚',
	'betrayed-sorrow': '信任崩塌后的悲凉自问，接近落泪',
	'defensive-irritation': '受疑后恼怒自辩，刻意显得冷淡',
};

const FAMILY_INSTRUCTIONS = {
	anger: '带明确怒意和冲突感',
	sadness: '带克制的悲伤和失落',
	joy: '带轻微喜悦，但不浮夸',
	fear: '带警觉和不安',
	calm: '保持自然克制',
	mixed: '呈现复杂而克制的情绪转折',
};

const PACE_INSTRUCTIONS = {
	slow: '稍慢',
	medium: '中速',
	fast: '中速略快',
	urgent: '快速清楚',
	broken: '稍慢断续但不断裂',
};

const PITCH_INSTRUCTIONS = {
	low: '低音',
	medium: '自然音高',
	high: '偏高但不尖叫',
};

const ENERGY_INSTRUCTIONS = {
	light: '轻力度',
	medium: '中等力度',
	heavy: '重力度但不咆哮',
};

const TIMBRE_INSTRUCTIONS = {
	clear: '清晰',
	sharp: '略尖锐',
	hoarse: '微哑',
	breathy: '带气声',
	soft: '柔和',
	firm: '坚定',
};

const MODIFIER_INSTRUCTIONS = {
	crying: '近落泪但可懂',
	sobbing: '克制抽泣但字句完整',
	choked: '哽咽但不吞字',
	'cold-laugh': '带冷笑意味，不额外插入笑声',
	'bitter-smile': '带苦笑意味，不额外插入笑声',
	'forced-smile': '带勉强笑意，不额外插入笑声',
	whispering: '压低声音但首尾完整',
	walking: '保持行走中说话的轻微动势',
	'dream-murmur': '近似梦中低语，但仍要清楚',
	hesitating: '带短暂犹疑，不重复字词',
	trembling: '声音轻微发颤，不要失真',
	laughing: '带讥笑但不插入笑声',
};

function uniqueIndexMatches(candidates, predicate, label) {
	const indexes = [];
	for (let index = 0; index < candidates.length; index += 1) {
		if (predicate(candidates[index])) indexes.push(index);
	}
	if (indexes.length !== 1) {
		throw new Error(`${label}应当唯一命中，实际命中 ${indexes.length} 处。`);
	}
	return indexes[0];
}

export function extractSceneByAnchors(candidates, definition) {
	if (!Array.isArray(candidates) || candidates.length === 0) {
		throw new Error('场景提取缺少当前正文语音块。');
	}
	const startIndex = uniqueIndexMatches(
		candidates,
		(block) => block.text.startsWith(definition.startAnchor),
		`开始锚点“${definition.startAnchor}”`,
	);
	const endIndex = uniqueIndexMatches(
		candidates,
		(block) => block.text === definition.endAnchor || block.text.endsWith(definition.endAnchor),
		`结束锚点“${definition.endAnchor}”`,
	);
	if (endIndex < startIndex) throw new Error('剧情结束锚点出现在开始锚点之前。');
	return {
		startIndex,
		endIndex,
		blocks: candidates.slice(startIndex, endIndex + 1),
		actualStartText: candidates[startIndex].text,
		actualEndText: candidates[endIndex].text,
	};
}

function exactPendingMatches(block, pendingBlocks) {
	return pendingBlocks.filter((candidate) => (
		candidate.kind === block.kind
		&& candidate.textHash === block.textHash
		&& candidate.text === block.text
	));
}

function nearestAlignedOrder(aligned, index, direction) {
	for (let cursor = index + direction; cursor >= 0 && cursor < aligned.length; cursor += direction) {
		if (aligned[cursor]?.pendingBlock) return aligned[cursor].pendingBlock.order;
		if (aligned[cursor]?.currentAnnotation) {
			const match = /-b(\d{4})$/u.exec(aligned[cursor].currentBlockId);
			if (match) return Number(match[1]);
		}
	}
	return undefined;
}

function fuzzyMatch(block, pendingBlocks, previousOrder, nextOrder) {
	const threshold = block.kind === 'narration' ? 0.30
		: block.kind === 'dialogue' ? 0.10 : 0;
	const ranked = pendingBlocks
		.filter((candidate) => candidate.kind === block.kind)
		.map((candidate) => ({
			candidate,
			ratio: textChangeRatio(candidate.text, block.text),
		}))
		.filter(({ candidate, ratio }) => {
			if (ratio >= threshold) return false;
			if (previousOrder !== undefined && candidate.order <= previousOrder) return false;
			if (nextOrder !== undefined && candidate.order >= nextOrder) return false;
			return true;
		})
		.sort((left, right) => left.ratio - right.ratio);
	if (ranked.length === 0) return undefined;
	if (ranked.length > 1 && ranked[1].ratio - ranked[0].ratio < 0.08) return undefined;
	return ranked[0];
}

function localizeAnnotation(annotation, block, note) {
	return {
		...annotation,
		textHash: block.textHash,
		contextHash: block.contextHash,
		reviewStatus: 'auto-reused',
		note: `${annotation.note ? `${annotation.note} ` : ''}${note}`.trim(),
	};
}

/**
 * Align current scene blocks to the old pending map conservatively. Exact text
 * and hash are preferred. Fuzzy inheritance is restricted by already aligned
 * neighbours and the same thresholds used by the chapter reconciler.
 */
export function alignSceneBlocks({ sceneBlocks, pendingMap, annotationDocument }) {
	const pendingBlocks = Array.isArray(pendingMap?.blocks) ? pendingMap.blocks : [];
	const annotations = annotationDocument?.annotations || {};
	const annotationEntries = Object.entries(annotations);
	const aligned = sceneBlocks.map((block) => {
		const positionalBlockId = `${annotationDocument?.chapter || pendingMap?.chapter || 'unknown'}-b${String(block.order).padStart(4, '0')}`;
		const positionalAnnotation = annotations[positionalBlockId];
		const exactAnnotations = annotationEntries.filter(([, annotation]) => (
			annotation.textHash === block.textHash
			&& annotation.contextHash === block.contextHash
		));
		const exactAnnotation = positionalAnnotation
			&& positionalAnnotation.textHash === block.textHash
			&& positionalAnnotation.contextHash === block.contextHash
			? [positionalBlockId, positionalAnnotation]
			: exactAnnotations.length === 1 ? exactAnnotations[0] : undefined;
		if (
			exactAnnotation
		) {
			return {
				block,
				currentBlockId: exactAnnotation[0],
				currentAnnotation: exactAnnotation[1],
				method: 'current-annotation-text-hash-context',
			};
		}
		const exact = exactPendingMatches(block, pendingBlocks);
		if (exact.length === 1) {
			return { block, pendingBlock: exact[0], method: 'exact-text-hash' };
		}
		if (exact.length > 1) {
			const contextual = exact.filter((candidate) => candidate.contextHash === block.contextHash);
			if (contextual.length === 1) {
				return { block, pendingBlock: contextual[0], method: 'exact-text-hash-context' };
			}
		}
		return { block };
	});

	for (let index = 0; index < aligned.length; index += 1) {
		if (aligned[index].pendingBlock || aligned[index].currentAnnotation) continue;
		const fuzzy = fuzzyMatch(
			aligned[index].block,
			pendingBlocks,
			nearestAlignedOrder(aligned, index, -1),
			nearestAlignedOrder(aligned, index, 1),
		);
		if (fuzzy) {
			aligned[index].pendingBlock = fuzzy.candidate;
			aligned[index].method = 'fuzzy-text-stable-neighbours';
			aligned[index].changeRatio = Number(fuzzy.ratio.toFixed(4));
		}
	}

	return aligned.map((entry, index) => {
		const { block, pendingBlock, currentAnnotation, currentBlockId } = entry;
		if (currentAnnotation) {
			if (block.kind === 'narration' && currentAnnotation.speakerRef !== '$narrator') {
				return {
					...block,
					blockId: currentBlockId,
					alignmentStatus: 'paused',
					alignmentReason: `旁白被标注为 ${currentAnnotation.speakerRef}，拒绝错误路由`,
				};
			}
			if (block.kind === 'dialogue' && !CHARACTER_VOICE_IDS.has(currentAnnotation.speakerRef)) {
				return {
					...block,
					blockId: currentBlockId,
					alignmentStatus: 'paused',
					alignmentReason: `对白说话人 ${currentAnnotation.speakerRef} 不在本场景五角色内`,
				};
			}
			return {
				...block,
				blockId: currentBlockId,
				oldOrder: Number(/-b(\d{4})$/u.exec(currentBlockId)?.[1] || block.order),
				alignmentStatus: 'aligned',
				alignmentMethod: entry.method,
				contextExact: true,
				annotation: currentAnnotation,
				annotationHash: voiceAnnotationHash(currentAnnotation),
			};
		}
		if (!pendingBlock) {
			return {
				...block,
				alignmentStatus: 'paused',
				alignmentReason: '没有唯一、可靠的旧文本/textHash/上下文匹配',
			};
		}
		const annotation = annotations[pendingBlock.blockId];
		if (!annotation || annotation.textHash !== pendingBlock.textHash) {
			return {
				...block,
				blockId: pendingBlock.blockId,
				alignmentStatus: 'paused',
				alignmentReason: '旧标注缺失，或标注 textHash 与旧正文不一致',
			};
		}

		const previousOrder = nearestAlignedOrder(aligned, index, -1);
		const nextOrder = nearestAlignedOrder(aligned, index, 1);
		const stableNeighbours = (
			(previousOrder === undefined || previousOrder === pendingBlock.order - 1)
			&& (nextOrder === undefined || nextOrder === pendingBlock.order + 1)
		);
		const contextExact = pendingBlock.contextHash === block.contextHash
			&& annotation.contextHash === block.contextHash;
		if (block.kind === 'dialogue' && !contextExact && !stableNeighbours) {
			return {
				...block,
				blockId: pendingBlock.blockId,
				alignmentStatus: 'paused',
				alignmentReason: '对白上下文已变化，且相邻块身份不能证明连续性',
			};
		}

		let localized = annotation;
		if (entry.method.startsWith('fuzzy')) {
			localized = localizeAnnotation(
				annotation,
				block,
				`场景缓存按相邻块与 ${(entry.changeRatio * 100).toFixed(1)}% 文字变化率继承；未改正式 annotations。`,
			);
		} else if (!contextExact) {
			localized = localizeAnnotation(
				annotation,
				block,
				'场景缓存按全文精确匹配及连续相邻块继承上下文；未改正式 annotations。',
			);
		}

		if (block.kind === 'narration' && localized.speakerRef !== '$narrator') {
			return {
				...block,
				blockId: pendingBlock.blockId,
				alignmentStatus: 'paused',
				alignmentReason: `旁白被标注为 ${localized.speakerRef}，拒绝错误路由`,
			};
		}
		if (block.kind === 'dialogue' && !CHARACTER_VOICE_IDS.has(localized.speakerRef)) {
			return {
				...block,
				blockId: pendingBlock.blockId,
				alignmentStatus: 'paused',
				alignmentReason: `对白说话人 ${localized.speakerRef} 不在本场景五角色内`,
			};
		}

		return {
			...block,
			blockId: pendingBlock.blockId,
			oldOrder: pendingBlock.order,
			alignmentStatus: 'aligned',
			alignmentMethod: contextExact || entry.method.startsWith('fuzzy')
				? entry.method : `${entry.method}-stable-neighbours`,
			contextExact,
			...(entry.changeRatio === undefined ? {} : { changeRatio: entry.changeRatio }),
			annotation: localized,
			annotationHash: voiceAnnotationHash(localized),
		};
	});
}

function splitOversizedClause(clause, maxChars) {
	if ([...clause].length <= maxChars) return [clause];
	const pieces = clause.match(/[^，、：,:]+[，、：,:]?/gu) || [clause];
	const output = [];
	let current = '';
	for (const piece of pieces) {
		if (current && [...current, ...piece].length > maxChars) {
			output.push(current);
			current = '';
		}
		if ([...piece].length <= maxChars) {
			current += piece;
			continue;
		}
		if (current) output.push(current);
		current = '';
		const characters = [...piece];
		for (let offset = 0; offset < characters.length; offset += maxChars) {
			output.push(characters.slice(offset, offset + maxChars).join(''));
		}
	}
	if (current) output.push(current);
	return output;
}

export function splitChineseDialogue(text, maxChars = 46) {
	if (!Number.isInteger(maxChars) || maxChars < 10) throw new Error('对白分句上限必须是不小于 10 的整数。');
	const clauses = text.match(/[^。！？!?；;]+[。！？!?；;]?/gu) || [];
	const natural = clauses.flatMap((clause) => splitOversizedClause(clause, maxChars));
	const units = [];
	let current = '';
	for (const clause of natural) {
		if (current && [...current, ...clause].length > maxChars) {
			units.push(current);
			current = '';
		}
		current += clause;
	}
	if (current) units.push(current);
	if (units.join('') !== text) throw new Error('对白分句改变了原文。');
	return units;
}

/**
 * Preserve annotation-directed performance units while continuing to split
 * the surrounding text by the normal punctuation rules. Forced units must be
 * exact, ordered excerpts so this can never omit or reorder source dialogue.
 */
export function splitChineseDialogueWithDelivery(text, delivery, maxChars = 46) {
	const forcedUnits = delivery?.forcedUnits || [];
	if (forcedUnits.length === 0) {
		return splitChineseDialogue(text, maxChars).map((unitText) => ({ text: unitText }));
	}
	const units = [];
	let cursor = 0;
	for (const forced of forcedUnits) {
		const index = text.indexOf(forced.text, cursor);
		if (index < 0) throw new Error(`强制演绎单元不在当前对白中：${forced.text}`);
		const prefix = text.slice(cursor, index);
		if (prefix) {
			units.push(...splitChineseDialogue(prefix, maxChars).map((unitText) => ({ text: unitText })));
		}
		units.push({ text: forced.text, delivery: forced });
		cursor = index + forced.text.length;
	}
	const suffix = text.slice(cursor);
	if (suffix) {
		units.push(...splitChineseDialogue(suffix, maxChars).map((unitText) => ({ text: unitText })));
	}
	if (units.map((unit) => unit.text).join('') !== text) {
		throw new Error('强制演绎分句改变了原文。');
	}
	return units;
}

export function applyPronunciationOverrides(text, pronunciations = []) {
	return pronunciations.reduce(
		(current, pronunciation) => current.replaceAll(pronunciation.text, pronunciation.replacement),
		text,
	);
}

export function speechLevelTarget(kind) {
	return kind === 'narration' ? -22 : -21;
}

export function computeSpeechLevelGain({ rmsDbfs, peakDbfs, targetRmsDbfs, peakLimitDbfs = -3 }) {
	for (const [name, value] of Object.entries({ rmsDbfs, peakDbfs, targetRmsDbfs, peakLimitDbfs })) {
		if (!Number.isFinite(value)) throw new Error(`短片段电平 ${name} 无效。`);
	}
	const desiredGainDb = targetRmsDbfs - rmsDbfs;
	const peakSafeGainDb = peakLimitDbfs - peakDbfs;
	return Number(Math.min(desiredGainDb, peakSafeGainDb).toFixed(3));
}

export function passesWhisperStructuralReview(result) {
	const longInsertionOrDeletion = result.differences.some((difference) => (
		['insert', 'delete'].includes(difference.operation)
		&& Math.max(difference.expected.length, difference.actual.length) > 1
	));
	const normalizedLengthDelta = Math.abs(
		result.expectedNormalized.length - result.transcriptNormalized.length,
	);
	const lengthStructurePass = (
		(result.lengthRatio >= 0.94 && result.lengthRatio <= 1.04)
		|| normalizedLengthDelta <= 1
	);
	return !result.repeatedUnexpectedSpan && lengthStructurePass && !longInsertionOrDeletion;
}

export function pauseAfterSynthesisUnit(text) {
	if (/[！？!?]$/u.test(text)) return 130;
	if (/[；;]$/u.test(text)) return 120;
	if (/。$/u.test(text)) return 165;
	return 95;
}

export function scenePauseAfter(block, nextBlock) {
	if (!nextBlock) return 0;
	if (block.blockId === '081-b0066') return 520;
	if (block.blockId === '081-b0048') return 390;
	if (block.blockId === '081-b0069') return 380;
	const intense = [block, nextBlock].some((item) => (
		item.annotation?.emotion?.family === 'anger'
		&& item.annotation?.emotion?.intensity >= 2
	));
	if (intense) return 145;
	if (block.kind === 'narration' && nextBlock.kind === 'dialogue') return 220;
	if (block.kind === 'dialogue' && nextBlock.kind === 'narration') return 250;
	return 210;
}

function parseSigned(value, suffix) {
	const match = new RegExp(`^([+-]?\\d+)${suffix}$`, 'u').exec(String(value));
	if (!match) throw new Error(`无法解析韵律值 ${value}。`);
	return Number(match[1]);
}

function signed(value, suffix) {
	const rounded = Math.round(value);
	return `${rounded >= 0 ? '+' : ''}${rounded}${suffix}`;
}

export function resolveSceneNarratorPlan({ block, annotation, config, cards }) {
	const base = resolveBlockRenderSpec({
		block,
		annotation,
		variant: 'narrator',
		config,
		cards,
	});
	let rate = parseSigned(base.spec.rate, '%');
	let pitch = parseSigned(base.spec.pitch, 'Hz');
	let volume = parseSigned(base.spec.volume, '%');
	const adjustments = [];
	const intensityDepth = Math.max(0, annotation.emotion.intensity - 1);

	if (annotation.emotion.variant === 'tense-observation') {
		rate += 4;
		volume -= 5;
		adjustments.push('紧张观察：略加快并压低音量');
	}
	if (annotation.emotion.variant === 'urgent-action') {
		rate = Math.max(rate, 5);
		adjustments.push('动作升级：加快但限制播报感');
	}
	if (annotation.emotion.family === 'sadness') {
		rate -= intensityDepth * 2;
		pitch -= intensityDepth;
		adjustments.push('悲伤强度：略慢、偏沉');
	}
	if (annotation.emotion.family === 'fear') {
		volume -= intensityDepth * 2;
		adjustments.push('不安强度：克制音量');
	}
	if (annotation.timbre.includes('breathy')) {
		volume -= 2;
		adjustments.push('气声音色：轻降音量');
	}
	if (/疑心|目光躲闪|冰水浇透|手脚都发凉/u.test(block.text)) {
		rate = Math.min(rate, -13);
		pitch = Math.min(pitch, -6);
		volume = Math.min(volume, -4);
		adjustments.push('宝玉疑心转折：放慢并压沉');
	}
	if (annotation.emotion.family === 'calm') {
		rate = Math.min(rate, -3);
		adjustments.push('平静转场：保持克制');
	}

	rate = Math.max(-35, Math.min(8, rate));
	pitch = Math.max(-15, Math.min(10, pitch));
	volume = Math.max(-35, Math.min(12, volume));
	const spec = {
		...base.spec,
		rate: signed(rate, '%'),
		pitch: signed(pitch, 'Hz'),
		volume: signed(volume, '%'),
	};
	return {
		spec,
		baseSpec: base.spec,
		adjustments,
		warnings: [
			...base.warnings,
			`${block.blockId} 的 Edge-TTS 仅以 rate/pitch/volume 近似语义情绪，不代表真实复杂情感表演。`,
		],
		semanticHash: hashJson({
			version: SCENE_PLAN_VERSION,
			annotation: {
				emotion: annotation.emotion,
				pace: annotation.pace,
				pitch: annotation.pitch,
				energy: annotation.energy,
				timbre: annotation.timbre,
				modifiers: annotation.modifiers,
			},
			spec,
			adjustments,
		}),
	};
}

export function cosyVoiceSpeed(annotation) {
	return ({ slow: 0.94, medium: 1, fast: 1.06, urgent: 1.1, broken: 0.92 })[annotation.pace] || 1;
}

export function buildCosyVoiceInstruction(annotation) {
	const intensity = ['平稳', '轻微情绪', '明显情绪', '强烈情绪'][annotation.emotion.intensity];
	const parts = [
		VARIANT_INSTRUCTIONS[annotation.emotion.variant]
			|| `${FAMILY_INSTRUCTIONS[annotation.emotion.family] || '自然表达'}，具体变化为 ${annotation.emotion.variant}`,
		intensity,
		PACE_INSTRUCTIONS[annotation.pace],
		PITCH_INSTRUCTIONS[annotation.pitch],
		ENERGY_INSTRUCTIONS[annotation.energy],
		...annotation.timbre.map((value) => TIMBRE_INSTRUCTIONS[value]),
		...annotation.modifiers.map((value) => MODIFIER_INSTRUCTIONS[value]),
	].filter(Boolean);
	if (annotation.emotion.family === 'anger' && annotation.emotion.intensity >= 2) {
		parts.push('不尖叫、不吞字重复');
	}
	parts.push('自然口语，吐字完整，不增漏、不乱序');
	return `${parts.join('，')}。<|endofprompt|>`;
}

export function chorusForBlock(definition, block) {
	const chorus = definition.chorus?.[block.blockId];
	if (!chorus) return undefined;
	if (block.annotation?.speakerRef !== chorus.mainVoice) {
		throw new Error(
			`齐声块 ${block.blockId} 的 annotation 主声为 ${block.annotation?.speakerRef}，`
			+ `与场景规则 ${chorus.mainVoice} 不一致。`,
		);
	}
	return chorus;
}
