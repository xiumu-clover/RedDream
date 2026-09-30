import assert from 'node:assert/strict';
import test from 'node:test';
import { chunkText, deterministicShuffle } from '../../scripts/style-audit/chunks.js';
import { FEATURE_CONFIG } from '../../scripts/style-audit/constants.js';
import { featureDistance, fitFeatureClusters, fitFeatureModel, vectorizeFeatures } from '../../scripts/style-audit/features.js';
import { fitNgramModel, scoreNgramText } from '../../scripts/style-audit/ngram.js';
import { scoreLanguageView } from '../../scripts/style-audit/model.js';
import { copyMetrics, createCopyIndex } from '../../scripts/style-audit/scoring.js';
import { extractChapterTracks, maskEntities, normalizePlainText } from '../../scripts/style-audit/text.js';

test('纯正文抽取排除标题、批语、尾注和图片，并将诗赋分轨', () => {
	const source = `---
order: 1
characters:
  - 贾宝玉
locations:
  - 怡红院
---
[T]第一回 测试
正文甲[zp]脂批[mp]嵌套批语[-][-]正文乙。
[sc]诗句一
诗句二[-]
[fu]赋句[-]
正文丙[wz]尾注[-]【夹批：删除】正文丁。
[img]图.png
图注[-]`;
	const tracks = extractChapterTracks(source, 'fixture.md');
	assert.equal(tracks.prose.normalized.text, '正文甲正文乙。正文丙正文丁。');
	assert.match(tracks.verse.normalized.text, /诗句一\s*诗句二赋句/u);
	assert.doesNotMatch(tracks.prose.normalized.text, /标题|脂批|尾注|夹批|图注/u);
	assert.deepEqual(tracks.entities, ['贾宝玉', '怡红院']);
	assert.ok(tracks.prose.normalized.sourceMap[0] > source.indexOf('[T]'));
});

test('专名遮蔽保持字符长度，切片不截断引号且固定种子可复现', () => {
	assert.equal(normalizePlainText('他说:"好,真的!"').text, '他说：“好，真的！”');
	const paragraph = '话说贾宝玉来到怡红院，笑道：“今日天气甚好，咱们一处说话。”众人听了，都笑起来。';
	const text = paragraph.repeat(80);
	const masked = maskEntities(text, ['贾宝玉', '怡红院']);
	assert.equal([...masked].length, [...text].length);
	assert.doesNotMatch(masked, /贾宝玉|怡红院/u);
	const chunks = chunkText(masked);
	assert.ok(chunks.length > 1);
	assert.ok(chunks.every((chunk) => !chunk.text.includes('“') || chunk.text.includes('”')));
	assert.deepEqual(deterministicShuffle(chunks, 42), deterministicShuffle(chunks, 42));
});

test('字符语言模型对同域句式给出较低 BPC', () => {
	const training = [
		'话说众人听了这话，一时都笑起来。只见那丫鬟进来回话。'.repeat(20),
		'且说宝玉听见，心下不免诧异，忙问是何缘故。'.repeat(20),
	];
	const model = fitNgramModel(training, { maxOrder: 5, alpha: 1 });
	const inDomain = scoreNgramText('话说众人听了这话，一时都笑起来。', model);
	const outOfDomain = scoreNgramText('OK，项目 KPI 已同步，大家今晚在线复盘一下。', model);
	assert.ok(inDomain.bpc < outOfDomain.bpc, `${inDomain.bpc} 应低于 ${outOfDomain.bpc}`);
});

test('混合语言模型按更相容的参考簇评分并保留两簇 BPC', () => {
	const view = {
		ngramModels: [
			fitNgramModel(['话说只见众人笑道。'.repeat(30)], { maxOrder: 5, alpha: 1 }),
			fitNgramModel(['却说原来众人哭道！'.repeat(30)], { maxOrder: 5, alpha: 1 }),
		],
	};
	const left = scoreLanguageView('话说只见众人笑道。'.repeat(5), view);
	const right = scoreLanguageView('却说原来众人哭道！'.repeat(5), view);
	assert.equal(left.clusterScores.length, 2);
	assert.notEqual(left.cluster, right.cluster);
});

test('特征距离与逐字复写检查能够识别明显异常', () => {
	const training = Array.from({ length: 8 }, (_value, index) => (
		`话说众人听了，${'一时只见忙道笑道'.repeat(15)}第${index}段。`
	));
	const config = { ...FEATURE_CONFIG, topUnigrams: 8, topBigrams: 8, topTrigrams: 8 };
	const model = fitFeatureModel(training, config);
	const ordinary = vectorizeFeatures(training[0], model);
	const modern = vectorizeFeatures('项目已经完成！！！！？？？？KPI OK 数据 数据 数据'.repeat(20), model);
	assert.ok(featureDistance(ordinary.standardized, model).combined < featureDistance(modern.standardized, model).combined);

	const copyIndex = createCopyIndex(training);
	const copied = copyMetrics(training[0].slice(0, 80), copyIndex);
	const novel = copyMetrics('天地玄黄宇宙洪荒日月盈昃辰宿列张'.repeat(5), copyIndex);
	assert.ok(copied.longestMatch > novel.longestMatch);
	assert.ok(copied.ngramOverlap > novel.ngramOverlap);
});

test('双簇参考按章节聚类并以最近风格簇计算距离', () => {
	const fragments = [
		...Array.from({ length: 3 }, (_value, index) => ({ chapter: index + 1, maskedText: '话说只见一时笑道。'.repeat(80) })),
		...Array.from({ length: 3 }, (_value, index) => ({ chapter: index + 11, maskedText: '却说原来半晌哭道！'.repeat(80) })),
	];
	const config = { ...FEATURE_CONFIG, topUnigrams: 6, topBigrams: 6, topTrigrams: 6 };
	const model = fitFeatureClusters(
		fragments,
		'maskedText',
		fitFeatureModel(fragments.map((fragment) => fragment.maskedText), config),
		2,
	);
	assert.equal(model.clusterChapters.length, 2);
	assert.ok(model.clusterChapters.every((chapters) => chapters.length === 3));
	const left = featureDistance(vectorizeFeatures(fragments[0].maskedText, model).standardized, model);
	const right = featureDistance(vectorizeFeatures(fragments.at(-1)!.maskedText, model).standardized, model);
	assert.notEqual(left.cluster, right.cluster);
});
