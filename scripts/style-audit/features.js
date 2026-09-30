import {
	FEATURE_CONFIG,
	FUNCTION_WORDS,
	NARRATIVE_FORMULAS,
	PUNCTUATION_FEATURES,
} from './constants.js';
import { countHan, dialogueStats } from './text.js';

function quantile(values, probability) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const position = (sorted.length - 1) * probability;
	const lower = Math.floor(position);
	const upper = Math.ceil(position);
	if (lower === upper) return sorted[lower];
	return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function mean(values) {
	return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
	if (values.length < 2) return 0;
	const average = mean(values);
	return Math.sqrt(mean(values.map((value) => (value - average) ** 2)));
}

function countOccurrences(text, token) {
	let count = 0;
	let index = 0;
	while ((index = text.indexOf(token, index)) >= 0) {
		count += 1;
		index += Math.max(1, token.length);
	}
	return count;
}

function rate(count, length) {
	return length ? (count * 1000) / length : 0;
}

function lengthsFromSplit(text, pattern) {
	return text
		.split(pattern)
		.map((part) => countHan(part))
		.filter((length) => length > 0);
}

function mattr(text, windowSize) {
	const characters = [...text].filter((character) => /\p{Script=Han}/u.test(character));
	if (characters.length === 0) return 0;
	if (characters.length <= windowSize) return new Set(characters).size / characters.length;
	let sum = 0;
	let windows = 0;
	const counts = new Map();
	for (let index = 0; index < characters.length; index += 1) {
		counts.set(characters[index], (counts.get(characters[index]) ?? 0) + 1);
		if (index >= windowSize) {
			const expired = characters[index - windowSize];
			const nextCount = counts.get(expired) - 1;
			if (nextCount === 0) counts.delete(expired);
			else counts.set(expired, nextCount);
		}
		if (index >= windowSize - 1) {
			sum += counts.size / windowSize;
			windows += 1;
		}
	}
	return sum / windows;
}

function characterEntropy(text) {
	const characters = [...text].filter((character) => /\p{Script=Han}/u.test(character));
	if (characters.length === 0) return 0;
	const counts = new Map();
	for (const character of characters) counts.set(character, (counts.get(character) ?? 0) + 1);
	let entropy = 0;
	for (const count of counts.values()) {
		const probability = count / characters.length;
		entropy -= probability * Math.log2(probability);
	}
	return entropy;
}

function ngramCounts(text, order) {
	const characters = [...text];
	const counts = new Map();
	for (let index = 0; index <= characters.length - order; index += 1) {
		const ngram = characters.slice(index, index + order).join('');
		counts.set(ngram, (counts.get(ngram) ?? 0) + 1);
	}
	return counts;
}

function selectNgrams(texts, order, limit) {
	const counts = new Map();
	for (const text of texts) {
		for (const [ngram, count] of ngramCounts(text, order)) {
			if (/^\s+$/u.test(ngram)) continue;
			counts.set(ngram, (counts.get(ngram) ?? 0) + count);
		}
	}
	return [...counts.entries()]
		.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], 'zh-CN'))
		.slice(0, limit)
		.map(([ngram]) => ngram);
}

export function buildFeatureVocabulary(texts, config = FEATURE_CONFIG) {
	return {
		1: selectNgrams(texts, 1, config.topUnigrams),
		2: selectNgrams(texts, 2, config.topBigrams),
		3: selectNgrams(texts, 3, config.topTrigrams),
	};
}

export function extractFeatureRecord(text, vocabulary, config = FEATURE_CONFIG) {
	const characters = [...text];
	const length = characters.length;
	const hanCharacters = countHan(text);
	const dialogue = dialogueStats(text);
	const sentenceLengths = lengthsFromSplit(text, /[。！？；]+/u);
	const clauseLengths = lengthsFromSplit(text, /[，、：；。！？]+/u);
	const record = {
		'structure.characters_log': Math.log1p(length),
		'structure.han_ratio': length ? hanCharacters / length : 0,
		'structure.dialogue_ratio': dialogue.dialogueRatio,
		'structure.dialogue_turns_per_1000': rate(dialogue.turns, hanCharacters),
		'sentence.mean': mean(sentenceLengths),
		'sentence.p25': quantile(sentenceLengths, 0.25),
		'sentence.median': quantile(sentenceLengths, 0.5),
		'sentence.p75': quantile(sentenceLengths, 0.75),
		'sentence.p90': quantile(sentenceLengths, 0.9),
		'clause.mean': mean(clauseLengths),
		'clause.median': quantile(clauseLengths, 0.5),
		'lexical.mattr': mattr(text, config.mattrWindow),
		'lexical.entropy': characterEntropy(text),
		'lexical.unique_ratio': hanCharacters
			? new Set(characters.filter((character) => /\p{Script=Han}/u.test(character))).size / hanCharacters
			: 0,
	};
	for (const token of FUNCTION_WORDS) record[`function.${token}`] = rate(countOccurrences(text, token), hanCharacters);
	for (const token of NARRATIVE_FORMULAS) record[`formula.${token}`] = rate(countOccurrences(text, token), hanCharacters);
	for (const token of PUNCTUATION_FEATURES) record[`punctuation.${token}`] = rate(countOccurrences(text, token), hanCharacters);
	for (const order of [1, 2, 3]) {
		const counts = ngramCounts(text, order);
		for (const ngram of vocabulary[order]) {
			record[`ngram.${order}.${ngram}`] = rate(counts.get(ngram) ?? 0, Math.max(1, length - order + 1));
		}
	}
	return record;
}

