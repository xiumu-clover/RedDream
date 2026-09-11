import { createHash } from 'node:crypto';

export const AUDIO_BLOCK_SCHEMA_VERSION = 1;
export const SEGMENTER_VERSION = 'audio-blocks-v1';

const OMITTED_MARKS = new Set(['zp', 'mp', 'zpsc']);
const STRUCTURAL_POETRY_MARKS = new Set(['sc', 'fu']);
const UNMARKED_EDITORIAL_COMMENT_PATTERN = /【[^】]*】/gu;
const LITERAL_MARKER_PATTERN = /\[(?:zp|mp|zpsc|sc|fu|b|t|wz\d*|img|-)\]/giu;
const EMOTION_FAMILIES = new Set(['anger', 'sadness', 'joy', 'fear', 'calm', 'mixed']);
const PACES = new Set(['slow', 'medium', 'fast', 'urgent', 'broken']);
const PITCHES = new Set(['low', 'medium', 'high']);
const ENERGIES = new Set(['light', 'medium', 'heavy']);
const TIMBRES = new Set(['clear', 'sharp', 'hoarse', 'breathy', 'soft', 'firm']);
const REVIEW_STATUSES = new Set(['ai-reviewed', 'human-reviewed', 'auto-reused']);
const MODIFIERS = new Set([
	'crying', 'sobbing', 'choked', 'cold-laugh', 'bitter-smile', 'forced-smile',
	'whispering', 'walking', 'dream-murmur', 'hesitating', 'trembling', 'laughing',
]);

export class AudioSegmentationError extends Error {
	constructor(message, line) {
		super(line ? `正文第 ${line} 行：${message}` : message);
		this.name = 'AudioSegmentationError';
		this.line = line;
	}
}

export function sha256(value) {
	return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function stableStringify(value) {
	if (value === null || typeof value !== 'object') return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
	return `{${Object.keys(value).sort().map((key) => (
		`${JSON.stringify(key)}:${stableStringify(value[key])}`
	)).join(',')}}`;
}

export function hashJson(value) {
	return sha256(stableStringify(value));
}

function collectVisibleText(nodes, preserveLines = false) {
	let output = '';
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				output += node.value;
				break;
			case 'hard-break':
				output += preserveLines ? '\n' : ' ';
				break;
			case 'note-reference':
			case 'image':
				break;
			case 'mark':
				if (!OMITTED_MARKS.has(node.kind)) {
					output += collectVisibleText(node.children, preserveLines);
				}
				break;
			default:
				throw new Error(`无法处理未知章节节点：${String(node.type)}`);
		}
	}
	return output;
}

function normalizeSpokenText(text, preserveLines = false) {
	let normalized = text
		.replace(UNMARKED_EDITORIAL_COMMENT_PATTERN, '')
		.replace(LITERAL_MARKER_PATTERN, '')
		.replace(/\r\n?/gu, '\n');
	if (preserveLines) {
		normalized = normalized
			.split('\n')
			.map((line) => line.replace(/[ \t]+/gu, ' ').trim())
			.filter(Boolean)
			.join('\n');
	} else {
		normalized = normalized.replace(/\s+/gu, ' ').trim();
	}
	return normalized;
}

function tokenizeProseParagraph(text, line, sourceRole = 'prose') {
	const normalized = normalizeSpokenText(text);
	if (!normalized) return [];

	const parts = [];
	let mode = 'narration';
	let current = '';
	const push = () => {
		const value = normalizeSpokenText(current);
		if (value) parts.push({ kind: mode, text: value, line, sourceRole });
		current = '';
	};

	for (const character of normalized) {
		if (character === '“') {
			if (mode === 'dialogue') {
				throw new AudioSegmentationError('检测到嵌套的外层中文双引号，请改用内层‘……’。', line);
			}
			push();
			mode = 'dialogue';
			continue;
		}
		if (character === '”') {
			if (mode !== 'dialogue') {
				throw new AudioSegmentationError('检测到没有对应开头的中文右双引号。', line);
			}
			push();
			mode = 'narration';
			continue;
		}
		current += character;
	}
	if (mode === 'dialogue') {
		throw new AudioSegmentationError('中文双引号没有在本段闭合。', line);
	}
	push();
	return parts;
}

