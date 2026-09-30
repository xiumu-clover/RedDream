import {
	FEATURE_CONFIG,
	NGRAM_CONFIG,
	STYLE_AUDIT_SCHEMA_VERSION,
} from './constants.js';
import {
	featureDistance,
	fitFeatureClusters,
	fitFeatureModel,
	quantile,
	vectorizeFeatures,
} from './features.js';
import { fitNgramModel, scoreNgramText, selectNgramAlpha } from './ngram.js';
import {
	aggregateScores,
	chapterFalseOutlierRate,
	copyMetrics,
	createCopyIndex,
	fitCopyCalibration,
	fitRobustCenter,
	fragmentCompatibility,
	robustNonconformity,
} from './scoring.js';
import { sha256 } from './text.js';

const NEURAL_CONFIG = Object.freeze({
	status: 'not-run',
	model: 'Qwen/Qwen3-0.6B-Base',
	revision: 'd4667999710b99b9b0a71dd9b2d314baa5662fd3',
	referenceAdapters: 2,
	contextTokens: 512,
	lora: { rank: 8, alpha: 16, dropout: 0.05 },
	learningRate: 0.0001,
	maxEpochs: 3,
});

function stableJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function referenceFragments(corpus, split) {
	return corpus.fragments.filter((fragment) => fragment.track === 'prose' && fragment.split === split);
}

export function fitStyleView(training, calibration, textKey, options = {}) {
	const texts = training.map((fragment) => fragment[textKey]);
	const featureModel = fitFeatureClusters(
		training,
		textKey,
		fitFeatureModel(texts, FEATURE_CONFIG),
		2,
	);
	const alphaSelection = Number.isFinite(options.alpha)
		? { alpha: options.alpha, results: [] }
		: selectNgramAlpha(training, textKey, NGRAM_CONFIG);
	const ngramModels = featureModel.clusterChapters.map((chapters) => fitNgramModel(
		training.filter((fragment) => chapters.includes(fragment.chapter)).map((fragment) => fragment[textKey]),
		{
			maxOrder: NGRAM_CONFIG.maxOrder,
			alpha: alphaSelection.alpha,
		},
	));
	const calibrationRows = calibration.map((fragment) => {
		const features = vectorizeFeatures(fragment[textKey], featureModel);
		const distance = featureDistance(features.standardized, featureModel);
		const language = scoreLanguageView(fragment[textKey], { ngramModels });
		return { fragment, features, distance, language };
	});
	const bpcValues = calibrationRows.map((row) => row.language.bpc);
	const bpcCenter = fitRobustCenter(bpcValues);
	const calibrationData = {
		featureDistances: calibrationRows.map((row) => row.distance.combined).sort((a, b) => a - b),
		bpcCenter,
		bpcNonconformities: bpcValues
			.map((value) => robustNonconformity(value, bpcCenter))
			.sort((a, b) => a - b),
	};
	return {
		featureModel,
		ngramModels,
		alphaSelection,
		calibration: calibrationData,
		references: calibrationRows.map((row) => ({
			fragmentId: row.fragment.id,
			chapter: row.fragment.chapter,
			sourceOffset: row.fragment.sourceOffset,
			vector: row.features.standardized,
		})),
	};
}

export function scoreLanguageView(text, view) {
	const clusterScores = view.ngramModels.map((model, cluster) => ({
		cluster,
		...scoreNgramText(text, model),
	}));
	const best = [...clusterScores].sort((left, right) => left.bpc - right.bpc || left.cluster - right.cluster)[0];
	const mixtureProbability = clusterScores.reduce((sum, score) => sum + 2 ** (-score.bpc), 0) / clusterScores.length;
	const bpc = -Math.log2(Math.max(mixtureProbability, Number.MIN_VALUE));
	return {
		bpc,
		perplexity: 2 ** bpc,
		characters: best.characters,
		cluster: best.cluster,
		clusterScores,
	};
}

export function scoreReferenceFragment(fragment, view, textKey) {
	const features = vectorizeFeatures(fragment[textKey], view.featureModel);
	const distance = featureDistance(features.standardized, view.featureModel);
	const language = scoreLanguageView(fragment[textKey], view);
	return {
		...fragmentCompatibility({
			featureDistance: distance.combined,
			bpc: language.bpc,
			calibration: view.calibration,
		}),
		bpc: language.bpc,
	};
}