function invertMatrix(matrix) {
	const size = matrix.length;
	const augmented = matrix.map((row, rowIndex) => [
		...row,
		...Array.from({ length: size }, (_value, columnIndex) => rowIndex === columnIndex ? 1 : 0),
	]);
	for (let column = 0; column < size; column += 1) {
		let pivot = column;
		for (let row = column + 1; row < size; row += 1) {
			if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
		}
		if (Math.abs(augmented[pivot][column]) < 1e-10) {
			throw new Error(`特征协方差矩阵不可逆（列 ${column}）。`);
		}
		[augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
		const divisor = augmented[column][column];
		for (let index = 0; index < size * 2; index += 1) augmented[column][index] /= divisor;
		for (let row = 0; row < size; row += 1) {
			if (row === column) continue;
			const factor = augmented[row][column];
			if (factor === 0) continue;
			for (let index = 0; index < size * 2; index += 1) {
				augmented[row][index] -= factor * augmented[column][index];
			}
		}
	}
	return augmented.map((row) => row.slice(size));
}

function covarianceInverse(rows, shrinkage, ridge) {
	const dimensions = rows[0].length;
	const covariance = Array.from({ length: dimensions }, () => Array(dimensions).fill(0));
	for (const row of rows) {
		for (let left = 0; left < dimensions; left += 1) {
			for (let right = left; right < dimensions; right += 1) {
				covariance[left][right] += row[left] * row[right];
			}
		}
	}
	for (let left = 0; left < dimensions; left += 1) {
		for (let right = left; right < dimensions; right += 1) {
			let value = covariance[left][right] / Math.max(1, rows.length - 1);
			if (left !== right) value *= 1 - shrinkage;
			else value += ridge;
			covariance[left][right] = value;
			covariance[right][left] = value;
		}
	}
	return invertMatrix(covariance);
}

export function fitFeatureModel(texts, config = FEATURE_CONFIG) {
	if (texts.length < 2) throw new Error('特征模型至少需要两个训练片段。');
	const vocabulary = buildFeatureVocabulary(texts, config);
	const records = texts.map((text) => extractFeatureRecord(text, vocabulary, config));
	const keys = Object.keys(records[0]);
	const centers = [];
	const scales = [];
	for (const key of keys) {
		const values = records.map((record) => record[key]);
		const center = quantile(values, 0.5);
		const deviations = values.map((value) => Math.abs(value - center));
		const madScale = quantile(deviations, 0.5) * 1.4826;
		const iqrScale = (quantile(values, 0.75) - quantile(values, 0.25)) / 1.349;
		centers.push(center);
		scales.push(madScale || iqrScale || standardDeviation(values) || 1);
	}
	const standardized = records.map((record) => keys.map(
		(key, index) => (record[key] - centers[index]) / scales[index],
	));
	return {
		config,
		vocabulary,
		keys,
		centers,
		scales,
		inverseCovariance: covarianceInverse(
			standardized,
			config.covarianceShrinkage,
			config.covarianceRidge,
		),
	};
}

export function vectorizeFeatures(text, model) {
	const record = extractFeatureRecord(text, model.vocabulary, model.config);
	const raw = model.keys.map((key) => record[key]);
	const standardized = raw.map((value, index) => (value - model.centers[index]) / model.scales[index]);
	return { record, raw, standardized };
}

function distanceFromCenter(standardized, center, model) {
	const delta = standardized.map((value, index) => value - center[index]);
	const burrowsDelta = mean(delta.map(Math.abs));
	let quadratic = 0;
	for (let row = 0; row < delta.length; row += 1) {
		let projected = 0;
		for (let column = 0; column < delta.length; column += 1) {
			projected += model.inverseCovariance[row][column] * delta[column];
		}
		quadratic += delta[row] * projected;
	}
	const mahalanobis = Math.sqrt(Math.max(0, quadratic) / delta.length);
	return {
		burrowsDelta,
		mahalanobis,
		combined: 0.5 * burrowsDelta + 0.5 * mahalanobis,
	};
}

export function featureDistance(standardized, model) {
	const centers = model.clusterCentroids?.length
		? model.clusterCentroids
		: [Array(standardized.length).fill(0)];
	const clusterDistances = centers.map((center, cluster) => ({
		cluster,
		...distanceFromCenter(standardized, center, model),
	}));
	clusterDistances.sort((left, right) => left.combined - right.combined || left.cluster - right.cluster);
	return { ...clusterDistances[0], clusterDistances };
}

function squaredDistance(left, right) {
	let value = 0;
	for (let index = 0; index < left.length; index += 1) value += (left[index] - right[index]) ** 2;
	return value;
}

function averageVectors(vectors) {
	return vectors[0].map((_value, index) => mean(vectors.map((vector) => vector[index])));
}

export function fitFeatureClusters(fragments, textKey, model, clusterCount = 2) {
	const byChapter = new Map();
	for (const fragment of fragments) {
		const vector = vectorizeFeatures(fragment[textKey], model).standardized;
		if (!byChapter.has(fragment.chapter)) byChapter.set(fragment.chapter, []);
		byChapter.get(fragment.chapter).push(vector);
	}
	const points = [...byChapter.entries()]
		.map(([chapter, vectors]) => ({ chapter, vector: averageVectors(vectors) }))
		.sort((left, right) => left.chapter - right.chapter);
	if (points.length < clusterCount * 3) {
		return {
			...model,
			clusterCentroids: [Array(model.keys.length).fill(0)],
			clusterChapters: [points.map((point) => point.chapter)],
			clusterSilhouette: 0,
		};
	}

	let farthest = { left: 0, right: 1, distance: -1 };
	for (let left = 0; left < points.length; left += 1) {
		for (let right = left + 1; right < points.length; right += 1) {
			const distance = squaredDistance(points[left].vector, points[right].vector);
			if (distance > farthest.distance) farthest = { left, right, distance };
		}
	}
	let centroids = [points[farthest.left].vector, points[farthest.right].vector];
	let assignments = Array(points.length).fill(-1);
	for (let iteration = 0; iteration < 100; iteration += 1) {
		const nextAssignments = points.map((point) => {
			const distances = centroids.map((centroid) => squaredDistance(point.vector, centroid));
			return distances[1] < distances[0] ? 1 : 0;
		});
		if (nextAssignments.every((cluster, index) => cluster === assignments[index])) break;
		assignments = nextAssignments;
		centroids = [0, 1].map((cluster) => averageVectors(
			points.filter((_point, index) => assignments[index] === cluster).map((point) => point.vector),
		));
	}
	const chapterGroups = [0, 1].map((cluster) => points
		.filter((_point, index) => assignments[index] === cluster)
		.map((point) => point.chapter));
	if (chapterGroups.some((chapters) => chapters.length < 3)) {
		return {
			...model,
			clusterCentroids: [Array(model.keys.length).fill(0)],
			clusterChapters: [points.map((point) => point.chapter)],
			clusterSilhouette: 0,
		};
	}
	const order = [0, 1].sort((left, right) => Math.min(...chapterGroups[left]) - Math.min(...chapterGroups[right]));
	centroids = order.map((cluster) => centroids[cluster]);
	const orderedGroups = order.map((cluster) => chapterGroups[cluster].sort((a, b) => a - b));
	const silhouettes = points.map((point) => {
		const own = orderedGroups.findIndex((chapters) => chapters.includes(point.chapter));
		const ownPoints = points.filter((candidate) => candidate.chapter !== point.chapter && orderedGroups[own].includes(candidate.chapter));
		const otherPoints = points.filter((candidate) => orderedGroups[1 - own].includes(candidate.chapter));
		const within = ownPoints.length ? mean(ownPoints.map((candidate) => Math.sqrt(squaredDistance(point.vector, candidate.vector)))) : 0;
		const between = mean(otherPoints.map((candidate) => Math.sqrt(squaredDistance(point.vector, candidate.vector))));
		return (between - within) / Math.max(within, between, Number.EPSILON);
	});
	return {
		...model,
		clusterCentroids: centroids,
		clusterChapters: orderedGroups,
		clusterSilhouette: mean(silhouettes),
	};
}

export function compareFeatureVectors(left, right) {
	let sum = 0;
	for (let index = 0; index < left.length; index += 1) sum += (left[index] - right[index]) ** 2;
	return Math.sqrt(sum / Math.max(1, left.length));
}

export function topFeatureDeviations(standardized, model, limit = 8) {
	return standardized
		.map((value, index) => ({ feature: model.keys[index], z: value }))
		.sort((left, right) => Math.abs(right.z) - Math.abs(left.z) || left.feature.localeCompare(right.feature))
		.slice(0, limit);
}

export { mean, quantile };