/**
 * Convert the compiled chapter AST to narration/dialogue/poetry candidates.
 * Top-level newlines are prose paragraph boundaries; sc/fu remain independent.
 */
export function chapterToAudioCandidates(compiled) {
	const structural = [];
	let paragraph = '';
	let paragraphLine = 1;

	const appendParagraph = (value, line) => {
		if (!paragraph) paragraphLine = line || paragraphLine;
		paragraph += value;
	};
	const flushParagraph = () => {
		if (normalizeSpokenText(paragraph)) {
			structural.push(...tokenizeProseParagraph(paragraph, paragraphLine));
		}
		paragraph = '';
	};

	for (const node of compiled.nodes) {
		if (node.type === 'text') {
			const pieces = node.value.split('\n');
			for (let index = 0; index < pieces.length; index += 1) {
				appendParagraph(pieces[index], node.position.line + index);
				if (index < pieces.length - 1) flushParagraph();
			}
			continue;
		}
		if (node.type === 'hard-break') {
			appendParagraph(' ', node.position.line);
			continue;
		}
		if (node.type === 'note-reference' || node.type === 'image') continue;
		if (node.type !== 'mark') continue;
		if (OMITTED_MARKS.has(node.kind)) continue;

		if (STRUCTURAL_POETRY_MARKS.has(node.kind)) {
			flushParagraph();
			const text = normalizeSpokenText(collectVisibleText(node.children, true), true);
			if (text) {
				structural.push({
					kind: 'poetry',
					text,
					line: node.position.line,
					sourceRole: node.kind,
				});
			}
			continue;
		}

		if (node.kind === 'title') {
			flushParagraph();
			const text = normalizeSpokenText(collectVisibleText(node.children));
			if (text) structural.push(...tokenizeProseParagraph(text, node.position.line, 'title'));
			continue;
		}

		appendParagraph(collectVisibleText(node.children), node.position.line);
	}
	flushParagraph();

	const candidates = structural.map((block, index) => ({
		order: index + 1,
		kind: block.kind,
		text: block.text,
		textHash: sha256(block.text),
		source: { line: block.line },
		sourceRole: block.sourceRole,
	}));
	for (let index = 0; index < candidates.length; index += 1) {
		const previous = candidates[index - 1];
		const next = candidates[index + 1];
		candidates[index].contextHash = hashJson({
			previous: previous ? [previous.kind, previous.textHash] : null,
			next: next ? [next.kind, next.textHash] : null,
		});
	}
	return candidates;
}

function unicodeCharacters(value) {
	return [...String(value)];
}

export function textChangeRatio(previousText, nextText) {
	const left = unicodeCharacters(previousText);
	const right = unicodeCharacters(nextText);
	if (left.length === 0 && right.length === 0) return 0;
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
		const current = [leftIndex];
		for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
			const substitution = previous[rightIndex - 1]
				+ (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
			current[rightIndex] = Math.min(
				previous[rightIndex] + 1,
				current[rightIndex - 1] + 1,
				substitution,
			);
		}
		previous = current;
	}
	return previous[right.length] / Math.max(left.length, right.length);
}

function lcsExactMatches(previousBlocks, candidates) {
	const rows = previousBlocks.length + 1;
	const columns = candidates.length + 1;
	const table = Array.from({ length: rows }, () => new Uint16Array(columns));
	const key = (block) => `${block.kind}:${block.textHash}`;
	for (let left = 1; left < rows; left += 1) {
		for (let right = 1; right < columns; right += 1) {
			table[left][right] = key(previousBlocks[left - 1]) === key(candidates[right - 1])
				? table[left - 1][right - 1] + 1
				: Math.max(table[left - 1][right], table[left][right - 1]);
		}
	}

	const matches = [];
	let left = previousBlocks.length;
	let right = candidates.length;
	while (left > 0 && right > 0) {
		if (key(previousBlocks[left - 1]) === key(candidates[right - 1])) {
			matches.push([left - 1, right - 1]);
			left -= 1;
			right -= 1;
		} else if (table[left - 1][right] >= table[left][right - 1]) {
			left -= 1;
		} else {
			right -= 1;
		}
	}
	return matches.reverse();
}

