import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { prepareReferenceCorpus } from '../../scripts/style-audit/corpus.js';
import { renderReferenceAnalysis } from '../../scripts/style-audit/reference-analysis.js';
import { renderMarkdownReport } from '../../scripts/style-audit/report.js';

test('参考语料严格按整回分组，17—18 回同折且三类集合互斥', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'hlm-style-audit-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const chapterDirectory = join(root, 'content', 'chapters', 'hongloumeng');
	await mkdir(chapterDirectory, { recursive: true });
	for (let chapter = 1; chapter <= 80; chapter += 1) {
		const id = String(chapter).padStart(3, '0');
		const body = `话说第${chapter}回众人听见，忙道：“原来如此。”一时都笑起来。`.repeat(35);
		await writeFile(
			join(chapterDirectory, `${id}-测试.md`),
			`---\norder: ${chapter}\ncharacters:\n  - 贾宝玉\nlocations:\n  - 怡红院\n---\n[T]第${chapter}回 测试\n${body}`,
			'utf8',
		);
	}

	const corpus = await prepareReferenceCorpus(root, { seed: 7 });
	const chapter17 = corpus.chapters.find((chapter) => chapter.chapter === 17);
	const chapter18 = corpus.chapters.find((chapter) => chapter.chapter === 18);
	assert.equal(chapter17?.fold, chapter18?.fold);
	assert.equal(chapter17?.split, 'training');
	assert.equal(chapter18?.split, 'training');
	const training = new Set(corpus.trainingChapters);
	const calibration = new Set(corpus.calibrationChapters);
	const frozen = new Set(corpus.testChapters);
	assert.equal([...training].filter((chapter) => calibration.has(chapter) || frozen.has(chapter)).length, 0);
	assert.equal([...calibration].filter((chapter) => frozen.has(chapter)).length, 0);
	assert.equal(training.size + calibration.size + frozen.size, 80);
	assert.deepEqual(corpus.fragments, (await prepareReferenceCorpus(root, { seed: 7 })).fragments);
});

test('Markdown 报告明确相容度边界并展示逐片证据', () => {
	const markdown = renderMarkdownReport({
		schemaVersion: 1,
		kind: 'style-audit-result',
		modelHash: 'model',
		corpusHash: 'corpus',
		modelStatus: 'validated',
		neuralStatus: 'not-run',
		disclaimer: '这不是作者归属概率。',
		inputs: [{
			id: 'fixture', file: 'fixture.txt', warnings: [],
			aggregate: {
				overall: 52, feature: 50, languageModel: 55, band: '参考范围内',
				confidenceInterval: { lower: 40, upper: 64 },
			},
			fragments: [{
				id: 'fixture-prose-001', characters: 800, dialogueRatio: 0.3,
				compatibility: { overall: 52, feature: 50, languageModel: 55, band: '参考范围内' },
				masked: { bpc: 7.1 }, sourceOffset: { start: 0, end: 800 }, excerpt: '话说众人听了。',
				unmaskedSensitivity: { overall: 51, deltaFromMasked: -1 },
				copying: { longestMatch: 20, ngramOverlap: 0.1 }, nearestReferences: [], suggestions: [],
			}],
		}],
	});
	assert.match(markdown, /不是作者归属概率/u);
	assert.match(markdown, /逐片结果/u);
	assert.match(markdown, /fixture-prose-001/u);
});

test('前八十回报告区分交叉验证、校准和冻结结果，并拒绝把聚类当作作者结论', () => {
	const chapters = [
		{ chapter: 1, split: 'training', fragmentCount: 2, proseCharacters: 2000, overall: 35, feature: 50, languageModel: 12.5, meanBpc: 9, referenceCluster: 0, exploratoryCluster: 0, band: '参考范围内', alerts: [] },
		{ chapter: 2, split: 'test', fragmentCount: 2, proseCharacters: 2000, overall: 20, feature: 30, languageModel: 3, meanBpc: 10, referenceCluster: 0, exploratoryCluster: 1, band: '显著异常', alerts: ['困惑度通道'] },
	];
	const markdown = renderReferenceAnalysis({
		kind: 'style-audit-reference-analysis', modelHash: 'model', corpusHash: 'corpus', analysisHash: 'analysis',
		disclaimer: '不是作者归属或作者人数鉴定。',
		scoringNotes: { training: '整回留出。', calibration: '只作诊断。', test: '严格未见。' },
		validation: { falseOutlierRate: 0.5 },
		summary: { bands: { '参考范围内': 1, '偏弱': 0, '显著异常': 1 } },
		exploratoryClustering: {
			method: '测试方法。', selectedClusterCount: 2, selectedSilhouette: 0.1, strength: '很弱',
			candidates: [{ clusterCount: 2, silhouette: 0.1, minimumClusterSize: 1, clusters: [[1], [2]] }],
			selectedProfiles: [
				{ cluster: 0, chapters: [1], topSignals: [{ feature: '虚词“亦”', z: 1 }] },
				{ cluster: 1, chapters: [2], topSignals: [{ feature: '套语“话说”', z: -1 }] },
			],
		},
		chapters,
	});
	assert.match(markdown, /不是“八十回全部通过”/u);
	assert.match(markdown, /困惑度通道/u);
	assert.match(markdown, /不能把类别数直接解释成作品数或作者数/u);
	assert.match(markdown, /\| 2 \| F \|/u);
});