function validateFrozenTest(test, view) {
	const byChapter = new Map();
	for (const fragment of test) {
		if (!byChapter.has(fragment.chapter)) byChapter.set(fragment.chapter, []);
		byChapter.get(fragment.chapter).push(scoreReferenceFragment(fragment, view, 'maskedText'));
	}
	const chapters = [...byChapter.entries()]
		.map(([chapter, scores]) => ({ chapter, ...aggregateScores(scores) }))
		.sort((left, right) => left.chapter - right.chapter);
	const falseOutlierRate = chapterFalseOutlierRate(chapters);
	return {
		status: falseOutlierRate <= 0.1 ? 'validated' : 'experimental',
		falseOutlierRate,
		maximumAcceptedFalseOutlierRate: 0.1,
		chapters,
	};
}

function featureCrossValidation(training, textKey) {
	const folds = [...new Set(training.map((fragment) => fragment.fold))].sort();
	return folds.map((fold) => {
		const train = training.filter((fragment) => fragment.fold !== fold);
		const heldOut = training.filter((fragment) => fragment.fold === fold);
		const model = fitFeatureClusters(
			train,
			textKey,
			fitFeatureModel(train.map((fragment) => fragment[textKey]), FEATURE_CONFIG),
			2,
		);
		const distances = heldOut.map((fragment) => {
			const vector = vectorizeFeatures(fragment[textKey], model);
			return featureDistance(vector.standardized, model).combined;
		});
		return {
			fold,
			trainingChapters: [...new Set(train.map((fragment) => fragment.chapter))].sort((a, b) => a - b),
			heldOutChapters: [...new Set(heldOut.map((fragment) => fragment.chapter))].sort((a, b) => a - b),
			fragments: heldOut.length,
			medianDistance: quantile(distances, 0.5),
			p90Distance: quantile(distances, 0.9),
		};
	});
}

export function trainStyleAuditModel(corpus) {
	if (corpus.kind !== 'style-audit-reference-corpus') throw new Error('输入不是文风审验参考语料。');
	const training = referenceFragments(corpus, 'training');
	const calibration = referenceFragments(corpus, 'calibration');
	const test = referenceFragments(corpus, 'test');
	if (!training.length || !calibration.length || !test.length) {
		throw new Error('训练、校准或冻结测试片段为空。');
	}

	const masked = fitStyleView(training, calibration, 'maskedText');
	const unmasked = fitStyleView(training, calibration, 'normalizedText');
	const copyIndex = createCopyIndex(training.map((fragment) => fragment.normalizedText));
	const calibrationCopyMetrics = calibration.map((fragment) => copyMetrics(fragment.normalizedText, copyIndex));
	const copyCalibration = fitCopyCalibration(calibrationCopyMetrics);
	const validation = validateFrozenTest(test, masked);
	const model = {
		schemaVersion: STYLE_AUDIT_SCHEMA_VERSION,
		kind: 'style-audit-model',
		corpusHash: corpus.corpusHash,
		seed: corpus.seed,
		orthographyMapVersion: corpus.orthographyMapVersion,
		chunkConfig: corpus.chunkConfig,
		trainingChapters: corpus.trainingChapters,
		calibrationChapters: corpus.calibrationChapters,
		testChapters: corpus.testChapters,
		entityLexicon: corpus.entityLexicon,
		featureConfig: FEATURE_CONFIG,
		ngramConfig: NGRAM_CONFIG,
		masked,
		unmasked,
		copyDetection: {
			order: copyIndex.order,
			calibration: copyCalibration,
			trainingTexts: training.map((fragment) => fragment.normalizedText),
		},
		crossValidation: {
			maskedFeatures: featureCrossValidation(training, 'maskedText'),
			unmaskedFeatures: featureCrossValidation(training, 'normalizedText'),
			maskedNgramAlpha: masked.alphaSelection,
			unmaskedNgramAlpha: unmasked.alphaSelection,
		},
		validation,
		neural: NEURAL_CONFIG,
		mixture: {
			requestedClusters: 2,
			interpretation: '参考风格簇仅表示统计上的两种语言模式，不等同于两位作者。',
			masked: {
				chapters: masked.featureModel.clusterChapters,
				silhouette: masked.featureModel.clusterSilhouette,
			},
			unmasked: {
				chapters: unmasked.featureModel.clusterChapters,
				silhouette: unmasked.featureModel.clusterSilhouette,
			},
		},
	};
	model.modelHash = sha256(stableJson(model));
	return model;
}
