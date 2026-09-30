import { createHash } from 'node:crypto';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import { ORTHOGRAPHY_MAP } from './constants.js';

const OMITTED_MARKS = new Set(['zp', 'mp', 'zpsc', 'title']);
const VERSE_MARKS = new Set(['sc', 'fu']);
const EDITORIAL_COMMENT = /【[^】]*】/gu;
const FRONTMATTER = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/u;
const HEADING = /^\s*第[〇零一二两三四五六七八九十百0-9]+回[^\n]*(?:\n|$)/u;
const OPEN_QUOTES = new Set(['“', '‘', '「', '『']);
const CLOSE_QUOTES = new Set(['”', '’', '」', '』']);
const PRESERVED_CJK_PUNCTUATION = new Set([
	'，', '。', '；', '：', '！', '？', '、', '“', '”', '‘', '’', '「', '」', '『', '』',
	'（', '）', '《', '》', '〈', '〉', '【', '】', '——', '…',
]);
const ASCII_PUNCTUATION_MAP = new Map([
	[',', '，'], [':', '：'], [';', '；'], ['!', '！'], ['?', '？'],
]);

export function sha256(value) {
	return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function stripFrontmatterWithOffset(source) {
	const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	const match = FRONTMATTER.exec(normalized);
	if (/^---[ \t]*\n/u.test(normalized) && !match) {
		throw new Error('章节 frontmatter 未闭合，请检查开头和结尾的 ---。');
	}
	return {
		body: match ? normalized.slice(match[0].length) : normalized,
		offset: match?.[0].length ?? 0,
		frontmatter: match?.[0] ?? '',
	};
}

export function extractFrontmatterEntities(frontmatter) {
	const values = [];
	for (const key of ['characters', 'locations']) {
		const block = new RegExp(`^${key}:[ \\t]*\\n((?:[ \\t]+-[^\\n]*\\n?)*)`, 'mu').exec(frontmatter)?.[1] ?? '';
		for (const match of block.matchAll(/^[ \t]+-[ \t]+(.+?)[ \t]*$/gmu)) {
			const value = match[1]
				.replace(/^['"]|['"]$/gu, '')
				.replace(/（[^）]*）/gu, '')
				.trim();
			if (value.length >= 2 && value.length <= 20) values.push(value);
		}
	}
	return values;
}

function appendMapped(target, text, sourceOffset) {
	let relativeOffset = 0;
	for (const character of text) {
		target.text += character;
		target.sourceMap.push(sourceOffset + relativeOffset);
		relativeOffset += character.length;
	}
}

function collectTrack(nodes, frontmatterOffset, prose, verse, activeTrack = 'prose') {
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				appendMapped(
					activeTrack === 'verse' ? verse : prose,
					node.value,
					frontmatterOffset + node.position.offset,
				);
				break;
			case 'hard-break':
				appendMapped(
					activeTrack === 'verse' ? verse : prose,
					'\n',
					frontmatterOffset + node.position.offset,
				);
				break;
			case 'note-reference':
			case 'image':
				break;
			case 'mark':
				if (OMITTED_MARKS.has(node.kind)) break;
				collectTrack(
					node.children,
					frontmatterOffset,
					prose,
					verse,
					VERSE_MARKS.has(node.kind) ? 'verse' : activeTrack,
				);
				break;
			default:
				throw new Error(`无法处理未知章节节点：${String(node.type)}`);
		}
	}
}

function filterMapped(mapped, predicate) {
	let text = '';
	const sourceMap = [];
	for (let index = 0; index < mapped.text.length;) {
		const codePoint = mapped.text.codePointAt(index);
		const character = String.fromCodePoint(codePoint);
		const keep = predicate(character, index);
		if (keep) {
			text += character;
			for (let offset = 0; offset < character.length; offset += 1) {
				sourceMap.push(mapped.sourceMap[index] ?? mapped.sourceMap.at(-1) ?? 0);
			}
		}
		index += character.length;
	}
	return { text, sourceMap };
}

function removeEditorialComments(mapped) {
	const ranges = [...mapped.text.matchAll(EDITORIAL_COMMENT)]
		.map((match) => [match.index, match.index + match[0].length]);
	if (ranges.length === 0) return mapped;
	let rangeIndex = 0;
	return filterMapped(mapped, (_character, index) => {
		while (ranges[rangeIndex] && index >= ranges[rangeIndex][1]) rangeIndex += 1;
		const range = ranges[rangeIndex];
		return !range || index < range[0] || index >= range[1];
	});
}

function removeLeadingHeading(mapped) {
	const match = HEADING.exec(mapped.text);
	if (!match) return mapped;
	const end = match[0].length;
	return {
		text: mapped.text.slice(end),
		sourceMap: mapped.sourceMap.slice(end),
	};
}

export function normalizeMappedText(mapped) {
	let text = '';
	const sourceMap = [];
	let pendingSpace = false;
	let pendingOffset = 0;
	let changes = 0;
	let doubleQuoteOpen = false;
	let singleQuoteOpen = false;

	for (let index = 0; index < mapped.text.length;) {
		const codePoint = mapped.text.codePointAt(index);
		const original = String.fromCodePoint(codePoint);
		const sourceOffset = mapped.sourceMap[index] ?? mapped.sourceMap.at(-1) ?? 0;
		index += original.length;

		if (/\s/u.test(original)) {
			if (text && !text.endsWith('\n')) {
				pendingSpace = true;
				pendingOffset = sourceOffset;
			}
			continue;
		}

		let normalized;
		if (original === '"') {
			normalized = doubleQuoteOpen ? '”' : '“';
			doubleQuoteOpen = !doubleQuoteOpen;
		} else if (original === "'") {
			normalized = singleQuoteOpen ? '’' : '‘';
			singleQuoteOpen = !singleQuoteOpen;
		} else {
			normalized = ASCII_PUNCTUATION_MAP.get(original)
				?? (PRESERVED_CJK_PUNCTUATION.has(original) ? original : original.normalize('NFKC'));
		}
		normalized = [...normalized].map((character) => ORTHOGRAPHY_MAP.get(character) ?? character).join('');
		if (normalized !== original) changes += 1;
		if (pendingSpace && text && !/[“‘「『（《]/u.test(normalized) && !/[，。；：！？、”’」』）》]/u.test(text.at(-1))) {
			text += ' ';
			sourceMap.push(pendingOffset);
		}
		pendingSpace = false;
		text += normalized;
		for (const character of normalized) {
			for (let offset = 0; offset < character.length; offset += 1) sourceMap.push(sourceOffset);
		}
	}

	return { text: text.trim(), sourceMap: sourceMap.slice(0, text.trim().length), changes };
}

export function normalizePlainText(source) {
	const normalizedSource = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	const mapped = {
		text: normalizedSource,
		sourceMap: Array.from({ length: normalizedSource.length }, (_value, index) => index),
	};
	return normalizeMappedText(removeLeadingHeading(removeEditorialComments(mapped)));
}

export function maskEntities(text, entities) {
	let masked = text;
	for (const entity of [...new Set(entities)].sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-CN'))) {
		if (entity.length < 2) continue;
		masked = masked.replaceAll(entity, '○'.repeat([...entity].length));
	}
	return masked;
}

export function extractChapterTracks(source, sourceName = '<chapter>') {
	const stripped = stripFrontmatterWithOffset(source);
	const compiled = compileChapter(
		stripped.body.replace(/\[wz\d+\]/giu, '[wz]'),
		{ sourceName },
	);
	const prose = { text: '', sourceMap: [] };
	const verse = { text: '', sourceMap: [] };
	collectTrack(compiled.nodes, stripped.offset, prose, verse);
	const rawProse = removeLeadingHeading(removeEditorialComments(prose));
	const rawVerse = removeEditorialComments(verse);
	return {
		prose: { raw: rawProse, normalized: normalizeMappedText(rawProse) },
		verse: { raw: rawVerse, normalized: normalizeMappedText(rawVerse) },
		entities: extractFrontmatterEntities(stripped.frontmatter),
		sourceHash: sha256(source.replace(/\r\n?/gu, '\n')),
	};
}

export function countHan(text) {
	return [...text.matchAll(/[\p{Script=Han}]/gu)].length;
}

export function dialogueStats(text) {
	let depth = 0;
	let dialogueCharacters = 0;
	let turns = 0;
	let hanCharacters = 0;
	for (const character of text) {
		if (OPEN_QUOTES.has(character)) {
			if (depth === 0) turns += 1;
			depth += 1;
			continue;
		}
		if (CLOSE_QUOTES.has(character)) {
			depth = Math.max(0, depth - 1);
			continue;
		}
		if (/\p{Script=Han}/u.test(character)) {
			hanCharacters += 1;
			if (depth > 0) dialogueCharacters += 1;
		}
	}
	return {
		dialogueCharacters,
		dialogueRatio: hanCharacters ? dialogueCharacters / hanCharacters : 0,
		hanCharacters,
		turns,
		unclosedQuotes: depth,
	};
}
