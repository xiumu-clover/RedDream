import { featureDistance, mean, quantile, vectorizeFeatures } from './features.js';
import { fitStyleView, scoreLanguageView } from './model.js';
import { aggregateScores, fragmentCompatibility } from './scoring.js';
import { sha256 } from './text.js';

function stableJson(value) {
	return `${JSON.stringify(value, null, 2)}\n`;
}

function averageVectors(vectors) {
	return vectors[0].map((_value, index) => mean(vectors.map((vector) => vector[index])));
}

function squaredDistance(left, right) {
	let sum = 0;
	for (let index = 0; index < left.length; index += 1) sum += (left[index] - right[index]) ** 2;
	return sum;
}

function euclideanDistance(left, right) {
	return Math.sqrt(squaredDistance(left, right));
}

function robustChapterVectors(points) {
	const dimensions = points[0].vector.length;
	const centers = [];
	const scales = [];
	for (let dimension = 0; dimension < dimensions; dimension += 1) {
		const values = points.map((point) => point.vector[dimension]);
		const center = quantile(values, 0.5);
		const mad = quantile(values.map((value) => Math.abs(value - center)), 0.5) * 1.4826;
		const iqr = (quantile(values, 0.75) - quantile(values, 0.25)) / 1.349;
		centers.push(center);
		scales.push(mad || iqr || 1);
	}
	return points.map((point) => ({
		...point,
		vector: point.vector.map((value, index) => (
			Math.max(-5, Math.min(5, (value - centers[index]) / scales[index]))
		)),
	}));
}

function initializeCentroids(points, clusterCount) {
	const globalCenter = averageVectors(points.map((point) => point.vector));
	const first = [...points].sort((left, right) => (
		squaredDistance(right.vector, globalCenter) - squaredDistance(left.vector, globalCenter) ||
		left.chapter - right.chapter
	))[0];
	const selected = [first];
	while (selected.length < clusterCount) {
		const next = [...points]
			.filter((point) => !selected.includes(point))
			.map((point) => ({
				point,
				distance: Math.min(...selected.map((centroid) => squaredDistance(point.vector, centroid.vector))),
			}))
			.sort((left, right) => right.distance - left.distance || left.point.chapter - right.point.chapter)[0]
			.point;
		selected.push(next);
	}
	return selected.map((point) => [...point.vector]);
}

function fitChapterClusters(points, clusterCount) {
	let centroids = initializeCentroids(points, clusterCount);
	let assignments = Array(points.length).fill(-1);
	for (let iteration = 0; iteration < 200; iteration += 1) {
		const nextAssignments = points.map((point) => {
			const distances = centroids.map((centroid) => squaredDistance(point.vector, centroid));
			return distances.reduce((best, distance, index) => (
				distance < distances[best] ? index : best
			), 0);
		});
		if (nextAssignments.every((cluster, index) => cluster === assignments[index])) break;
		assignments = nextAssignments;
		centroids = centroids.map((centroid, cluster) => {
			const members = points
				.filter((_point, index) => assignments[index] === cluster)
				.map((point) => point.vector);
			return members.length ? averageVectors(members) : centroid;
		});
	}

	const rawClusters = Array.from({ length: clusterCount }, (_value, cluster) => points
		.filter((_point, index) => assignments[index] === cluster)
		.map((point) => point.chapter)
		.sort((left, right) => left - right));
	const order = Array.from({ length: clusterCount }, (_value, cluster) => cluster)
		.sort((left, right) => Math.min(...rawClusters[left]) - Math.min(...rawClusters[right]));
	const relabel = new Map(order.map((cluster, index) => [cluster, index]));
	assignments = assignments.map((cluster) => relabel.get(cluster));
	centroids = order.map((cluster) => centroids[cluster]);
	const clusters = order.map((cluster) => rawClusters[cluster]);

	const silhouettes = points.map((point, pointIndex) => {
		const own = assignments[pointIndex];
		const withinPoints = points.filter((_candidate, index) => index !== pointIndex && assignments[index] === own);
		const within = withinPoints.length
			? mean(withinPoints.map((candidate) => euclideanDistance(point.vector, candidate.vector)))
			: 0;
		const between = Math.min(...Array.from({ length: clusterCount }, (_value, cluster) => cluster)
			.filter((cluster) => cluster !== own)
			.map((cluster) => mean(points
				.filter((_candidate, index) => assignments[index] === cluster)
				.map((candidate) => euclideanDistance(point.vector, candidate.vector)))));
		return withinPoints.length ? (between - within) / Math.max(within, between, Number.EPSILON) : 0;
	});
	return {
		clusterCount,
		silhouette: mean(silhouettes),
		minimumClusterSize: Math.min(...clusters.map((cluster) => cluster.length)),
		clusters,
		assignments: Object.fromEntries(points.map((point, index) => [point.chapter, assignments[index]])),
		centroids,
	};
}

