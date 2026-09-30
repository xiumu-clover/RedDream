import { featureDistance, topFeatureDeviations, vectorizeFeatures } from './features.js';
import { scoreLanguageView } from './model.js';
import {
	aggregateScores,
	bootstrapInterval,
	copyMetrics,
	copyWarnings,
	createCopyIndex,
	fragmentCompatibility,
	nearestReferences,
} from './scoring.js';

function suggestionForDeviation(deviation) {
	const { feature, z } = deviation;
	const direction = z > 0 ? '偏高' : '偏低';
	if (feature.startsWith('sentence.') || feature.startsWith('clause.')) {
		return `句读节奏${direction}：复核长短句层次和转折位置。`;
	}
	if (feature === 'structure.dialogue_ratio' || feature === 'structure.dialogue_turns_per_1000') {
		return `对白占比或话轮密度${direction}：复核叙述与人物声口的配比。`;
	}
	if (feature.startsWith('punctuation.')) {
		return `${feature.slice('punctuation.'.length)} 使用频率${direction}：检查标点是否造成现代书面节奏。`;
	}
	if (feature.startsWith('formula.')) {
		return `叙事套语“${feature.slice('formula.'.length)}”频率${direction}：避免刻意堆叠或完全缺失章回体衔接。`;
	}
	if (feature.startsWith('function.')) {
		return `虚词“${feature.slice('function.'.length)}”频率${direction}：复核句法习惯，不要机械替换。`;
	}
	if (feature.startsWith('lexical.')) {
		return `词汇丰富度指标${direction}：检查复述、现代抽象词或刻意求异。`;
	}
	return `字符组合 ${feature.replace(/^ngram\.\d\./u, '“')}”频率${direction}，结合上下文复核措辞。`;
}

function scoreFragment(fragment, model, copyIndex, neuralFragment) {
	const maskedFeatures = vectorizeFeatures(fragment.maskedText, model.masked.featureModel);
	const maskedDistance = featureDistance(maskedFeatures.standardized, model.masked.featureModel);
	const maskedLanguage = scoreLanguageView(fragment.maskedText, model.masked);
	const compatibility = fragmentCompatibility({
		featureDistance: maskedDistance.combined,
		bpc: maskedLanguage.bpc,
		calibration: model.masked.calibration,
	});
	const unmaskedFeatures = vectorizeFeatures(fragment.normalizedText, model.unmasked.featureModel);
	const unmaskedDistance = featureDistance(unmaskedFeatures.standardized, model.unmasked.featureModel);
	const unmaskedLanguage = scoreLanguageView(fragment.normalizedText, model.unmasked);
	const unmaskedCompatibility = fragmentCompatibility({
		featureDistance: unmaskedDistance.combined,
		bpc: unmaskedLanguage.bpc,
		calibration: model.unmasked.calibration,
	});
	const copying = copyMetrics(fragment.normalizedText, copyIndex);
	const deviations = topFeatureDeviations(maskedFeatures.standardized, model.masked.featureModel);
	const suggestions = [...new Set(deviations.slice(0, 5).map(suggestionForDeviation))];
	let finalCompatibility = compatibility;
	let unstable = false;
	if (neuralFragment?.compatibility != null) {
		unstable = Math.abs(compatibility.languageModel - neuralFragment.compatibility) > 20;
		const languageModel = (compatibility.languageModel + neuralFragment.compatibility) / 2;
		const overall = 0.6 * compatibility.feature + 0.4 * languageModel;
		finalCompatibility = {
			...compatibility,
			languageModel,
			overall: unstable ? null : overall,
			band: unstable
				? '结论不稳定'
				: compatibility.feature < 5 || languageModel < 5
					? '显著异常'
					: overall < 20
						? '偏弱'
						: '参考范围内',
		};
	}
	return {
		id: fragment.id,
		characters: fragment.characters,
		hanCharacters: fragment.hanCharacters,
		dialogueRatio: fragment.dialogueRatio,
		sourceOffset: fragment.sourceOffset,
		lowConfidence: fragment.lowConfidence,
		textHash: fragment.textHash,
		excerpt: fragment.normalizedText.slice(0, 160),
		neuralInput: fragment.maskedText,
		compatibility: finalCompatibility,
		masked: {
			featureDistance: maskedDistance,
			featureCluster: maskedDistance.cluster,
			languageCluster: maskedLanguage.cluster,
			clusterBpc: maskedLanguage.clusterScores.map((score) => ({ cluster: score.cluster, bpc: score.bpc })),
			bpc: maskedLanguage.bpc,
			perplexity: maskedLanguage.perplexity,
		},
		unmaskedSensitivity: {
			feature: unmaskedCompatibility.feature,
			languageModel: unmaskedCompatibility.languageModel,
			overall: unmaskedCompatibility.overall,
			bpc: unmaskedLanguage.bpc,
			deltaFromMasked: unmaskedCompatibility.overall - compatibility.overall,
		},
		neural: neuralFragment ?? null,
		unstable,
		copying,
		warnings: [
			...(fragment.lowConfidence ? ['片段少于 600 字，分数置信度较低。'] : []),
			...copyWarnings(copying, model.copyDetection.calibration, compatibility.overall),
		],
		deviations,
		suggestions,
		nearestReferences: nearestReferences(maskedFeatures.standardized, model.masked.references),
	};
}

