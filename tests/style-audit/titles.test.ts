import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { extractTitle, formatCheck, makeBaseline, normalize, validateCandidates } from '../../scripts/style-audit/titles/corpus.js';
import { attachComparisons, buildReport } from '../../scripts/style-audit/titles/engine.js';
import { DIMENSIONS, MODEL } from '../../scripts/style-audit/titles/protocol.js';
import { exportRun, importReviews, loadRun, renderReport, reportRun } from '../../scripts/style-audit/titles/workflow.js';

const input = [{ id: 'candidate-a', chapter: 81, upper: '甲乙丙丁戊己庚辛', lower: '壬癸子丑寅卯辰巳' }];
async function fixture(t) {
	const root = await mkdtemp(join(tmpdir(), 'hlm-titles-'));
	t.after(() => rm(root, { recursive: true, force: true }));
	await mkdir(join(root, 'content/chapters/hongloumeng'), { recursive: true });
	for (let i = 1; i <= 80; i++) await writeFile(join(root, 'content/chapters/hongloumeng', `${String(i).padStart(3, '0')}-test.md`), `---\norder: ${i}\n---\n[T]第${i}回 甲乙丙丁戊己庚辛 壬癸子丑寅卯辰巳\n正文[错误`);
	await writeFile(join(root, 'candidates.json'), JSON.stringify(input));
	const { directory, manifest } = await exportRun(root, { input: 'candidates.json', output: 'output' });
	return { root, directory, manifest, baseline: await makeBaseline(root) };
}
function review(manifest, round, scores = [4, 4, 4, 4]) {
	return {
		schemaVersion: 1, kind: manifest.kind, evaluationVersion: manifest.evaluationVersion, packageHash: manifest.packageHash, attemptId: manifest.attemptId, round,
		reviewer: { ...MODEL, contextId: `test-context-${round}`, independentContext: true, timestamp: '2026-09-28T00:00:00.000Z' },
		ratings: manifest.candidates.map((c) => ({ key: c.key, textHash: c.textHash, summary: '仅用于校验器测试的合成评分，不是实际评审。', dimensions: Object.fromEntries(Object.keys(DIMENSIONS).map((key, i) => [key, { evidence: '测试依据。', score: scores[i], references: [{ chapter: 1, quote: '甲乙' }], issues: [] }])) })), notes: 'TEST FIXTURE ONLY',
	};
}
const source = (value, name = `round-${value.round}.json`) => ({ name, value });
const sources = (manifest) => [1, 2, 3].map((r) => source(review(manifest, r)));

test('标题独立提取、不编译正文；繁简与Unicode计数正确', () => {
	const a = extractTitle('---\norder: 81\n---\n[T]第八十一回 甲乙丙丁戊己庚辛 壬癸子丑寅卯辰巳\n[未知正文', 81, 'a.md');
	assert.equal(a.upper, input[0].upper);
	assert.equal(normalize('風夢寶玉'), '风梦宝玉');
	assert.equal(formatCheck({ upper: '𠀀乙丙丁戊己庚辛', lower: input[0].lower }).pass, true);
	assert.equal(formatCheck({ upper: '甲，丙丁戊己庚辛', lower: '壬癸' }).pass, false);
	assert.throws(() => extractTitle('---\norder: 82\n---\n[T]第八十一回 上 下', 81, 'a.md'), /order/);
	assert.throws(() => validateCandidates([{ ...input[0], lower: '' }]), /非空/);
	assert.throws(() => validateCandidates([input[0], input[0]]), /重复/);
});

test('三次评分逐项中位数汇总，并在严格超过阈值时标不稳定', async (t) => {
	const { manifest, baseline } = await fixture(t);
	const reviews = [review(manifest, 1, [4, 3, 4, 4]), review(manifest, 2, [3, 4, 4, 4]), review(manifest, 3, [4, 4, 3, 4])];
	const result = buildReport(manifest, baseline, reviews.map((r) => source(r)));
	assert.equal(result.candidates[0].total, 80); // median of dimensions, NOT median of totals (75)
	assert.equal(result.candidates[0].status, '稳定');
	reviews[2].ratings[0].dimensions.syntax.score = 1;
	assert.equal(buildReport(manifest, baseline, reviews.map((r) => source(r))).candidates[0].status, '评审不稳定');
});