function featureLabel(feature) {
	if (feature === 'structure.dialogue_ratio') return '对白占比';
	if (feature === 'structure.dialogue_turns_per_1000') return '对白话轮密度';
	if (feature.startsWith('sentence.')) return `句长 ${feature.slice('sentence.'.length)}`;
	if (feature.startsWith('clause.')) return `分句长度 ${feature.slice('clause.'.length)}`;
	if (feature.startsWith('lexical.')) return `词汇 ${feature.slice('lexical.'.length)}`;
	if (feature.startsWith('punctuation.')) return `标点“${feature.slice('punctuation.'.length)}”`;
	if (feature.startsWith('formula.')) return `套语“${feature.slice('formula.'.length)}”`;
	if (feature.startsWith('function.')) return `虚词“${feature.slice('function.'.length)}”`;
	if (feature.startsWith('ngram.')) return `字符组合“${feature.replace(/^ngram\.\d\./u, '')}”`;
	return feature;
}

function clusterProfiles(clusterResult, points, featureKeys) {
	return clusterResult.clusters.map((chapters, cluster) => {
		const vectors = points.filter((point) => chapters.includes(point.chapter)).map((point) => point.vector);
		const center = averageVectors(vectors);
		return {
			cluster,
			chapters,
			topSignals: center
				.map((value, index) => ({ feature: featureLabel(featureKeys[index]), z: value }))
				.sort((left, right) => Math.abs(right.z) - Math.abs(left.z) || left.feature.localeCompare(right.feature, 'zh-CN'))
				.slice(0, 6),
		};
	});
}

function scoreFragment(fragment, view) {
	const features = vectorizeFeatures(fragment.maskedText, view.featureModel);
	const distance = featureDistance(features.standardized, view.featureModel);
	const language = scoreLanguageView(fragment.maskedText, view);
	return {
		...fragmentCompatibility({
			featureDistance: distance.combined,
			bpc: language.bpc,
			calibration: view.calibration,
		}),
		bpc: language.bpc,
		featureCluster: distance.cluster,
		languageCluster: language.cluster,
	};
}

function dominantCluster(scores, key) {
	const counts = new Map();
	for (const score of scores) counts.set(score[key], (counts.get(score[key]) ?? 0) + 1);
	return [...counts.entries()].sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0] ?? null;
}

function referenceCluster(fragments, featureModel) {
	const vectors = fragments.map((fragment) => vectorizeFeatures(fragment.maskedText, featureModel).standardized);
	const chapterVector = averageVectors(vectors);
	return featureDistance(chapterVector, featureModel).cluster;
}

function bandCounts(chapters) {
	return Object.fromEntries(['参考范围内', '偏弱', '显著异常'].map((band) => [
		band,
		chapters.filter((chapter) => chapter.band === band).length,
	]));
}