function criticalPunctuation(text) {
	return [...text].filter((character) => /[？！!?…]/u.test(character)).join('');
}

function maxExistingBlockNumber(blocks) {
	return blocks.reduce((maximum, block) => {
		const match = /-b(\d+)$/u.exec(String(block.blockId));
		return Math.max(maximum, match ? Number(match[1]) : 0);
	}, 0);
}

export function reconcileAudioBlocks(chapterId, candidates, previousMap) {
	const previousBlocks = Array.isArray(previousMap?.blocks) ? previousMap.blocks : [];
	const matchedPrevious = new Set();
	const matchByCandidate = new Map();

	for (const [previousIndex, candidateIndex] of lcsExactMatches(previousBlocks, candidates)) {
		matchedPrevious.add(previousIndex);
		matchByCandidate.set(candidateIndex, previousIndex);
	}

	// Recover exact moved blocks after sequence matching. Duplicates are only paired
	// when a single unambiguous candidate remains.
	for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
		if (matchByCandidate.has(candidateIndex)) continue;
		const candidate = candidates[candidateIndex];
		const choices = previousBlocks
			.map((block, index) => ({ block, index }))
			.filter(({ block, index }) => !matchedPrevious.has(index)
				&& block.kind === candidate.kind && block.textHash === candidate.textHash);
		if (choices.length === 1) {
			matchedPrevious.add(choices[0].index);
			matchByCandidate.set(candidateIndex, choices[0].index);
		}
	}

	// Fuzzy pairing is used only to preserve a stable identity. Annotation reuse
	// has stricter thresholds below.
	const fuzzyPairs = [];
	for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
		if (matchByCandidate.has(candidateIndex)) continue;
		for (let previousIndex = 0; previousIndex < previousBlocks.length; previousIndex += 1) {
			if (matchedPrevious.has(previousIndex)) continue;
			const candidate = candidates[candidateIndex];
			const previous = previousBlocks[previousIndex];
			if (candidate.kind !== previous.kind) continue;
			const ratio = textChangeRatio(previous.text, candidate.text);
			if (ratio > 0.65) continue;
			const orderDistance = Math.abs(
				candidateIndex / Math.max(1, candidates.length)
				- previousIndex / Math.max(1, previousBlocks.length),
			);
			fuzzyPairs.push({ candidateIndex, previousIndex, ratio, score: 1 - ratio - orderDistance * 0.15 });
		}
	}
	fuzzyPairs.sort((left, right) => right.score - left.score);
	for (const pair of fuzzyPairs) {
		if (matchByCandidate.has(pair.candidateIndex) || matchedPrevious.has(pair.previousIndex)) continue;
		matchByCandidate.set(pair.candidateIndex, pair.previousIndex);
		matchedPrevious.add(pair.previousIndex);
	}

	let nextBlockNumber = Math.max(
		Number(previousMap?.nextBlockNumber) || 1,
		maxExistingBlockNumber(previousBlocks) + 1,
	);
	const blocks = candidates.map((candidate, candidateIndex) => {
		const previousIndex = matchByCandidate.get(candidateIndex);
		if (previousIndex === undefined) {
			const blockId = `${chapterId}-b${String(nextBlockNumber).padStart(4, '0')}`;
			nextBlockNumber += 1;
			return { ...candidate, blockId, matchStatus: 'new', reviewReason: '新增语音块' };
		}

		const previous = previousBlocks[previousIndex];
		const ratio = textChangeRatio(previous.text, candidate.text);
		const exact = ratio === 0;
		const contextChanged = Boolean(previous.contextHash)
			&& previous.contextHash !== candidate.contextHash;
		const punctuationChanged = criticalPunctuation(previous.text) !== criticalPunctuation(candidate.text);
		const semanticRisk = candidate.kind === 'dialogue' && (contextChanged || punctuationChanged);
		const reuseThreshold = candidate.kind === 'narration' ? 0.30
			: candidate.kind === 'dialogue' ? 0.10 : 0;

		let matchStatus = 'unchanged';
		let reviewReason;
		if (exact && semanticRisk) {
			matchStatus = 'needs-review';
			reviewReason = contextChanged ? '对话前后文发生变化' : '关键语气标点发生变化';
		} else if (!exact && ratio < reuseThreshold && !semanticRisk) {
			matchStatus = 'auto-reused';
		} else if (!exact) {
			matchStatus = 'needs-review';
			reviewReason = candidate.kind === 'poetry'
				? '诗词正文发生变化'
				: `变化率 ${(ratio * 100).toFixed(1)}% 超出自动继承条件`;
		}

		return {
			...candidate,
			blockId: previous.blockId,
			matchStatus,
			...(reviewReason ? { reviewReason } : {}),
			...(exact ? {} : { changeRatio: Number(ratio.toFixed(4)) }),
			...(matchStatus === 'unchanged' ? { renders: previous.renders } : {}),
		};
	});

	return {
		blocks,
		nextBlockNumber,
		sourceSpeechHash: hashJson(blocks.map(({ kind, text }) => ({ kind, text }))),
		changes: {
			new: blocks.filter((block) => block.matchStatus === 'new').length,
			autoReused: blocks.filter((block) => block.matchStatus === 'auto-reused').length,
			needsReview: blocks.filter((block) => block.matchStatus === 'needs-review').length,
			unchanged: blocks.filter((block) => block.matchStatus === 'unchanged').length,
			removed: previousBlocks.length - matchedPrevious.size,
		},
	};
}

