import { NGRAM_CONFIG } from './constants.js';

const UNKNOWN_CHARACTER = '\uE000';
const HYDRATED_MODELS = new WeakMap();

function sortedEntries(map) {
	return [...map.entries()].sort((left, right) => left[0].localeCompare(right[0], 'zh-CN'));
}

function asMap(value) {
	return value instanceof Map ? value : new Map(value);
}

export function fitNgramModel(texts, options = {}) {
	const maxOrder = options.maxOrder ?? NGRAM_CONFIG.maxOrder;
	const alpha = options.alpha ?? 1;
	const vocabulary = new Set();
	for (const text of texts) for (const character of text) vocabulary.add(character);
	vocabulary.delete(UNKNOWN_CHARACTER);
	const sequenceCounts = Array.from({ length: maxOrder + 1 }, () => new Map());
	const contextCounts = Array.from({ length: maxOrder }, () => new Map());
	let totalCharacters = 0;

	for (const text of texts) {
		const characters = [...text];
		for (let index = 0; index < characters.length; index += 1) {
			const target = characters[index];
			totalCharacters += 1;
			sequenceCounts[1].set(target, (sequenceCounts[1].get(target) ?? 0) + 1);
			for (let order = 2; order <= maxOrder; order += 1) {
				const contextLength = order - 1;
				if (index < contextLength) break;
				const context = characters.slice(index - contextLength, index).join('');
				const sequence = `${context}${target}`;
				sequenceCounts[order].set(sequence, (sequenceCounts[order].get(sequence) ?? 0) + 1);
				contextCounts[contextLength].set(context, (contextCounts[contextLength].get(context) ?? 0) + 1);
			}
		}
	}

	return {
		maxOrder,
		alpha,
		unknownCharacter: UNKNOWN_CHARACTER,
		vocabulary: [...vocabulary].sort((left, right) => left.localeCompare(right, 'zh-CN')),
		totalCharacters,
		sequenceCounts: sequenceCounts.map((counts) => sortedEntries(counts)),
		contextCounts: contextCounts.map((counts) => sortedEntries(counts)),
	};
}

export function hydrateNgramModel(model) {
	if (model._hydrated) return model;
	const cached = HYDRATED_MODELS.get(model);
	if (cached) return cached;
	const hydrated = {
		...model,
		vocabularySet: new Set(model.vocabulary),
		sequenceMaps: model.sequenceCounts.map(asMap),
		contextMaps: model.contextCounts.map(asMap),
		_hydrated: true,
	};
	HYDRATED_MODELS.set(model, hydrated);
	return hydrated;
}

function characterProbability(character, contextCharacters, model) {
	const vocabularySize = model.vocabulary.length + 1;
	const unigramCount = model.sequenceMaps[1].get(character) ?? 0;
	let probability = (unigramCount + model.alpha) /
		(model.totalCharacters + model.alpha * vocabularySize);
	const availableOrder = Math.min(model.maxOrder, contextCharacters.length + 1);
	for (let order = 2; order <= availableOrder; order += 1) {
		const context = contextCharacters.slice(-(order - 1)).join('');
		const sequenceCount = model.sequenceMaps[order].get(`${context}${character}`) ?? 0;
		const contextCount = model.contextMaps[order - 1].get(context) ?? 0;
		probability = contextCount
			? (sequenceCount + model.alpha * probability) / (contextCount + model.alpha)
			: probability;
	}
	return Math.max(probability, Number.MIN_VALUE);
}

export function scoreNgramText(text, serializedModel) {
	const model = hydrateNgramModel(serializedModel);
	const characters = [...text].map((character) => model.vocabularySet.has(character) ? character : UNKNOWN_CHARACTER);
	if (characters.length === 0) return { bpc: Number.POSITIVE_INFINITY, perplexity: Number.POSITIVE_INFINITY, characters: 0 };
	let negativeLog2 = 0;
	const context = [];
	for (const character of characters) {
		negativeLog2 -= Math.log2(characterProbability(character, context, model));
		context.push(character);
		if (context.length >= model.maxOrder) context.shift();
	}
	const bpc = negativeLog2 / characters.length;
	return { bpc, perplexity: 2 ** bpc, characters: characters.length };
}

export function selectNgramAlpha(fragments, textKey, options = {}) {
	const candidates = options.alphaCandidates ?? NGRAM_CONFIG.alphaCandidates;
	const folds = [...new Set(fragments.map((fragment) => fragment.fold).filter(Number.isInteger))].sort();
	if (folds.length < 2) return { alpha: candidates[0], results: [] };
	const results = [];
	for (const alpha of candidates) {
		let weightedBpc = 0;
		let totalCharacters = 0;
		for (const fold of folds) {
			const trainingTexts = fragments.filter((fragment) => fragment.fold !== fold).map((fragment) => fragment[textKey]);
			const heldOut = fragments.filter((fragment) => fragment.fold === fold);
			const model = fitNgramModel(trainingTexts, { ...options, alpha });
			for (const fragment of heldOut) {
				const score = scoreNgramText(fragment[textKey], model);
				weightedBpc += score.bpc * score.characters;
				totalCharacters += score.characters;
			}
		}
		results.push({ alpha, bpc: weightedBpc / Math.max(1, totalCharacters) });
	}
	results.sort((left, right) => left.bpc - right.bpc || left.alpha - right.alpha);
	return { alpha: results[0].alpha, results };
}