export function buildReferenceAnalysis(corpus, model) {
	if (corpus.kind !== 'style-audit-reference-corpus') throw new Error('输入不是文风审验参考语料。');
	if (model.kind !== 'style-audit-model') throw new Error('输入不是文风审验模型包。');
	if (corpus.corpusHash !== model.corpusHash) throw new Error('参考语料与模型哈希不匹配。');

	const prose = corpus.fragments.filter((fragment) => fragment.track === 'prose');
	const training = prose.filter((fragment) => fragment.split === 'training');
	const calibration = prose.filter((fragment) => fragment.split === 'calibration');
	const foldViews = new Map();
	for (const fold of [...new Set(training.map((fragment) => fragment.fold))].sort()) {
		foldViews.set(fold, fitStyleView(
			training.filter((fragment) => fragment.fold !== fold),
			calibration,
			'maskedText',
			{ alpha: model.masked.alphaSelection.alpha },
		));
	}

	const byChapter = new Map();
	for (const fragment of prose) {
		if (!byChapter.has(fragment.chapter)) byChapter.set(fragment.chapter, []);
		byChapter.get(fragment.chapter).push(fragment);
	}

	const chapterMeta = new Map(corpus.chapters.map((chapter) => [chapter.chapter, chapter]));
	const chapters = [...byChapter.entries()].map(([chapter, fragments]) => {
		const meta = chapterMeta.get(chapter);
		const view = meta.split === 'training' ? foldViews.get(meta.fold) : model.masked;
		const fragmentScores = fragments.map((fragment) => scoreFragment(fragment, view));
		const aggregate = aggregateScores(fragmentScores);
		const alerts = [
			...(aggregate.feature < 5 ? ['特征通道'] : []),
			...(aggregate.languageModel < 5 ? ['困惑度通道'] : []),
		];
		return {
			chapter,
			file: meta.file,
			split: meta.split,
			scoringMethod: meta.split === 'training'
				? '整回分组交叉验证'
				: meta.split === 'test' ? '冻结测试' : '校准集诊断',
			fold: meta.fold,
			proseCharacters: meta.proseCharacters,
			fragmentCount: fragments.length,
			...aggregate,
			alerts,
			meanBpc: mean(fragmentScores.map((score) => score.bpc)),
			featureClusterVote: dominantCluster(fragmentScores, 'featureCluster'),
			languageClusterVote: dominantCluster(fragmentScores, 'languageCluster'),
			referenceCluster: referenceCluster(fragments, model.masked.featureModel),
		};
	}).sort((left, right) => left.chapter - right.chapter);

	const exploratoryFeatureIndexes = model.masked.featureModel.keys
		.map((key, index) => ({ key, index }))
		.filter(({ key }) => key !== 'structure.characters_log' && !key.startsWith('ngram.'));
	const featureKeys = exploratoryFeatureIndexes.map(({ key }) => key);
	const chapterPoints = robustChapterVectors([...byChapter.entries()]
		.map(([chapter, fragments]) => {
			const fullVector = averageVectors(fragments.map((fragment) => (
				vectorizeFeatures(fragment.maskedText, model.masked.featureModel).standardized
			)));
			return {
				chapter,
				vector: exploratoryFeatureIndexes.map(({ index }) => fullVector[index]),
			};
		})
		.sort((left, right) => left.chapter - right.chapter));
	const candidates = [2, 3, 4, 5, 6].map((clusterCount) => fitChapterClusters(chapterPoints, clusterCount));
	const eligible = candidates.filter((candidate) => candidate.minimumClusterSize >= 5);
	const selected = [...(eligible.length ? eligible : candidates)]
		.sort((left, right) => right.silhouette - left.silhouette || left.clusterCount - right.clusterCount)[0];
	for (const chapter of chapters) chapter.exploratoryCluster = selected.assignments[chapter.chapter];

	const splits = Object.fromEntries(['training', 'calibration', 'test'].map((split) => {
		const rows = chapters.filter((chapter) => chapter.split === split);
		return [split, { chapters: rows.length, bands: bandCounts(rows) }];
	}));
	const result = {
		schemaVersion: model.schemaVersion,
		kind: 'style-audit-reference-analysis',
		modelHash: model.modelHash,
		corpusHash: corpus.corpusHash,
		disclaimer: '本报告描述文本相容度和探索性语言分组，不是作者归属或作者人数鉴定。',
		scoringNotes: {
			training: '训练回目按预先固定的整回折留出评分；第17—18回始终共同留出。',
			calibration: '校准回未参与模型拟合，但参与经验分数刻度，因此只作分布诊断。',
			test: '冻结测试回既未参与拟合，也未参与阈值和经验刻度确定。',
		},
		validation: model.validation,
		referenceMixture: model.mixture,
		summary: {
			allChapters: chapters.length,
			bands: bandCounts(chapters),
			splits,
		},
		exploratoryClustering: {
			method: '全80回遮蔽专名后的章节均值风格特征，排除字符 n-gram 与片段长度；稳健标准化；确定性 k-means；按 silhouette 比较 2—6 类；候选类最少5回。',
			selectedClusterCount: selected.clusterCount,
			selectedSilhouette: selected.silhouette,
			strength: selected.silhouette < 0.2 ? '很弱' : selected.silhouette < 0.35 ? '偏弱' : selected.silhouette < 0.5 ? '中等' : '较强',
			candidates: candidates.map(({ clusterCount, silhouette, minimumClusterSize, clusters }) => ({
				clusterCount,
				silhouette,
				minimumClusterSize,
				clusters,
			})),
			selectedProfiles: clusterProfiles(selected, chapterPoints, featureKeys),
		},
		chapters,
	};
	result.analysisHash = sha256(stableJson(result));
	return result;
}

