import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { blindCandidates, calibrationCases, makeBaseline, readBook } from './corpus.js';
import { attachComparisons, buildReport, packageContent, verifyManifest } from './engine.js';
import { DEFAULT_OUTPUT, DIMENSIONS, hash, PROMPT, reviewSchema, rubricMarkdown, SCHEMA_VERSION } from './protocol.js';

export const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
export async function writeOnce(path, value) {
	await mkdir(resolve(path, '..'), { recursive: true });
	const content = typeof value === 'string' ? value : json(value);
	try { await writeFile(path, content, { encoding: 'utf8', flag: 'wx' }); }
	catch (error) {
		if (error.code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw new Error(`拒绝覆盖历史文件：${path}（${error.message}）`);
	}
}
export async function prepare(root, output = DEFAULT_OUTPUT) {
	const baseline = await makeBaseline(root);
	const directory = resolve(root, output, 'prepared', baseline.evaluationVersion);
	await writeOnce(join(directory, 'baseline.json'), baseline);
	await writeOnce(join(directory, 'rubric.md'), rubricMarkdown());
	await writeOnce(join(directory, 'calibration.json'), calibrationCases(baseline));
	await writeOnce(join(directory, 'review-schema.json'), reviewSchema());
	await writeOnce(join(directory, 'pairwise-schema.json'), reviewSchema('pairwise'));
	await writeOnce(join(directory, 'reference.md'), '# 前八十回回目参照集\n\n本表保留项目现存版本，不预设各回满分。\n\n' + baseline.references.map((r) => `- 第${r.chapter}回：${r.upper}　${r.lower}（来源：${r.source}）`).join('\n') + '\n');
	return { baseline, directory };
}
function packet(manifest, round, baseline) {
	const metadata = { schemaVersion: SCHEMA_VERSION, kind: manifest.kind, evaluationVersion: manifest.evaluationVersion, packageHash: manifest.packageHash, attemptId: manifest.attemptId, round };
	return {
		responseMetadata: metadata, requiredReviewer: baseline.protocol.model,
		references: baseline.references.map(({ chapter, upper, lower }) => ({ chapter, upper, lower })),
		rubric: baseline.protocol.rubric,
		candidates: packageContent(manifest).candidates,
		...(manifest.kind === 'pairwise' ? { pairs: manifest.pairs.map((p) => ({ pairKey: p.key, left: p.keys[round === 1 ? 0 : 1], right: p.keys[round === 1 ? 1 : 0] })) } : {}),
		responseSchema: reviewSchema(manifest.kind),
	};
}
export async function exportRun(root, options = {}) {
	const output = options.output ?? DEFAULT_OUTPUT;
	const { baseline } = await prepare(root, output);
	let rows; let pairs; let sourceReportHash;
	if (options.compareRun) {
		const loaded = await loadRun(root, options.compareRun, baseline);
		if (loaded.manifest.kind !== 'ratings' || loaded.report.stale || loaded.report.errors.length) throw new Error('比较来源必须是有效评分运行。');
		pairs = loaded.report.comparisons.filter((p) => p.status === '待正反序比较').map(({ key, keys }) => ({ key, keys }));
		if (!pairs.length) throw new Error('没有分差至少10分且双方稳定的候选对。');
		rows = loaded.manifest.candidates;
		sourceReportHash = hash(loaded.report);
	} else if (options.calibration) rows = calibrationCases(baseline);
	else if (options.input) rows = await readJson(resolve(root, options.input));
	else rows = (await readBook(root, options.book ?? 'guiyou')).map((r) => ({ id: `${options.book ?? 'guiyou'}-${r.chapter}`, ...r }));
	const candidates = blindCandidates(rows);
	const base = {
		schemaVersion: SCHEMA_VERSION, kind: options.compareRun ? 'pairwise' : 'ratings',
		purpose: options.calibration ? 'calibration' : options.compareRun ? 'comparison' : 'candidates',
		evaluationVersion: baseline.evaluationVersion, candidates,
		...(pairs ? { pairs, sourceReportHash } : {}),
	};
	const packageHash = hash(packageContent(base));
	const family = hash({ ...base, packageHash });
	const attemptId = options.fresh ? `retest-${randomUUID()}` : 'initial';
	const directory = resolve(root, output, 'runs', family, attemptId);
	const payload = { ...base, packageHash, attemptId };
	const manifest = { ...payload, manifestHash: hash(payload) };
	await writeOnce(join(directory, 'manifest.json'), manifest);
	await writeOnce(join(directory, 'baseline.json'), baseline);
	await mkdir(join(directory, 'reviews'), { recursive: true });
	for (let round = 1; round <= (manifest.kind === 'ratings' ? 3 : 2); round++) {
		const content = packet(manifest, round, baseline);
		await writeOnce(join(directory, `round-${round}.json`), content);
		const comparisonInstruction = manifest.kind === 'pairwise' ? '\n本包只做成对比较。按每对给出的left/right顺序，独立选择left、right或tie；不生成单项分数。必须同时引用双方原字串，并引用参考回目。\n' : '';
		await writeOnce(join(directory, `round-${round}.md`), `${PROMPT}${comparisonInstruction}\n\n以下JSON是本次评审包。严格使用responseMetadata，填写实际reviewer信息；只返回responseSchema规定的JSON。\n\n${json(content)}`);
	}
	return { directory, manifest };
}
export async function loadRun(root, run, currentBaseline) {
	const directory = resolve(root, run);
	const manifest = await readJson(join(directory, 'manifest.json'));
	verifyManifest(manifest);
	const savedBaseline = await readJson(join(directory, 'baseline.json'));
	const expectedVersion = hash({ referenceHash: hash(savedBaseline.references), protocol: savedBaseline.protocol });
	if (savedBaseline.evaluationVersion !== expectedVersion || savedBaseline.evaluationVersion !== manifest.evaluationVersion) throw new Error('运行内参考集校验失败。');
	const sources = [];
	for (const name of (await readdir(join(directory, 'reviews'))).filter((f) => f.endsWith('.json')).sort()) {
		try { sources.push({ name, value: await readJson(join(directory, 'reviews', name)) }); }
		catch (error) { sources.push({ name, error: `JSON读取失败：${error.message}` }); }
	}
	const baseline = currentBaseline ?? await makeBaseline(root);
	return { directory, manifest, sources, report: buildReport(manifest, baseline, sources) };
}
export async function importReviews(root, directory, input) {
	const path = resolve(root, input);
	let paths;
	if (path.endsWith('.json')) paths = [path];
	else paths = (await readdir(path)).filter((p) => p.endsWith('.json')).map((p) => join(path, p));
	if (!paths.length) throw new Error('导入目录没有JSON评审结果。');
	for (const source of paths) {
		const raw = await readFile(source, 'utf8');
		// Preserve the exact original even if it is invalid. Content addressing makes re-import idempotent.
		await writeOnce(join(directory, 'reviews', `${hash(raw)}.json`), raw);
	}
}
const cell = (value) => String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', ' ');
export function renderReport(report) {
	let out = `# 回目风格评审报告\n\n${report.disclaimer}\n\n- 评审版本：\`${report.evaluationVersion}\`\n- 批次：\`${report.attemptId}\`\n- 旧版本失效：${report.stale ? '是' : '否'}\n`;
	for (const limit of report.limitations) out += `- ${limit}\n`;
	if (report.calibrationStatus) out += `- 配套稳定性校准：${report.calibrationStatus}\n`;
	if (report.calibration) out += `- 校准结果：**${report.calibration.status}**；完成${report.calibration.completedCount}/12，稳定${report.calibration.stableCount}/12，要求至少11例稳定。\n`;
	out += '\n## 评审来源\n\n' + (report.reviewers.length ? report.reviewers.map((r) => `- 第${r.round}轮：${r.model} / ${r.reasoning}；快照：${r.snapshot ?? '未锁定'}；上下文：${r.contextId}；时间：${r.timestamp}`).join('\n') : '尚无通过校验的评审。') + '\n';
	if (report.errors.length) out += '\n## 未完成原因\n\n' + report.errors.map((e) => `- ${e.source}：${e.message}`).join('\n') + '\n';
	if (report.candidates) {
		out += '\n## 逐回评分\n\n| 回目 | 句法 | 对仗 | 措辞 | 口吻 | 总分 | 三轮总分 | 波动 | 状态 |\n|---|---:|---:|---:|---:|---:|---|---:|---|\n';
		for (const c of report.candidates) out += `| ${cell(`${c.chapter} ${c.upper} ${c.lower}`)} | ${Object.keys(DIMENSIONS).map((d) => cell(c.scores?.[d].median)).join(' | ')} | ${cell(c.total)} | ${c.rounds.map((r) => `${r.round}:${r.total}`).join(' / ')} | ${cell(c.totalRange)} | ${c.status} |\n`;
		for (const c of report.candidates) {
			out += `\n## 第${c.chapter}回 · ${c.id}\n\n**${c.upper}　${c.lower}**\n\n格式：${c.format.pass ? '通过（8／8）' : c.format.issues.join(' ')}\n`;
			if (c.missingRounds?.length) out += `\n缺少有效评审：第${c.missingRounds.join('、')}轮。\n`;
			for (const r of c.rounds) {
				out += `\n### 第${r.round}轮：${r.total}分\n\n${r.summary}\n`;
				for (const [key, label] of Object.entries(DIMENSIONS)) {
					const metric = r.dimensions[key];
					out += `\n- **${label} ${metric.score}/5**：${metric.evidence} 参照：${metric.references.map((ref) => `第${ref.chapter}回“${ref.quote}”`).join('；')}。\n`;
					for (const issue of metric.issues) out += `  - “${issue.quote}”：${issue.reason} 修改方向：${issue.direction}\n`;
				}
			}
		}
	}
	if (report.comparisons?.length) {
		out += '\n## 候选比较\n\n';
		const names = new Map((report.candidates ?? []).map((c) => [c.key, c.id]));
		for (const p of report.comparisons) {
			out += `- ${p.keys.map((key) => names.get(key) ?? key).join(' / ')}：${p.status}${p.gap !== undefined ? `，分差${p.gap ?? '未知'}` : ''}${p.winner ? `，偏好${names.get(p.winner) ?? p.winner}` : ''}。\n`;
			for (const round of p.pairwise ?? p.rounds ?? []) {
				out += `  - 第${round.round}轮：${round.evidence} 左项“${round.leftQuote}”，右项“${round.rightQuote}”；参照：${round.references.map((ref) => `第${ref.chapter}回“${ref.quote}”`).join('；')}。\n`;
			}
		}
	}
	return out;
}
export async function reportRun(root, options) {
	const baseline = await makeBaseline(root);
	const directory = resolve(root, options.run);
	if (options.reviews) await importReviews(root, directory, options.reviews);
	const loaded = await loadRun(root, directory, baseline);
	let report = loaded.report;
	if (loaded.manifest.kind === 'ratings' && loaded.manifest.purpose !== 'calibration') {
		const calibration = options.calibrationRun ? (await loadRun(root, options.calibrationRun, baseline)).report : null;
		const pair = options.comparisons ? (await loadRun(root, options.comparisons, baseline)).report : null;
		report = attachComparisons(report, pair, calibration);
	}
	const reportHash = hash(report);
	const output = join(directory, 'reports', reportHash);
	await writeOnce(join(output, 'report.json'), { ...report, reportHash });
	await writeOnce(join(output, 'report.md'), renderReport(report));
	return { directory: output, report };
}
