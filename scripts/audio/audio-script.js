import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join, relative } from 'node:path';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import {
	chapterToSpeechText,
	normalizeLegacyNoteMarkers,
	stripFrontmatter,
} from './chapter-text.js';

const EMOTIONS = new Set([
	'neutral', 'warm', 'joy', 'sad', 'anger', 'fear', 'urgent', 'whisper', 'solemn',
]);
const VOICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const VOICE_OPEN_PATTERN = /^\[voice:([a-z0-9]+(?:-[a-z0-9]+)*)\|([a-z]+)\]/u;
const SOURCE_OPEN_PATTERN = /^\[(?:zp|mp|zpsc|sc|fu|B|T|wz\d*|img)\]/u;
const VOICE_START_PREFIX = '\uE000';
const VOICE_START_SUFFIX = '\uE001';
const VOICE_END = '\uE002';
const VOICE_TOKEN_PATTERN = /\uE000(\d+)\uE001|\uE002/gu;

function hash(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

function unquote(value) {
	const trimmed = value.trim();
	if (trimmed.length >= 2
		&& ((trimmed.startsWith('"') && trimmed.endsWith('"'))
			|| (trimmed.startsWith("'") && trimmed.endsWith("'")))) {
		return trimmed.slice(1, -1);
	}
	return trimmed;
}

function parseAudioFrontmatter(source) {
	const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	const match = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/u.exec(normalized);
	if (!match) throw new Error('音频脚本缺少或未闭合 YAML frontmatter。');

	const metadata = {};
	for (const line of match[1].split('\n')) {
		if (!line.trim() || line.trimStart().startsWith('#')) continue;
		const field = /^([A-Za-z][A-Za-z0-9_-]*):[ \t]*(.*)$/u.exec(line);
		if (!field) throw new Error(`音频脚本 frontmatter 行无法解析：${line}`);
		metadata[field[1]] = unquote(field[2]);
	}
	return { metadata, body: normalized.slice(match[0].length) };
}

function sourceDifference(left, right) {
	const limit = Math.min(left.length, right.length);
	let offset = 0;
	while (offset < limit && left[offset] === right[offset]) offset += 1;
	if (offset === limit && left.length === right.length) return undefined;
	const before = left.slice(0, offset);
	const line = before.split('\n').length;
	const column = offset - before.lastIndexOf('\n');
	return { offset, line, column };
}

/**
 * Remove voice tags while inserting private sentinels that survive chapter AST filtering.
 */
export function injectVoiceSentinels(body) {
	if (/[\uE000-\uE002]/u.test(body)) {
		throw new Error('音频脚本正文包含保留字符 U+E000 至 U+E002。');
	}

	let canonicalSource = '';
	let markedSource = '';
	let activeVoice;
	let nestedSourceDepth = 0;
	const markers = [];

	const appendSource = (value) => {
		canonicalSource += value;
		markedSource += value;
	};

	for (let index = 0; index < body.length;) {
		if (body[index] === '\\' && body[index + 1] === '[') {
			appendSource(body.slice(index, index + 2));
			index += 2;
			continue;
		}

		const remaining = body.slice(index);
		const voiceOpening = VOICE_OPEN_PATTERN.exec(remaining);
		if (voiceOpening) {
			if (activeVoice) throw new Error(`音频脚本在字符 ${index} 嵌套了 voice 标记。`);
			const [, voiceCardId, emotion] = voiceOpening;
			if (!EMOTIONS.has(emotion)) {
				throw new Error(`音频脚本使用了不支持的情感“${emotion}”。`);
			}
			activeVoice = { voiceCardId, emotion, offset: index };
			nestedSourceDepth = 0;
			markers.push(activeVoice);
			markedSource += `${VOICE_START_PREFIX}${markers.length - 1}${VOICE_START_SUFFIX}`;
			index += voiceOpening[0].length;
			continue;
		}
		if (remaining.startsWith('[voice:')) {
			throw new Error(`音频脚本在字符 ${index} 的 voice 标记格式无效。`);
		}

		if (activeVoice && remaining.startsWith('[-]')) {
			if (nestedSourceDepth === 0) {
				markedSource += VOICE_END;
				activeVoice = undefined;
				index += 3;
				continue;
			}
			nestedSourceDepth -= 1;
			appendSource('[-]');
			index += 3;
			continue;
		}

		if (activeVoice) {
			const sourceOpening = SOURCE_OPEN_PATTERN.exec(remaining);
			if (sourceOpening) {
				if (sourceOpening[0] === '[T]') {
					throw new Error(`voice 标记内不能在字符 ${index} 打开 [T]。`);
				}
				nestedSourceDepth += 1;
				appendSource(sourceOpening[0]);
				index += sourceOpening[0].length;
				continue;
			}
		}

		appendSource(body[index]);
		index += 1;
	}

	if (activeVoice) {
		throw new Error(`音频脚本在字符 ${activeVoice.offset} 打开的 voice 标记没有闭合。`);
	}
	return { canonicalSource, markedSource, markers };
}

export function speechSegmentsFromMarkedChapter(compiled, markers, defaultVoiceCardId) {
	const markedSpeech = chapterToSpeechText(compiled);
	const segments = [];
	const seenMarkers = new Set();
	let cursor = 0;
	let activeVoice;

	const append = (text) => {
		if (!text) return;
		const voiceCardId = activeVoice?.voiceCardId ?? defaultVoiceCardId;
		const emotion = activeVoice?.emotion ?? 'neutral';
		const previous = segments.at(-1);
		if (previous?.voiceCardId === voiceCardId && previous?.emotion === emotion) {
			previous.text += text;
		} else {
			segments.push({ text, voiceCardId, emotion });
		}
	};

	for (const match of markedSpeech.matchAll(VOICE_TOKEN_PATTERN)) {
		append(markedSpeech.slice(cursor, match.index));
		if (match[1] !== undefined) {
			if (activeVoice) throw new Error('过滤后的音频脚本仍含嵌套 voice 标记。');
			const markerIndex = Number(match[1]);
			activeVoice = markers[markerIndex];
			if (!activeVoice) throw new Error(`音频脚本引用了未知 voice 标记 ${markerIndex}。`);
			seenMarkers.add(markerIndex);
		} else {
			if (!activeVoice) throw new Error('过滤后的音频脚本含孤立的 voice 结束标记。');
			activeVoice = undefined;
		}
		cursor = match.index + match[0].length;
	}
	append(markedSpeech.slice(cursor));
	if (activeVoice) throw new Error('过滤后的音频脚本有未闭合 voice 标记。');
	if (seenMarkers.size !== markers.length) {
		throw new Error('有 voice 标记位于脂批、书批、尾注或图片等不朗读内容中。');
	}

	return {
		speechText: markedSpeech.replace(VOICE_TOKEN_PATTERN, '').trim(),
		segments: segments.filter((segment) => segment.text.trim()),
	};
}

export function resolveVoiceSegments(segments, cards) {
	const missing = [...new Set(
		segments.map((segment) => segment.voiceCardId).filter((id) => !cards[id]),
	)];
	if (missing.length > 0) {
		throw new Error(`缺少音色卡：${missing.join('、')}。请先在音色卡会话中补齐。`);
	}

	return segments.map((segment) => {
		const card = cards[segment.voiceCardId];
		if (!card.voice || typeof card.voice !== 'string') {
			throw new Error(`音色卡“${segment.voiceCardId}”缺少 voice。`);
		}
		const emotionOverride = card.emotions?.[segment.emotion];
		if (segment.emotion !== 'neutral' && !emotionOverride) {
			throw new Error(`音色卡“${segment.voiceCardId}”没有情感预设“${segment.emotion}”。`);
		}
		return {
			...segment,
			provider: String(card.provider || 'edge'),
			voice: card.voice,
			rate: String(emotionOverride?.rate ?? card.prosody?.rate ?? '+0%'),
			pitch: String(emotionOverride?.pitch ?? card.prosody?.pitch ?? '+0Hz'),
			volume: String(emotionOverride?.volume ?? card.prosody?.volume ?? '+0%'),
		};
	});
}

async function loadVoiceCards(projectRoot, referencedIds) {
	const directory = join(projectRoot, 'content', 'audio', 'voice-cards');
	const indexPath = join(directory, 'index.json');
	let indexRaw;
	let index;
	try {
		indexRaw = await readFile(indexPath, 'utf8');
		index = JSON.parse(indexRaw);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error('找不到 content/audio/voice-cards/index.json，请先运行音色卡制作会话。');
		}
		if (error instanceof SyntaxError) throw new Error('音色卡 index.json 不是有效 JSON。');
		throw error;
	}
	if (Number(index.version) !== 1 || !index.cards || typeof index.cards !== 'object') {
		throw new Error('音色卡 index.json 的 version 必须为 1，且必须包含 cards 对象。');
	}

	const cards = {};
	const cardSources = [];
	const missing = [];
	for (const id of [...referencedIds].sort()) {
		if (!VOICE_ID_PATTERN.test(id)) throw new Error(`音色卡 ID“${id}”格式无效。`);
		const filename = index.cards?.[id];
		if (typeof filename !== 'string') {
			missing.push(id);
			continue;
		}
		if (basename(filename) !== filename || !filename.toLowerCase().endsWith('.json')) {
			throw new Error(`音色卡“${id}”的文件路径不安全：${filename}`);
		}
		try {
			const cardRaw = await readFile(join(directory, filename), 'utf8');
			const card = JSON.parse(cardRaw);
			if (Number(card.version) !== 1) throw new Error(`音色卡 ${filename} 的 version 必须为 1。`);
			if (card.id !== id) throw new Error(`音色卡文件 ${filename} 的 id 与索引不一致。`);
			cards[id] = card;
			cardSources.push(`${filename}\n${cardRaw}`);
		} catch (error) {
			if (error?.code === 'ENOENT') {
				missing.push(id);
				continue;
			}
			if (error instanceof SyntaxError) throw new Error(`音色卡 ${filename} 不是有效 JSON。`);
			throw error;
		}
	}
	if (missing.length > 0) {
		throw new Error(`缺少音色卡：${missing.join('、')}。请先在音色卡会话中补齐。`);
	}
	return { cards, catalogHash: hash(`${indexRaw}\n${cardSources.join('\n')}`) };
}

