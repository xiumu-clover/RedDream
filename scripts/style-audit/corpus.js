import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join, relative, resolve } from 'node:path';
import {
	CHUNK_CONFIG,
	ORTHOGRAPHY_MAP_VERSION,
	STYLE_AUDIT_SCHEMA_VERSION,
	STYLE_AUDIT_SEED,
	TRAINING_CHAPTERS,
	TRAINING_GROUPS,
} from './constants.js';
import { chunkText, deterministicShuffle, materializeFragment } from './chunks.js';
import { assignTrainingFolds, splitReferenceChapters } from './scoring.js';
import {
	extractChapterTracks,
	maskEntities,
	normalizePlainText,
	sha256,
} from './text.js';

function stableJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

async function discoverChapterFiles(projectRoot) {
	const directory = join(projectRoot, 'content', 'chapters', 'hongloumeng');
	const files = await readdir(directory);
	const byChapter = new Map();
	for (const file of files) {
		const match = /^(\d{3})-.*\.md$/u.exec(file);
		if (!match) continue;
		const chapter = Number(match[1]);
		if (chapter >= 1 && chapter <= 80) byChapter.set(chapter, join(directory, file));
	}
	const missing = Array.from({ length: 80 }, (_value, index) => index + 1)
		.filter((chapter) => !byChapter.has(chapter));
	if (missing.length) throw new Error(`前八十回源文件不完整，缺少：${missing.join('、')}`);
	return byChapter;
}

function chapterSplit(chapter, split) {
	if (TRAINING_CHAPTERS.includes(chapter)) return 'training';
	return split.test.includes(chapter) ? 'test' : 'calibration';
}

function fragmentsForTrack({ chapter, track, tracks, entities, split, fold, inputId }) {
	const normalizedText = tracks.normalized.text;
	const maskedText = maskEntities(normalizedText, entities);
	return chunkText(normalizedText).map((chunk, index) => materializeFragment({
		chapter,
		inputId,
		track,
		chunk,
		rawMapped: tracks.raw,
		normalizedText,
		maskedText,
		sourceMap: tracks.normalized.sourceMap,
		split,
		fold,
		index,
	}));
}

export async function prepareReferenceCorpus(projectRoot, options = {}) {
	const seed = options.seed ?? STYLE_AUDIT_SEED;
	const paths = await discoverChapterFiles(projectRoot);
	const sources = [];
	const entities = new Set();
	for (const chapter of Array.from(paths.keys()).sort((a, b) => a - b)) {
		const path = paths.get(chapter);
		const source = await readFile(path, 'utf8');
		const tracks = extractChapterTracks(source, relative(projectRoot, path));
		for (const entity of tracks.entities) entities.add(entity);
		sources.push({ chapter, path, source, tracks });
	}
	const entityLexicon = [...entities].sort((left, right) => right.length - left.length || left.localeCompare(right, 'zh-CN'));
	const folds = assignTrainingFolds(TRAINING_GROUPS, seed);
	const remainingChapters = Array.from({ length: 80 }, (_value, index) => index + 1)
		.filter((chapter) => !TRAINING_CHAPTERS.includes(chapter));
	const referenceSplit = splitReferenceChapters(remainingChapters, seed);
	const chapters = [];
	let fragments = [];

	for (const item of sources) {
		const split = chapterSplit(item.chapter, referenceSplit);
		const fold = folds.get(item.chapter) ?? null;
		const prose = fragmentsForTrack({
			chapter: item.chapter,
			track: 'prose',
			tracks: item.tracks.prose,
			entities: entityLexicon,
			split,
			fold,
		});
		const verse = item.tracks.verse.normalized.text
			? fragmentsForTrack({
				chapter: item.chapter,
				track: 'verse',
				tracks: item.tracks.verse,
				entities: entityLexicon,
				split,
				fold,
			})
			: [];
		fragments.push(...prose, ...verse);
		chapters.push({
			chapter: item.chapter,
			file: relative(projectRoot, item.path).replaceAll('\\', '/'),
			sourceHash: item.tracks.sourceHash,
			split,
			fold,
			proseFragments: prose.length,
			verseFragments: verse.length,
			proseCharacters: [...item.tracks.prose.normalized.text].length,
			verseCharacters: [...item.tracks.verse.normalized.text].length,
			normalizationChanges: item.tracks.prose.normalized.changes + item.tracks.verse.normalized.changes,
		});
	}

	fragments = deterministicShuffle(fragments, seed);
	const corpus = {
		schemaVersion: STYLE_AUDIT_SCHEMA_VERSION,
		kind: 'style-audit-reference-corpus',
		seed,
		orthographyMapVersion: ORTHOGRAPHY_MAP_VERSION,
		chunkConfig: CHUNK_CONFIG,
		trainingChapters: [...TRAINING_CHAPTERS],
		calibrationChapters: referenceSplit.calibration,
		testChapters: referenceSplit.test,
		entityLexicon,
		chapters,
		fragments,
	};
	corpus.corpusHash = sha256(stableJson(corpus));
	return corpus;
}

