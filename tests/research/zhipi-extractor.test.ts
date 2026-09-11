import assert from 'node:assert/strict';
import test from 'node:test';
import {
	buildDataset,
	classifyContent,
	extractChapterFromSource,
	parseSources,
} from '../../scripts/research/zhipi/extract.mjs';

test('AST 提取不会被圆括号校记或嵌套脂批吞项', () => {
	const source = `[T]测试回
正文[mp]（校记）[-][zp]【庚双夹：第一条。】[-]
[zp]【甲戌眉批：外层[zp]【蒙侧批：内层。】[-]续文。】[-]
[mp]【松按转引[zp]【甲侧：校记内批语。】[-]】[-]`;
	const result = extractChapterFromSource(source, '001-test.md', 1);

	assert.equal(source.match(/\[zp\]/gu)?.length, 4);
	assert.equal(result.entries.length, 4);
	assert.deepEqual(result.entries[2].embeddedIn, ['zp']);
	assert.deepEqual(result.entries[3].embeddedIn, ['mp']);
});

test('复合来源保留多个版本见证，标题来源可以显式继承', () => {
	const compound = parseSources('列、庚双夹：同一批语。');
	assert.deepEqual(compound.witnesses.map((item) => item.id), ['gengchen', 'liecang']);
	assert.equal(Math.min(...compound.witnesses.map((item) => item.tier)), 1);

	const title = parseSources('甲戌本凡例');
	assert.deepEqual(title.startsInheritance, ['jiaxu']);
	const inherited = parseSources('此书只是着意于闺中。', title.startsInheritance ?? []);
	assert.equal(inherited.sourceMode, 'inherited');
	assert.deepEqual(inherited.witnesses.map((item) => item.id), ['jiaxu']);
});

test('内容类型与主观风险分开记录', () => {
	const source = parseSources('甲戌侧批：写雨村真是个英雄。');
	const analysis = classifyContent('甲戌侧批：写雨村真是个英雄。', source);
	assert.ok(analysis.categories.includes('道德褒贬'));
	assert.ok(analysis.riskFlags.includes('主观褒贬'));
	assert.equal(analysis.reviewStatus, '待人工复核');
});

test('前八十回全量提取与源码标记严格一致', () => {
	const dataset = buildDataset();
	assert.equal(dataset.scope.chapterCount, 80);
	assert.equal(dataset.integrity.rawZpMarkerCount, 4779);
	assert.equal(dataset.integrity.extractedEntryCount, 4779);
	assert.equal(dataset.integrity.countsMatch, true);
});