test('无效原文引用、越界分数和旧版本均导致未完成，不补分', async (t) => {
	const { manifest, baseline } = await fixture(t);
	for (const mutate of [
		(r) => { r.ratings[0].dimensions.syntax.references[0].quote = '虚构引用'; },
		(r) => { r.ratings[0].dimensions.syntax.references[0].chapter = 81; },
		(r) => { r.ratings[0].dimensions.syntax.score = 6; },
		(r) => { r.ratings[0].dimensions.syntax.issues = [{ quote: '不在候选', reason: '测试', direction: '测试' }]; },
		(r) => { r.evaluationVersion = 'old'; },
		(r) => { r.reviewer.model = 'different-model'; },
		(r) => { r.reviewer.timestamp = 'unknown'; },
		(r) => { r.reviewer.snapshot = ''; },
		(r) => { r.ratings[0].dimensions.constructor = { score: 5 }; },
	]) {
		const all = sources(manifest); mutate(all[0].value);
		const report = buildReport(manifest, baseline, all);
		assert.equal(report.candidates[0].total, null);
		assert.equal(report.candidates[0].status, '未完成');
		assert.ok(report.errors.length);
	}
	const partial = sources(manifest); partial[0].value.ratings = [];
	assert.deepEqual(buildReport(manifest, baseline, partial).candidates[0].missingRounds, [1]);
	const stale = buildReport(manifest, { ...baseline, evaluationVersion: 'new-version' }, sources(manifest));
	assert.equal(stale.stale, true); assert.equal(stale.candidates[0].total, null);
});

test('相同上下文、重复轮次、混合快照不能算三次独立评审', async (t) => {
	const { manifest, baseline } = await fixture(t);
	const all = sources(manifest);
	all[1].value.reviewer.contextId = all[0].value.reviewer.contextId;
	assert.equal(buildReport(manifest, baseline, all).summary.completedCount, 0);
	assert.equal(buildReport(manifest, baseline, [...sources(manifest), source(review(manifest, 1), 'duplicate.json')]).summary.completedCount, 0);
	const mixed = sources(manifest); mixed[0].value.reviewer.snapshot = 'snapshot-a';
	assert.equal(buildReport(manifest, baseline, mixed).summary.completedCount, 0);
});

test('校准12例需要全部完成，至少11例稳定；包含四种原句、四种损坏和四种边界', async (t) => {
	const { root, baseline } = await fixture(t);
	const { manifest } = await exportRun(root, { calibration: true, output: 'output' });
	assert.equal(manifest.candidates.length, 12);
	const all = sources(manifest);
	all[0].value.ratings[0].dimensions.syntax.score = 1;
	let report = buildReport(manifest, baseline, all);
	assert.equal(report.calibration.status, '通过'); assert.equal(report.calibration.stableCount, 11);
	all[0].value.ratings[1].dimensions.syntax.score = 1;
	report = buildReport(manifest, baseline, all);
	assert.equal(report.calibration.status, '未通过');
	all[0].value.ratings.pop();
	assert.equal(buildReport(manifest, baseline, all).calibration.status, '未完成');
});