async function discoverAuditFiles(inputPath) {
	const resolved = resolve(inputPath);
	const extension = extname(resolved).toLowerCase();
	if (extension === '.md' || extension === '.txt') return [resolved];
	const files = await readdir(resolved, { withFileTypes: true });
	return files
		.filter((entry) => entry.isFile() && ['.md', '.txt'].includes(extname(entry.name).toLowerCase()))
		.map((entry) => join(resolved, entry.name))
		.sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function rawMapped(source) {
	const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	return { text: normalized, sourceMap: Array.from({ length: normalized.length }, (_value, index) => index) };
}

export async function prepareAuditInputs(inputPath, model) {
	const files = await discoverAuditFiles(inputPath);
	if (!files.length) throw new Error('审验输入中没有 .md 或 .txt 文件。');
	const inputs = [];
	for (const path of files) {
		const source = await readFile(path, 'utf8');
		const inputId = basename(path, extname(path)).replace(/[^\p{Letter}\p{Number}-]+/gu, '-').replace(/^-|-$/gu, '') || 'input';
		let tracks;
		if (/\[T\]/u.test(source)) {
			tracks = extractChapterTracks(source, basename(path)).prose;
		} else {
			tracks = { raw: rawMapped(source), normalized: normalizePlainText(source) };
		}
		const length = [...tracks.normalized.text].length;
		if (length < CHUNK_CONFIG.minimumAuditChars) {
			throw new Error(`${basename(path)} 清洗后仅 ${length} 字；至少需要 ${CHUNK_CONFIG.minimumAuditChars} 字。`);
		}
		const maskedText = maskEntities(tracks.normalized.text, model.entityLexicon);
		let chunks = chunkText(tracks.normalized.text);
		if (!chunks.length) throw new Error(`${basename(path)} 清洗后没有可审验正文。`);
		if (chunks.length === 1 && length < CHUNK_CONFIG.mergeRemainderBelow) {
			chunks = [{ ...chunks[0], lowConfidence: true }];
		}
		const fragments = chunks.map((chunk, index) => ({
			...materializeFragment({
				chapter: null,
				inputId,
				track: 'prose',
				chunk,
				rawMapped: tracks.raw,
				normalizedText: tracks.normalized.text,
				maskedText,
				sourceMap: tracks.normalized.sourceMap,
				split: 'candidate',
				fold: null,
				index,
			}),
			lowConfidence: Boolean(chunk.lowConfidence),
		}));
		inputs.push({
			id: inputId,
			file: resolve(path),
			sourceHash: sha256(source.replace(/\r\n?/gu, '\n')),
			normalizationChanges: tracks.normalized.changes,
			fragments,
		});
	}
	return inputs;
}

