import { DIMENSIONS, hash, LIMITS, reviewSchema, SCHEMA_VERSION, DISCLAIMER } from './protocol.js';

export function checkSchema(value, schema, path = '$') {
	if (schema.const !== undefined && value !== schema.const) throw new Error(`${path}：常量不符。`);
	if (schema.enum && !schema.enum.includes(value)) throw new Error(`${path}：不在允许值中。`);
	const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
	const matches = (type) => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) : type === 'integer' ? Number.isInteger(value) : type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : typeof value === type;
	if (types.length && !types.some(matches)) throw new Error(`${path}：类型错误。`);
	if (typeof value === 'string' && schema.minLength && value.trim().length < schema.minLength) throw new Error(`${path}：文字为空或过短。`);
	if (typeof value === 'number' && ((schema.minimum !== undefined && value < schema.minimum) || (schema.maximum !== undefined && value > schema.maximum))) throw new Error(`${path}：数值越界。`);
	if (Array.isArray(value)) {
		if (schema.minItems && value.length < schema.minItems) throw new Error(`${path}：数组缺项。`);
		if (schema.items) value.forEach((item, i) => checkSchema(item, schema.items, `${path}[${i}]`));
	} else if (value && typeof value === 'object' && schema.properties) {
		for (const key of schema.required ?? []) if (!(key in value)) throw new Error(`${path}.${key}：缺少字段。`);
		for (const key of Object.keys(value)) {
			if (Object.hasOwn(schema.properties, key)) checkSchema(value[key], schema.properties[key], `${path}.${key}`);
			else if (schema.additionalProperties === false) throw new Error(`${path}.${key}：未知字段。`);
		}
	}
}
const titleContains = (candidate, quote) => candidate.upper.includes(quote) || candidate.lower.includes(quote);
function checkReferences(refs, baseline) {
	for (const ref of refs) {
		const source = baseline.references.find((r) => r.chapter === ref.chapter);
		if (!source || !titleContains(source, ref.quote)) throw new Error(`第${ref.chapter}回引用“${ref.quote}”不是参考回目的原字串。`);
	}
}
export function packageContent(manifest) {
	return {
		kind: manifest.kind, evaluationVersion: manifest.evaluationVersion,
		candidates: manifest.candidates.map(({ key, textHash, upper, lower }) => ({ key, textHash, upper, lower })),
		...(manifest.kind === 'pairwise' ? { pairs: manifest.pairs, sourceReportHash: manifest.sourceReportHash } : {}),
	};
}
export function verifyManifest(manifest) {
	const { manifestHash, ...payload } = manifest;
	if (manifestHash !== hash(payload) || manifest.packageHash !== hash(packageContent(manifest))) throw new Error('运行清单被修改或校验值不符，请重新导出。');
	if (!['ratings', 'pairwise'].includes(manifest.kind)) throw new Error('未知评审类型。');
}
export function validateReview(review, manifest, baseline) {
	checkSchema(review, reviewSchema(manifest.kind));
	for (const field of ['kind', 'evaluationVersion', 'packageHash', 'attemptId']) if (review[field] !== manifest[field]) throw new Error(`${field}不符，不能混用评审包、版本或重评批次。`);
	const { reviewer } = review;
	const model = baseline.protocol.model;
	if (reviewer.model !== model.model || reviewer.reasoning !== model.reasoning || (model.snapshot !== null && reviewer.snapshot !== model.snapshot)) throw new Error('模型、推理设置或快照不符。');
	if (reviewer.snapshot !== null && !reviewer.snapshot.trim()) throw new Error('无法确认快照时须填null，不能填空字符串。');
	if (!/^\d{4}-\d{2}-\d{2}T.*Z$/u.test(reviewer.timestamp) || !Number.isFinite(Date.parse(reviewer.timestamp))) throw new Error('评审时间须为有效UTC ISO时间。');
	const byKey = new Map(manifest.candidates.map((row) => [row.key, row]));
	const seen = new Set();
	if (manifest.kind === 'ratings') {
		for (const rating of review.ratings) {
			if (seen.has(rating.key)) throw new Error(`候选${rating.key}评分重复。`);
			seen.add(rating.key);
			const candidate = byKey.get(rating.key);
			if (!candidate || candidate.textHash !== rating.textHash) throw new Error(`候选${rating.key}不存在或文字哈希不符。`);
			for (const metric of Object.values(rating.dimensions)) {
				checkReferences(metric.references, baseline);
				for (const issue of metric.issues) if (!titleContains(candidate, issue.quote)) throw new Error(`问题引用“${issue.quote}”不在候选${rating.key}中。`);
			}
		}
	} else {
		for (const comparison of review.comparisons) {
			if (seen.has(comparison.pairKey)) throw new Error('同一候选对比较重复。');
			seen.add(comparison.pairKey);
			const pair = manifest.pairs.find((p) => p.key === comparison.pairKey);
			if (!pair) throw new Error('比较引用不存在的候选对。');
			const [left, right] = review.round === 1 ? pair.keys : [...pair.keys].reverse();
			if (comparison.left !== left || comparison.right !== right) throw new Error('成对比较未按要求交换顺序。');
			if (!titleContains(byKey.get(left), comparison.leftQuote) || !titleContains(byKey.get(right), comparison.rightQuote)) throw new Error('成对比较引用不在相应候选中。');
			checkReferences(comparison.references, baseline);
		}
	}
	return review;
}
const range = (values) => Math.max(...values) - Math.min(...values);
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
export function collectReviews(sources, manifest, baseline) {
	const errors = []; const accepted = [];
	for (const source of sources) {
		try {
			if (source.error) throw new Error(source.error);
			accepted.push({ source: source.name, value: validateReview(source.value, manifest, baseline) });
		} catch (error) { errors.push({ source: source.name, message: error.message }); }
	}
	const duplicates = new Set();
	for (const item of accepted) {
		if (accepted.filter((r) => r.value.round === item.value.round).length > 1 || accepted.filter((r) => r.value.reviewer.contextId === item.value.reviewer.contextId).length > 1) duplicates.add(item);
	}
	for (const item of duplicates) errors.push({ source: item.source, message: '轮次重复或上下文标识重复，不能算作独立评审。' });
	let reviews = accepted.filter((r) => !duplicates.has(r)).map((r) => r.value).sort((a, b) => a.round - b.round);
	if (new Set(reviews.map((r) => r.reviewer.snapshot)).size > 1) {
		errors.push({ source: 'reviewer', message: '各轮模型快照不一致。' }); reviews = [];
	}
	return { reviews, errors };
}
export function buildReport(manifest, baseline, sources) {
	verifyManifest(manifest);
	const stale = manifest.evaluationVersion !== baseline.evaluationVersion;
	const { reviews, errors } = stale ? { reviews: [], errors: [{ source: 'baseline', message: '基准、量表、提示词或模型设置已变化，旧结果已失效。' }] } : collectReviews(sources, manifest, baseline);
	const common = {
		kind: 'title-report', schemaVersion: SCHEMA_VERSION, evaluationVersion: manifest.evaluationVersion, packageHash: manifest.packageHash, attemptId: manifest.attemptId,
		purpose: manifest.purpose, stale, disclaimer: DISCLAIMER, errors, reviewers: reviews.map(({ round, reviewer }) => ({ round, ...reviewer })),
		limitations: ['上下文隔离依据评审者来源声明及不同contextId校验，工具不能单独证明隔离。', ...(reviews.some((r) => r.reviewer.snapshot === null) ? ['未锁定模型快照，模型标识不保证底层权重长期不变。'] : [])],
	};
	if (manifest.kind === 'pairwise') {
		const comparisons = manifest.pairs.map((pair) => {
			const rounds = reviews.flatMap((review) => review.comparisons.filter((r) => r.pairKey === pair.key).map((r) => ({ ...r, round: review.round })));
			const winners = rounds.map((r) => r.winner === 'tie' ? null : r[r.winner]);
			const winner = rounds.length === 2 && winners[0] && winners[0] === winners[1] ? winners[0] : null;
			return { ...pair, rounds, winner, status: rounds.length < 2 ? '未完成' : winner ? '一致偏好' : '无一致偏好' };
		});
		return { ...common, sourceReportHash: manifest.sourceReportHash, comparisons };
	}
	const candidates = manifest.candidates.map((candidate) => {
		const rounds = reviews.flatMap((review) => review.ratings.filter((r) => r.key === candidate.key).map((r) => ({
			...r, round: review.round, total: 5 * Object.values(r.dimensions).reduce((sum, d) => sum + d.score, 0),
		})));
		if (rounds.length !== LIMITS.rounds) return { ...candidate, rounds, status: '未完成', total: null, missingRounds: [1, 2, 3].filter((round) => !rounds.some((r) => r.round === round)) };
		const scores = Object.fromEntries(Object.keys(DIMENSIONS).map((key) => [key, { median: median(rounds.map((r) => r.dimensions[key].score)), range: range(rounds.map((r) => r.dimensions[key].score)) }]));
		const totalRange = range(rounds.map((r) => r.total));
		const stable = totalRange <= LIMITS.totalRange && Object.values(scores).every((s) => s.range <= LIMITS.dimensionRange);
		return { ...candidate, rounds, scores, total: 5 * Object.values(scores).reduce((sum, d) => sum + d.median, 0), totalRange, status: stable ? '稳定' : '评审不稳定' };
	});
	const stableCount = candidates.filter((c) => c.status === '稳定').length;
	const completedCount = candidates.filter((c) => c.total !== null).length;
	const calibration = manifest.purpose === 'calibration' ? {
		count: candidates.length, stableCount, completedCount, requiredStable: LIMITS.calibrationPass,
		status: candidates.length !== 12 || completedCount !== 12 || errors.length ? '未完成' : stableCount >= LIMITS.calibrationPass ? '通过' : '未通过',
	} : null;
	const comparisons = [];
	for (let i = 0; i < candidates.length; i++) for (const b of candidates.slice(i + 1)) {
		const a = candidates[i];
		if (a.chapter !== b.chapter || manifest.purpose === 'calibration') continue;
		const gap = a.total === null || b.total === null ? null : Math.abs(a.total - b.total);
		comparisons.push({ key: hash([a.key, b.key].sort()).slice(0, 16), keys: [a.key, b.key].sort(), chapter: a.chapter, gap, winner: null,
			status: a.status !== '稳定' || b.status !== '稳定' || errors.length ? '评分未完成或不稳定' : gap < LIMITS.comparisonGap ? '未拉开明确差距' : '待正反序比较',
		});
	}
	return { ...common, candidates, comparisons, calibration, summary: { count: candidates.length, completedCount, stableCount } };
}
export function attachComparisons(report, pairReport, calibrationReport) {
	const calibrationPassed = calibrationReport?.evaluationVersion === report.evaluationVersion && calibrationReport?.calibration?.status === '通过';
	const pairMatches = pairReport && !pairReport.stale && !pairReport.errors.length && pairReport.evaluationVersion === report.evaluationVersion && pairReport.sourceReportHash === hash(report);
	return {
		...report, calibrationStatus: calibrationPassed ? '通过' : '未通过或未完成',
		comparisons: report.comparisons.map((comparison) => {
			if (comparison.status !== '待正反序比较') return comparison;
			const pair = pairMatches && pairReport.comparisons.find((p) => p.key === comparison.key);
			if (!calibrationPassed) return { ...comparison, status: '校准未通过或未完成，暂不推荐' };
			if (!pair) return comparison;
			return { ...comparison, winner: pair.winner, status: pair.winner ? '明确偏好' : pair.status, pairwise: pair.rounds };
		}),
	};
}
