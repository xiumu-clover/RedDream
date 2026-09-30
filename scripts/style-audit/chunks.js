import { CHUNK_CONFIG } from './constants.js';
import { countHan, dialogueStats, sha256 } from './text.js';

const OPEN_QUOTES = new Set(['“', '‘', '「', '『']);
const CLOSE_QUOTES = new Set(['”', '’', '」', '』']);
const STRONG_BOUNDARIES = new Set(['。', '！', '？', '；']);
const SOFT_BOUNDARIES = new Set(['，', '、', '：']);

export function seededRandom(seed) {
	let state = seed >>> 0;
	return () => {
		state += 0x6d2b79f5;
		let value = state;
		value = Math.imul(value ^ (value >>> 15), value | 1);
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
		return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
	};
}

export function deterministicShuffle(values, seed) {
	const output = [...values];
	const random = seededRandom(seed);
	for (let index = output.length - 1; index > 0; index -= 1) {
		const target = Math.floor(random() * (index + 1));
		[output[index], output[target]] = [output[target], output[index]];
	}
	return output;
}

function splitLongUnit(unit, maxChars) {
	if ([...unit.text].length <= maxChars) return [unit];
	const pieces = [];
	let start = 0;
	let depth = 0;
	let lastSoftBoundary = -1;
	let characterCount = 0;
	for (let index = 0; index < unit.text.length;) {
		const character = String.fromCodePoint(unit.text.codePointAt(index));
		if (OPEN_QUOTES.has(character)) depth += 1;
		if (CLOSE_QUOTES.has(character)) depth = Math.max(0, depth - 1);
		characterCount += 1;
		if (depth === 0 && SOFT_BOUNDARIES.has(character)) lastSoftBoundary = index + character.length;
		if (characterCount >= maxChars) {
			const end = lastSoftBoundary > start ? lastSoftBoundary : index + character.length;
			pieces.push({ text: unit.text.slice(start, end), start: unit.start + start, end: unit.start + end });
			start = end;
			index = end;
			characterCount = 0;
			lastSoftBoundary = -1;
			continue;
		}
		index += character.length;
	}
	if (start < unit.text.length) {
		pieces.push({ text: unit.text.slice(start), start: unit.start + start, end: unit.end });
	}
	return pieces;
}

export function sentenceUnits(text, maxChars = CHUNK_CONFIG.maxChars) {
	const units = [];
	let start = 0;
	let depth = 0;
	let pendingBoundary = false;
	for (let index = 0; index < text.length;) {
		const character = String.fromCodePoint(text.codePointAt(index));
		if (OPEN_QUOTES.has(character)) depth += 1;
		if (STRONG_BOUNDARIES.has(character)) pendingBoundary = true;
		if (CLOSE_QUOTES.has(character)) depth = Math.max(0, depth - 1);
		const newlineBoundary = character === '\n' && depth === 0;
		const shouldSplit = (pendingBoundary && depth === 0) || newlineBoundary;
		index += character.length;
		if (shouldSplit) {
			while (index < text.length && CLOSE_QUOTES.has(text[index])) index += 1;
			const slice = text.slice(start, index).trim();
			if (slice) {
				const leading = text.slice(start, index).indexOf(slice);
				const unitStart = start + Math.max(0, leading);
				units.push(...splitLongUnit({ text: slice, start: unitStart, end: unitStart + slice.length }, maxChars));
			}
			start = index;
			pendingBoundary = false;
		}
	}
	const tail = text.slice(start).trim();
	if (tail) {
		const leading = text.slice(start).indexOf(tail);
		const unitStart = start + Math.max(0, leading);
		units.push(...splitLongUnit({ text: tail, start: unitStart, end: unitStart + tail.length }, maxChars));
	}
	return units;
}

function characterLength(text) {
	return [...text].length;
}

function buildChunk(units) {
	const start = units[0].start;
	const end = units.at(-1).end;
	return { units, start, end, text: units.map((unit) => unit.text).join('') };
}

function rebalanceRemainder(chunks, config) {
	if (chunks.length < 2) return chunks;
	const last = chunks.at(-1);
	if (characterLength(last.text) >= config.mergeRemainderBelow) return chunks;
	const previous = chunks.at(-2);
	if (characterLength(previous.text) + characterLength(last.text) <= config.maxChars) {
		return [...chunks.slice(0, -2), buildChunk([...previous.units, ...last.units])];
	}
	const previousUnits = [...previous.units];
	const lastUnits = [...last.units];
	while (previousUnits.length > 1 && characterLength(lastUnits.map((unit) => unit.text).join('')) < config.mergeRemainderBelow) {
		lastUnits.unshift(previousUnits.pop());
	}
	return [...chunks.slice(0, -2), buildChunk(previousUnits), buildChunk(lastUnits)];
}

export function chunkText(text, config = CHUNK_CONFIG) {
	const units = sentenceUnits(text, config.maxChars);
	if (units.length === 0) return [];
	const chunks = [];
	let current = [];
	let currentLength = 0;
	for (const unit of units) {
		const unitLength = characterLength(unit.text);
		if (current.length > 0 && currentLength >= config.minChars && currentLength + unitLength > config.maxChars) {
			chunks.push(buildChunk(current));
			current = [];
			currentLength = 0;
		}
		current.push(unit);
		currentLength += unitLength;
		if (currentLength >= config.targetChars) {
			chunks.push(buildChunk(current));
			current = [];
			currentLength = 0;
		}
	}
	if (current.length > 0) chunks.push(buildChunk(current));
	return rebalanceRemainder(chunks, config);
}

export function materializeFragment({
	chapter,
	track,
	chunk,
	rawMapped,
	normalizedText,
	maskedText,
	sourceMap,
	split,
	fold,
	index,
	inputId,
}) {
	const start = chunk.start;
	const end = chunk.end;
	const text = maskedText.slice(start, end);
	const normalized = normalizedText.slice(start, end);
	const stats = dialogueStats(normalized);
	const sourceStart = sourceMap[start] ?? null;
	const sourceEnd = end > start && sourceMap[end - 1] != null ? sourceMap[end - 1] + 1 : sourceStart;
	let raw = normalized;
	if (rawMapped && sourceStart != null && sourceEnd != null) {
		let rawStart = rawMapped.sourceMap.findIndex((offset) => offset >= sourceStart);
		if (rawStart < 0) rawStart = 0;
		let rawEnd = rawStart;
		while (rawEnd < rawMapped.sourceMap.length && rawMapped.sourceMap[rawEnd] < sourceEnd) rawEnd += 1;
		raw = rawMapped.text.slice(rawStart, rawEnd).trim();
	}
	const idPrefix = chapter ? String(chapter).padStart(3, '0') : inputId;
	return {
		id: `${idPrefix}-${track}-${String(index + 1).padStart(3, '0')}`,
		chapter: chapter ?? null,
		inputId: inputId ?? null,
		track,
		split,
		fold: fold ?? null,
		cleanOffset: { start, end },
		sourceOffset: { start: sourceStart, end: sourceEnd },
		characters: characterLength(text),
		hanCharacters: countHan(normalized),
		dialogueRatio: stats.dialogueRatio,
		dialogueTurns: stats.turns,
		unclosedQuotes: stats.unclosedQuotes,
		textHash: sha256(text),
		rawText: raw,
		normalizedText: normalized,
		maskedText: text,
	};
}