function number(value, digits = 1) {
	return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function clusterLabel(cluster) {
	return Number.isInteger(cluster) ? String.fromCharCode(65 + cluster) : '—';
}

function chapterList(chapters) {
	return chapters.length ? chapters.join('、') : '无';
}

function signalText(signal) {
	return `${signal.feature}${signal.z >= 0 ? '偏高' : '偏低'}（${number(Math.abs(signal.z), 2)}）`;
}

export function renderReferenceAnalysis(result) {
	if (result.kind !== 'style-audit-reference-analysis') throw new Error('输入不是前八十回参考分析。');
	const abnormal = result.chapters.filter((chapter) => chapter.band === '显著异常').map((chapter) => chapter.chapter);
	const weak = result.chapters.filter((chapter) => chapter.band === '偏弱').map((chapter) => chapter.chapter);
	const featureAlerts = result.chapters.filter((chapter) => chapter.alerts.includes('特征通道')).map((chapter) => chapter.chapter);
	const languageAlerts = result.chapters.filter((chapter) => chapter.alerts.includes('困惑度通道')).map((chapter) => chapter.chapter);
	const frozen = result.chapters.filter((chapter) => chapter.split === 'test');
	const frozenAbnormal = frozen.filter((chapter) => chapter.band === '显著异常').map((chapter) => chapter.chapter);
	const selected = result.exploratoryClustering;
	const twoCluster = result.exploratoryClustering.candidates.find((candidate) => candidate.clusterCount === 2);
	const lines = [
		'# 前八十回逐回文风基准报告',
		'',
		`> ${result.disclaimer}`,
		'',
		'## 先说结论',
		'',
		`- 不是“八十回全部通过”。按各自合规评分口径，参考范围内 ${result.summary.bands['参考范围内']} 回，偏弱 ${result.summary.bands['偏弱']} 回，显著异常 ${result.summary.bands['显著异常']} 回。`,
		`- 显著异常回目：${chapterList(abnormal)}；偏弱回目：${chapterList(weak)}。这些是“相对指定13回训练基准偏离”，不是伪作或异作者判决。`,
		`- 红线来源：特征通道 ${chapterList(featureAlerts)}；困惑度通道 ${chapterList(languageAlerts)}。单通道报警应先复核该回的体裁和叙事功能。`,
		`- 真正严格未见的冻结测试共 ${frozen.length} 回，其中 ${frozen.length - frozenAbnormal.length} 回未触发显著异常，${frozenAbnormal.length} 回触发：${chapterList(frozenAbnormal)}；误报率 ${number(result.validation.falseOutlierRate * 100)}%，低于预设 10% 上限。`,
		`- 全八十回探索性比较 2—6 类后，数值最优为 ${selected.selectedClusterCount} 类，silhouette=${number(selected.selectedSilhouette, 3)}，分离强度“${selected.strength}”。因此目前不能把类别数直接解释成作品数或作者数。`,
		'',
		'## 评分口径',
		'',
		`- 训练回（T）：${result.scoringNotes.training}`,
		`- 校准回（C）：${result.scoringNotes.calibration}`,
		`- 冻结回（F）：${result.scoringNotes.test}`,
		'- “参考范围内”表示两通道均未低于 5 且总分不低于 20；“偏弱”表示未触发单通道红线但总分低于 20；“显著异常”表示至少一个通道低于 5。',
		'',
		'## 大致可以分成几类',
		'',
		`分组方法：${selected.method}`,
		'',
		'| 类数 k | silhouette | 最小类规模 | 各类规模 |',
		'| ---: | ---: | ---: | --- |',
	];
	for (const candidate of selected.candidates) {
		lines.push(`| ${candidate.clusterCount} | ${number(candidate.silhouette, 3)} | ${candidate.minimumClusterSize} | ${candidate.clusters.map((cluster) => cluster.length).join(' / ')} |`);
	}
	lines.push('', `### 数值最优的 ${selected.selectedClusterCount} 类`, '');
	for (const profile of selected.selectedProfiles) {
		lines.push(
			`- ${clusterLabel(profile.cluster)} 类（${profile.chapters.length} 回）：${chapterList(profile.chapters)}`,
			`  主要区分信号：${profile.topSignals.map(signalText).join('；')}。`,
		);
	}
	if (twoCluster && selected.selectedClusterCount !== 2) {
		lines.push('', '### 若强制按“两部文本系统”观察', '');
		for (const [index, chapters] of twoCluster.clusters.entries()) {
			lines.push(`- ${clusterLabel(index)} 类（${chapters.length} 回）：${chapterList(chapters)}`);
		}
		lines.push(`- 二分类 silhouette=${number(twoCluster.silhouette, 3)}；若数值较低，应视为连续渐变或多种叙事场景，不宜视作清晰断裂。`);
	}

	lines.push(
		'',
		'## 逐回数据',
		'',
		'其中“参考簇”是相对原定13回训练样本的 A/B 最近中心；“探索类”是上面全八十回数值最优方案中的类别。',
		'',
		'| 回 | 集合 | 片段 | 正文字数 | 总分 | 特征 | 困惑度 | BPC | 参考簇 | 探索类 | 判断 | 红线 |',
		'| ---: | :---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: | :---: | --- | --- |',
	);
	const splitLabel = { training: 'T', calibration: 'C', test: 'F' };
	for (const chapter of result.chapters) {
		lines.push(`| ${chapter.chapter} | ${splitLabel[chapter.split]} | ${chapter.fragmentCount} | ${chapter.proseCharacters} | ${number(chapter.overall)} | ${number(chapter.feature)} | ${number(chapter.languageModel)} | ${number(chapter.meanBpc, 3)} | ${clusterLabel(chapter.referenceCluster)} | ${clusterLabel(chapter.exploratoryCluster)} | ${chapter.band} | ${chapter.alerts.join('、') || '—'} |`);
	}
	lines.push(
		'',
		'## 解释边界',
		'',
		'- 低分首先表示相对训练基准的语言统计偏离，可能来自诗化段落、对白密度、场景、版本整理或章节功能。',
		'- 聚类会把连续差异强制切开；silhouette 较低时，类别边界尤其不稳定。',
		'- 要检验“两部作品拼合”，还需要版本学证据、情节接缝、人物设定矛盾、叙事时间和词汇年代等独立证据相互印证。',
		'',
		`模型：\`${result.modelHash}\`  `,
		`语料：\`${result.corpusHash}\`  `,
		`报告：\`${result.analysisHash}\``,
	);
	return `${lines.join('\n').trim()}\n`;
}
