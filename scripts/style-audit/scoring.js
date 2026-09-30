import { deterministicShuffle, seededRandom } from './chunks.js';
import { compareFeatureVectors, mean, quantile } from './features.js';

export function empiricalCompatibility(nonconformity, calibrationValues) {
	if (!calibrationValues.length || !Number.isFinite(nonconformity)) return 0;
	const notMoreConforming = calibrationValues.filter((value) => value >= nonconformity).length;
	return (100 * (notMoreConforming + 1)) / (calibrationValues.length + 1);
}

export function fitRobustCenter(values) {
	const center = quantile(values, 0.5);
	const mad = quantile(values.map((value) => Math.abs(value - center)), 0.5) * 1.4826;
	const iqr = (quantile(values, 0.75) - quantile(values, 0.25)) / 1.349;
	return { center, scale: mad || iqr || 1 };
}

export function robustNonconformity(value, calibration) {
	return Math.abs(value - calibration.center) / calibration.scale;
}

export function fragmentCompatibility({ featureDistance, bpc, calibration }) {
	const feature = empiricalCompatibility(featureDistance, calibration.featureDistances);
	const bpcNonconformity = robustNonconformity(bpc, calibration.bpcCenter);
	const languageModel = empiricalCompatibility(bpcNonconformity, calibration.bpcNonconformities);
	const overall = 0.6 * feature + 0.4 * languageModel;
	const band = feature < 5 || languageModel < 5
		? '显著异常'
		: overall < 20
			? '偏弱'
			: '参考范围内';
	return { feature, languageModel, overall, band, bpcNonconformity };
}

export function aggregateScores(fragmentScores) {
	if (!fragmentScores.length) return null;
	const aggregate = (key) => {
		const values = fragmentScores.map((score) => score[key]);
		return 0.7 * quantile(values, 0.5) + 0.3 * quantile(values, 0.1);
	};
	const feature = aggregate('feature');
	const languageModel = aggregate('languageModel');
	const overall = 0.6 * feature + 0.4 * languageModel;
	return {
		feature,
		languageModel,
		overall,
		band: feature < 5 || languageModel < 5
			? '显著异常'
			: overall < 20
				? '偏弱'
				: '参考范围内',
		fragmentCount: fragmentScores.length,
	};
}

export function bootstrapInterval(fragmentScores, seed, iterations = 500) {
	if (!fragmentScores.length) return null;
	if (fragmentScores.length === 1) {
		return { lower: fragmentScores[0].overall, upper: fragmentScores[0].overall, iterations: 1 };
	}
	const random = seededRandom(seed);
	const values = [];
	for (let iteration = 0; iteration < iterations; iteration += 1) {
		const sample = Array.from({ length: fragmentScores.length }, () => (
			fragmentScores[Math.floor(random() * fragmentScores.length)]
		));
		values.push(aggregateScores(sample).overall);
	}
	return { lower: quantile(values, 0.025), upper: quantile(values, 0.975), iterations };
}

export function nearestReferences(vector, references, limit = 3) {
	return references
		.map((reference) => ({
			fragmentId: reference.fragmentId,
			chapter: reference.chapter,
			sourceOffset: reference.sourceOffset,
			distance: compareFeatureVectors(vector, reference.vector),
		}))
		.sort((left, right) => left.distance - right.distance || left.fragmentId.localeCompare(right.fragmentId))
		.slice(0, limit);
}

function ngrams(text, order) {
	const characters = [...text];
	const values = [];
	for (let index = 0; index <= characters.length - order; index += 1) {
		values.push(characters.slice(index, index + order).join(''));
	}
	return values;
}

export function createCopyIndex(referenceTexts, order = 12) {
	const separator = '\uE001'.repeat(order);
	const combined = referenceTexts.join(separator);
	const positions = new Map();
	for (const [index, ngram] of ngrams(combined, order).entries()) {
		if (ngram.includes('\uE001')) continue;
		if (!positions.has(ngram)) positions.set(ngram, []);
		positions.get(ngram).push(index);
	}
	return { order, positions };
}

export function copyMetrics(text, index) {
	const candidateNgrams = ngrams(text, index.order);
	if (!candidateNgrams.length) return { longestMatch: 0, ngramOverlap: 0 };
	const unique = new Set(candidateNgrams);
	let overlaps = 0;
	for (const ngram of unique) if (index.positions.has(ngram)) overlaps += 1;

	let runs = new Map();
	let longestRun = 0;
	for (let candidateIndex = 0; candidateIndex < candidateNgrams.length; candidateIndex += 1) {
		const nextRuns = new Map();
		for (const referencePosition of index.positions.get(candidateNgrams[candidateIndex]) ?? []) {
			const diagonal = referencePosition - candidateIndex;
			const run = (runs.get(diagonal) ?? 0) + 1;
			nextRuns.set(diagonal, run);
			longestRun = Math.max(longestRun, run);
		}
		runs = nextRuns;
	}
	return {
		longestMatch: longestRun ? longestRun + index.order - 1 : 0,
		ngramOverlap: overlaps / unique.size,
	};
}

export function fitCopyCalibration(metrics) {
	return {
		longestMatchP99: quantile(metrics.map((metric) => metric.longestMatch), 0.99),
		ngramOverlapP99: quantile(metrics.map((metric) => metric.ngramOverlap), 0.99),
	};
}

export function copyWarnings(metrics, calibration, overallScore) {
	const warnings = [];
	if (metrics.longestMatch > calibration.longestMatchP99) {
		warnings.push(`最长连续复写 ${metrics.longestMatch} 字，超过原著校准集的第 99 百分位。`);
	}
	if (metrics.ngramOverlap > calibration.ngramOverlapP99) {
		warnings.push(`12-gram 重合率 ${(metrics.ngramOverlap * 100).toFixed(1)}%，超过原著校准集的第 99 百分位。`);
	}
	if (overallScore > 95) warnings.push('相容度高于 95，需结合复写指标排查训练语料泄漏。');
	return warnings;
}

export function assignTrainingFolds(groups, seed, foldCount = 5) {
	const shuffled = deterministicShuffle(groups, seed);
	const folds = new Map();
	shuffled.forEach((group, index) => {
		for (const chapter of group) folds.set(chapter, index % foldCount);
	});
	return folds;
}

export function splitReferenceChapters(chapters, seed) {
	const buckets = [
		chapters.filter((chapter) => chapter <= 20),
		chapters.filter((chapter) => chapter > 20 && chapter <= 40),
		chapters.filter((chapter) => chapter > 40 && chapter <= 60),
		chapters.filter((chapter) => chapter > 60),
	];
	const calibration = [];
	const test = [];
	buckets.forEach((bucket, bucketIndex) => {
		const shuffled = deterministicShuffle(bucket, seed + bucketIndex * 997);
		shuffled.forEach((chapter, index) => (index % 3 === 0 ? test : calibration).push(chapter));
	});
	return { calibration: calibration.sort((a, b) => a - b), test: test.sort((a, b) => a - b) };
}

export function chapterFalseOutlierRate(chapterAggregates) {
	if (!chapterAggregates.length) return 1;
	return mean(chapterAggregates.map((score) => (
		score.feature < 5 || score.languageModel < 5 ? 1 : 0
	)));
}