test('导出包隐藏身份和旧分数；参照严格只有80回，正文变化不改变版本', async (t) => {
	const { root, baseline, directory } = await fixture(t);
	const packet = JSON.parse(await readFile(join(directory, 'round-1.json'), 'utf8'));
	assert.equal(packet.references.length, 80);
	assert.ok(packet.candidates.every((r) => !('chapter' in r) && !('id' in r) && !('source' in r)));
	assert.doesNotMatch(JSON.stringify(packet), /candidate-a|未知正文|正文\[错误/);
	const file = join(root, 'content/chapters/hongloumeng/001-test.md');
	await writeFile(file, (await readFile(file, 'utf8')) + '\n任意正文改变');
	assert.equal((await makeBaseline(root)).evaluationVersion, baseline.evaluationVersion);
	await writeFile(file, (await readFile(file, 'utf8')).replace('甲乙丙丁', '天地玄黄'));
	assert.notEqual((await makeBaseline(root)).evaluationVersion, baseline.evaluationVersion);
});

test('运行缓存、重新评审、导入幂等及历史报告保存', async (t) => {
	const { root, directory, manifest } = await fixture(t);
	const cached = await exportRun(root, { input: 'candidates.json', output: 'output' });
	assert.equal(cached.directory, directory);
	const fresh = await exportRun(root, { input: 'candidates.json', output: 'output', fresh: true });
	assert.notEqual(fresh.directory, directory);
	const empty = await reportRun(root, { run: directory });
	await mkdir(join(root, 'incoming'));
	for (const r of [1, 2, 3]) await writeFile(join(root, 'incoming', `${r}.json`), JSON.stringify(review(manifest, r)));
	await importReviews(root, directory, 'incoming');
	await importReviews(root, directory, 'incoming');
	assert.equal((await readdir(join(directory, 'reviews'))).length, 3);
	const full = await reportRun(root, { run: directory });
	assert.notEqual(full.directory, empty.directory);
	assert.equal(full.report.summary.completedCount, 1);
	assert.equal(JSON.parse(await readFile(join(empty.directory, 'report.json'), 'utf8')).candidates[0].total, null);
	assert.equal((await reportRun(root, { run: directory })).directory, full.directory);
	const markdown = renderReport(full.report);
	assert.match(markdown, /不是同一作者概率/); assert.match(markdown, /未锁定模型快照/); assert.match(markdown, /格式：通过/);
});

test('正反序比较须一致且校准通过；小分差不推荐', async (t) => {
	const { root, baseline } = await fixture(t);
	await writeFile(join(root, 'two.json'), JSON.stringify([input[0], { ...input[0], id: 'candidate-b', upper: '天地玄黄宇宙洪荒' }]));
	const { directory, manifest } = await exportRun(root, { input: 'two.json', output: 'output' });
	for (const round of [1, 2, 3]) {
		const r = review(manifest, round);
		for (const metric of Object.values(r.ratings[1].dimensions)) metric.score = 3;
		await writeFile(join(directory, 'reviews', `${round}.json`), JSON.stringify(r));
	}
	const original = (await loadRun(root, directory, baseline)).report;
	assert.equal(original.comparisons[0].gap, 20);
	const pairRun = await exportRun(root, { compareRun: directory, output: 'output' });
	const pairReviews = [1, 2].map((round) => {
		const pair = pairRun.manifest.pairs[0];
		const [left, right] = round === 1 ? pair.keys : [...pair.keys].reverse();
		const winnerKey = manifest.candidates[0].key;
		const candidate = (key) => manifest.candidates.find((c) => c.key === key);
		const r = review(pairRun.manifest, round); delete r.ratings;
		r.comparisons = [{ pairKey: pair.key, left, right, winner: left === winnerKey ? 'left' : 'right', evidence: '测试比较依据。', leftQuote: candidate(left).upper.slice(0, 2), rightQuote: candidate(right).upper.slice(0, 2), references: [{ chapter: 1, quote: '甲乙' }] }];
		return source(r);
	});
	const pairReport = buildReport(pairRun.manifest, baseline, pairReviews);
	assert.equal(pairReport.comparisons[0].status, '一致偏好');
	assert.match(renderReport(pairReport), /测试比较依据/);
	assert.match(renderReport(pairReport), /第2轮/);
	assert.equal(attachComparisons(original, pairReport, null).comparisons[0].winner, null);
	const calibrated = { evaluationVersion: baseline.evaluationVersion, calibration: { status: '通过' } };
	assert.equal(attachComparisons(original, pairReport, calibrated).comparisons[0].winner, manifest.candidates[0].key);
	pairReviews[1].value.comparisons[0].winner = pairReviews[1].value.comparisons[0].winner === 'left' ? 'right' : 'left';
	assert.equal(buildReport(pairRun.manifest, baseline, pairReviews).comparisons[0].winner, null);
	pairReviews[1].value.comparisons[0].left = pairReviews[0].value.comparisons[0].left;
	assert.ok(buildReport(pairRun.manifest, baseline, pairReviews).errors.length);
	const all = sources(manifest);
	all.forEach((r) => { r.value.ratings[1].dimensions.syntax.score = 3; });
	assert.equal(buildReport(manifest, baseline, all).comparisons[0].status, '未拉开明确差距');
});

test('损坏JSON保留原记录并报未完成；运行清单篡改会被拒绝', async (t) => {
	const { root, directory } = await fixture(t);
	await writeFile(join(directory, 'reviews', 'broken.json'), '{broken');
	const result = await reportRun(root, { run: directory });
	assert.match(result.report.errors[0].message, /JSON读取失败/);
	assert.equal(result.report.candidates[0].status, '未完成');
	assert.equal(await readFile(join(directory, 'reviews', 'broken.json'), 'utf8'), '{broken');
	const file = join(directory, 'manifest.json');
	const manifest = JSON.parse(await readFile(file, 'utf8'));
	manifest.candidates[0].upper = '改写候选不能套旧分';
	await writeFile(file, JSON.stringify(manifest));
	await assert.rejects(() => loadRun(root, directory), /清单被修改/);
});