function assertEnum(value, allowed, field, blockId) {
	if (!allowed.has(value)) {
		throw new Error(`标注 ${blockId}.${field} 的值“${String(value)}”无效。`);
	}
}

export function normalizeVoiceAnnotation(annotation, blockId) {
	if (!annotation || typeof annotation !== 'object' || Array.isArray(annotation)) {
		throw new Error(`标注 ${blockId} 必须是对象。`);
	}
	if (typeof annotation.speakerRef !== 'string' || !annotation.speakerRef) {
		throw new Error(`标注 ${blockId}.speakerRef 不能为空。`);
	}
	if (!annotation.emotion || typeof annotation.emotion !== 'object') {
		throw new Error(`标注 ${blockId}.emotion 必须是对象。`);
	}
	assertEnum(annotation.emotion.family, EMOTION_FAMILIES, 'emotion.family', blockId);
	if (typeof annotation.emotion.variant !== 'string' || !annotation.emotion.variant.trim()) {
		throw new Error(`标注 ${blockId}.emotion.variant 不能为空。`);
	}
	if (!Number.isInteger(annotation.emotion.intensity)
		|| annotation.emotion.intensity < 0 || annotation.emotion.intensity > 3) {
		throw new Error(`标注 ${blockId}.emotion.intensity 必须是 0 到 3 的整数。`);
	}
	assertEnum(annotation.pace, PACES, 'pace', blockId);
	assertEnum(annotation.pitch, PITCHES, 'pitch', blockId);
	assertEnum(annotation.energy, ENERGIES, 'energy', blockId);
	if (!Array.isArray(annotation.timbre) || annotation.timbre.length === 0) {
		throw new Error(`标注 ${blockId}.timbre 必须是非空数组。`);
	}
	for (const value of annotation.timbre) assertEnum(value, TIMBRES, 'timbre', blockId);
	if (!Array.isArray(annotation.modifiers)) {
		throw new Error(`标注 ${blockId}.modifiers 必须是数组。`);
	}
	for (const value of annotation.modifiers) assertEnum(value, MODIFIERS, 'modifiers', blockId);
	assertEnum(annotation.reviewStatus, REVIEW_STATUSES, 'reviewStatus', blockId);
	if (typeof annotation.textHash !== 'string' || typeof annotation.contextHash !== 'string') {
		throw new Error(`标注 ${blockId} 缺少 textHash 或 contextHash。`);
	}
	if (annotation.confidence !== undefined
		&& (typeof annotation.confidence !== 'number'
			|| annotation.confidence < 0 || annotation.confidence > 1)) {
		throw new Error(`标注 ${blockId}.confidence 必须介于 0 和 1。`);
	}

	return {
		textHash: annotation.textHash,
		contextHash: annotation.contextHash,
		speakerRef: annotation.speakerRef,
		emotion: {
			family: annotation.emotion.family,
			variant: annotation.emotion.variant.trim(),
			intensity: annotation.emotion.intensity,
		},
		pace: annotation.pace,
		pitch: annotation.pitch,
		energy: annotation.energy,
		timbre: [...new Set(annotation.timbre)],
		modifiers: [...new Set(annotation.modifiers)],
		reviewStatus: annotation.reviewStatus,
		...(annotation.note ? { note: String(annotation.note) } : {}),
		...(annotation.confidence !== undefined ? { confidence: annotation.confidence } : {}),
	};
}

