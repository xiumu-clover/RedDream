import { readFile, readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { compileChapter } from '../../../src/lib/chapters/compiler.ts';
import { ORTHOGRAPHY_MAP, ORTHOGRAPHY_MAP_VERSION } from '../constants.js';
import { hash, LIMITS, MODEL, PROMPT, RUBRIC, SCHEMA_VERSION, reviewSchema } from './protocol.js';

export const normalize = (text) => [...text.normalize('NFC').trim()].map((c) => ORTHOGRAPHY_MAP.get(c) ?? c).join('');
export function formatCheck({ upper, lower }) {
	const lengths = [upper, lower].map((text) => [...text].length);
	const issues = [];
	if (lengths.some((n) => n !== 8)) issues.push(`上下句字数为${lengths.join('／')}，参考格式为8／8。`);
	if (lengths[0] !== lengths[1]) issues.push('上下句字数不一致。');
	if ([upper, lower].some((text) => !/^\p{Script=Han}+$/u.test(text))) issues.push('含空白、标点或非汉字，请检查。');
	return { lengths, pass: issues.length === 0, issues };
}
export function validateCandidates(rows) {
	if (!Array.isArray(rows) || !rows.length) throw new Error('候选必须是非空JSON数组。');
	const ids = new Set();
	return rows.map((row) => {
		if (!row || typeof row.id !== 'string' || !row.id.trim() || ids.has(row.id)) throw new Error('候选id缺失或重复。');
		if (!Number.isInteger(row.chapter) || row.chapter < 1 || row.chapter > 108) throw new Error(`${row.id}：chapter须为1—108整数。`);
		for (const key of ['upper', 'lower']) if (typeof row[key] !== 'string' || !row[key].trim() || /[\r\n]/u.test(row[key])) throw new Error(`${row.id}：${key}须为非空单行文字。`);
		ids.add(row.id);
		return { id: row.id, chapter: row.chapter, upper: row.upper.trim(), lower: row.lower.trim() };
	});
}
export function extractTitle(source, chapter, sourceName) {
	const normalizedSource = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	const order = /^order:\s*(\d+)\s*$/mu.exec(normalizedSource)?.[1];
	if (Number(order) !== chapter) throw new Error(`${sourceName}：文件编号与order不符。`);
	const match = /^\[T\][^\n]+/mu.exec(normalizedSource);
	if (!match) throw new Error(`${sourceName}：缺少主标题[T]。`);
	// Compile only the title: body edits and unrelated body syntax must not affect title review.
	const fullTitle = compileChapter(match[0], { sourceName }).title;
	const parts = /^第[〇零一二两三四五六七八九十百\d]+回\s+(.+?)\s+([^\s]+)$/u.exec(fullTitle);
	if (!parts || /\s/u.test(parts[1])) throw new Error(`${sourceName}：回目须含上下两句，以空白分隔。`);
	const upper = parts[1]; const lower = parts[2];
	return { chapter, upper, lower, normalized: { upper: normalize(upper), lower: normalize(lower) }, source: sourceName, rawTitle: fullTitle };
}
export async function readBook(root, book) {
	if (!['hongloumeng', 'guiyou', 'guiyou-original'].includes(book)) throw new Error(`未知书册：${book}`);
	const directory = join(root, 'content', 'chapters', book);
	const [min, max] = book === 'hongloumeng' ? [1, 80] : [81, 108];
	const records = new Map();
	for (const file of (await readdir(directory)).sort()) {
		const match = /^(\d+)(?:-|\.md$)/u.exec(file);
		if (!file.endsWith('.md') || !match) continue;
		const chapter = Number(match[1]);
		if (chapter < min || chapter > max) continue;
		if (records.has(chapter)) throw new Error(`${book}第${chapter}回重复。`);
		const path = join(directory, file);
		records.set(chapter, extractTitle(await readFile(path, 'utf8'), chapter, relative(root, path).replaceAll('\\', '/')));
	}
	for (let chapter = min; chapter <= max; chapter++) if (!records.has(chapter)) throw new Error(`${book}缺少第${chapter}回。`);
	return [...records.values()].sort((a, b) => a.chapter - b.chapter);
}
export async function makeBaseline(root) {
	const references = await readBook(root, 'hongloumeng');
	const referenceHash = hash(references);
	const protocol = { schemaVersion: SCHEMA_VERSION, rubric: RUBRIC, prompt: PROMPT, model: MODEL, limits: LIMITS, normalization: ORTHOGRAPHY_MAP_VERSION, calibrationHash: hash(calibrationCases({ references })), schemas: [reviewSchema(), reviewSchema('pairwise')] };
	return { kind: 'title-reference', schemaVersion: SCHEMA_VERSION, referenceHash, evaluationVersion: hash({ referenceHash, protocol }), references, protocol };
}
export function calibrationCases(baseline) {
	const originals = [7, 24, 39, 74].map((chapter) => {
		const r = baseline.references.find((item) => item.chapter === chapter);
		return { id: `cal-original-${chapter}`, chapter, upper: r.upper, lower: r.lower, caseType: 'original' };
	});
	return [...originals,
		{ id: 'cal-modern-1', chapter: 21, upper: '袭人优化宝玉情绪', lower: '平儿提升贾琏体验', caseType: 'damaged' },
		{ id: 'cal-modern-2', chapter: 53, upper: '宁国府启动年终会', lower: '荣国府打造元宵节', caseType: 'damaged' },
		{ id: 'cal-syntax-1', chapter: 27, upper: '亭翠滴蝶彩戏妃杨', lower: '冢香埋红残泣燕飞', caseType: 'damaged' },
		{ id: 'cal-syntax-2', chapter: 57, upper: '慧紫鹃情辞被忙玉', lower: '慈姨妈爱语把痴颦', caseType: 'damaged' },
		{ id: 'cal-border-1', chapter: 28, upper: '蒋玉菡赠送茜香罗', lower: '薛宝钗佩戴红麝串', caseType: 'boundary' },
		{ id: 'cal-border-2', chapter: 70, upper: '林黛玉再次建诗社', lower: '史湘云偶然填新词', caseType: 'boundary' },
		{ id: 'cal-border-3', chapter: 68, upper: '苦尤娘被骗进花园', lower: '酸凤姐大闹宁国府', caseType: 'boundary' },
		{ id: 'cal-border-4', chapter: 37, upper: '秋爽斋群芳议诗社', lower: '蘅芜苑二美拟诗题', caseType: 'boundary' },
	];
}
export function blindCandidates(rows) {
	return validateCandidates(rows).map((row) => {
		const textHash = hash({ upper: row.upper, lower: row.lower });
		return { ...row, textHash, key: `t-${hash({ id: row.id, textHash }).slice(0, 16)}`, format: formatCheck(row) };
	});
}