function stableAggregate(fragmentResults, modelHash, inputId) {
	const stable = fragmentResults.filter((fragment) => !fragment.unstable);
	if (!stable.length) return {
		feature: null,
		languageModel: null,
		overall: null,
		band: '结论不稳定',
		fragmentCount: fragmentResults.length,
		confidenceInterval: null,
	};
	const scores = stable.map((fragment) => fragment.compatibility);
	const aggregate = aggregateScores(scores);
	if (stable.length !== fragmentResults.length) {
		return {
			...aggregate,
			overall: null,
			band: '结论不稳定',
			confidenceInterval: null,
			unstableFragments: fragmentResults.length - stable.length,
		};
	}
	const seed = Number.parseInt(modelHash.slice(0, 8), 16) ^ [...inputId].reduce((sum, character) => sum + character.codePointAt(0), 0);
	return {
		...aggregate,
		confidenceInterval: bootstrapInterval(scores, seed),
		unstableFragments: fragmentResults.length - stable.length,
	};
}

export function auditPreparedInputs(inputs, model, neuralResults = null) {
	if (model.kind !== 'style-audit-model') throw new Error('输入不是文风审验模型包。');
	const copyIndex = createCopyIndex(model.copyDetection.trainingTexts, model.copyDetection.order);
	const neuralByFragment = new Map(
		(neuralResults?.fragments ?? []).map((fragment) => [fragment.id, fragment]),
	);
	const auditedInputs = inputs.map((input) => {
		const fragments = input.fragments.map((fragment) => (
			scoreFragment(fragment, model, copyIndex, neuralByFragment.get(fragment.id))
		));
		const aggregate = stableAggregate(fragments, model.modelHash, input.id);
		const warnings = [
			...(model.validation.status !== 'validated'
				? [`基准模型状态为 ${model.validation.status}，冻结测试误报率为 ${(model.validation.falseOutlierRate * 100).toFixed(1)}%。`]
				: []),
			...(fragments.some((fragment) => fragment.unstable)
				? ['字符模型与神经模型相差超过 20 分，按规则不输出总体强结论。']
				: []),
			...fragments.flatMap((fragment) => fragment.warnings.map((warning) => `${fragment.id}：${warning}`)),
		];
		return {
			id: input.id,
			file: input.file,
			sourceHash: input.sourceHash,
			normalizationChanges: input.normalizationChanges,
			aggregate,
			warnings,
			fragments,
		};
	});
	return {
		schemaVersion: model.schemaVersion,
		kind: 'style-audit-result',
		modelHash: model.modelHash,
		corpusHash: model.corpusHash,
		modelStatus: model.validation.status,
		disclaimer: '参考文风相容度用于定位与前八十回参考分布的偏离，不是作者归属概率。',
		referenceMixture: model.mixture,
		neuralStatus: neuralResults ? 'merged' : 'not-run',
		inputs: auditedInputs,
	};
}