export function voiceAnnotationHash(annotation) {
	return hashJson({
		speakerRef: annotation.speakerRef,
		emotion: annotation.emotion,
		pace: annotation.pace,
		pitch: annotation.pitch,
		energy: annotation.energy,
		timbre: annotation.timbre,
		modifiers: annotation.modifiers,
	});
}

export function resolveChapterAnnotations({ chapterId, blocks, document, voiceCardIds }) {
	if (!document) {
		document = { version: AUDIO_BLOCK_SCHEMA_VERSION, chapter: chapterId, annotations: {} };
	}
	if (Number(document.version) !== AUDIO_BLOCK_SCHEMA_VERSION
		|| String(document.chapter).padStart(3, '0') !== chapterId
		|| !document.annotations || typeof document.annotations !== 'object') {
		throw new Error(`content/audio/annotations/${chapterId}.json 的 version、chapter 或 annotations 无效。`);
	}

	const accepted = {};
	const pending = [];
	for (const block of blocks) {
		const raw = document.annotations[block.blockId];
		if (!raw) {
			pending.push({ block, reason: block.reviewReason || '缺少语音标注' });
			continue;
		}
		const annotation = normalizeVoiceAnnotation(raw, block.blockId);
		if (annotation.speakerRef !== '$narrator' && !voiceCardIds.has(annotation.speakerRef)) {
			throw new Error(`标注 ${block.blockId} 引用了不存在的音色卡“${annotation.speakerRef}”。`);
		}

		if (block.matchStatus === 'auto-reused') {
			accepted[block.blockId] = {
				...annotation,
				textHash: block.textHash,
				contextHash: block.contextHash,
				reviewStatus: 'auto-reused',
				note: `自动继承旧标注；正文变化率 ${((block.changeRatio || 0) * 100).toFixed(1)}%。`,
			};
			continue;
		}

		const textIsCurrent = annotation.textHash === block.textHash;
		const contextIsCurrent = annotation.contextHash === block.contextHash;
		const manualReviewRequired = block.matchStatus === 'new' || block.matchStatus === 'needs-review';
		if (!textIsCurrent || (block.kind === 'dialogue' && !contextIsCurrent)
			|| (manualReviewRequired && annotation.reviewStatus === 'auto-reused')) {
			pending.push({ block, reason: block.reviewReason || '标注绑定的正文或前后文已过期' });
			continue;
		}
		accepted[block.blockId] = annotation;
	}

	const nextDocument = {
		version: AUDIO_BLOCK_SCHEMA_VERSION,
		chapter: chapterId,
		annotations: { ...document.annotations, ...accepted },
	};
	nextDocument.annotationSetHash = hashJson(nextDocument.annotations);
	return { accepted, pending, document: nextDocument };
}

export const ANNOTATION_VOCABULARY = {
	emotionFamilies: [...EMOTION_FAMILIES],
	paces: [...PACES],
	pitches: [...PITCHES],
	energies: [...ENERGIES],
	timbres: [...TIMBRES],
	modifiers: [...MODIFIERS],
};