/**
 * Load and validate content/audio/chapters/NNN.audio.md when it exists.
 */
export async function loadAnnotatedAudioPlan({
	projectRoot,
	chapterId,
	chapterPath,
	rawChapterSource,
}) {
	const audioScriptPath = join(projectRoot, 'content', 'audio', 'chapters', `${chapterId}.audio.md`);
	let audioScriptRaw;
	try {
		audioScriptRaw = await readFile(audioScriptPath, 'utf8');
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}

	const { metadata, body } = parseAudioFrontmatter(audioScriptRaw);
	if (Number(metadata.version) !== 1) throw new Error('音频脚本 version 必须为 1。');
	if (Number(metadata.chapter) !== Number(chapterId)) {
		throw new Error(`音频脚本 chapter 必须为 ${Number(chapterId)}。`);
	}
	const expectedSource = relative(projectRoot, chapterPath).replaceAll('\\', '/');
	if (metadata.source !== expectedSource) {
		throw new Error(`音频脚本 source 应为 ${expectedSource}。`);
	}
	const expectedRawSourceHash = hash(rawChapterSource);
	if (String(metadata.sourceHash || '').toLowerCase() !== expectedRawSourceHash) {
		throw new Error('音频脚本 sourceHash 已过期；原始章节发生了变化，请重新标注或更新脚本。');
	}
	const defaultVoiceCardId = String(metadata.defaultVoice || '');
	if (!VOICE_ID_PATTERN.test(defaultVoiceCardId)) {
		throw new Error('音频脚本 defaultVoice 必须是有效的音色卡 ID。');
	}

	const injected = injectVoiceSentinels(body);
	const canonicalBody = stripFrontmatter(rawChapterSource);
	const difference = sourceDifference(injected.canonicalSource, canonicalBody);
	if (difference) {
		throw new Error(
			`移除 voice 标记后与原始章节不一致（第 ${difference.line} 行，第 ${difference.column} 列）。`,
		);
	}

	const sourceName = relative(projectRoot, audioScriptPath).replaceAll('\\', '/');
	const markedChapter = compileChapter(
		normalizeLegacyNoteMarkers(injected.markedSource),
		{ sourceName },
	);
	const speechPlan = speechSegmentsFromMarkedChapter(
		markedChapter,
		injected.markers,
		defaultVoiceCardId,
	);
	const canonicalChapter = compileChapter(
		normalizeLegacyNoteMarkers(canonicalBody),
		{ sourceName: expectedSource },
	);
	if (speechPlan.speechText !== chapterToSpeechText(canonicalChapter)) {
		throw new Error('voice 分段后的朗读正文与原章节过滤结果不一致。');
	}

	const referencedIds = new Set([
		defaultVoiceCardId,
		...speechPlan.segments.map((segment) => segment.voiceCardId),
	]);
	const { cards, catalogHash } = await loadVoiceCards(projectRoot, referencedIds);
	const segments = resolveVoiceSegments(speechPlan.segments, cards);
	return {
		path: audioScriptPath,
		audioScriptHash: hash(audioScriptRaw),
		voiceCardsHash: catalogHash,
		defaultVoiceCardId,
		voiceCardIds: [...referencedIds].sort(),
		speechText: speechPlan.speechText,
		segments,
	};
}

export { EMOTIONS };
