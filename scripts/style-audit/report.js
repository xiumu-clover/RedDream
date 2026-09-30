function number(value, digits = 1) {
	return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function percent(value) {
	return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : '—';
}

function escapeCell(value) {
	return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

function clusterLabel(cluster) {
	return Number.isInteger(cluster) ? String.fromCharCode(65 + cluster) : '—';
}

export function renderMarkdownReport(result) {
	if (result.kind !== 'style-audit-result') throw new Error('输入不是文风审验结果。');
	const lines = [
		'# 前八十回文风相容度审验报告',
		'',
		`> ${result.disclaimer}`,
		'',
		`- 模型：\`${result.modelHash}\``,
		`- 参考语料：\`${result.corpusHash}\``,
		`- 基准状态：${result.modelStatus}`,
		`- 神经通道：${result.neuralStatus === 'merged' ? '已合并' : '未运行；当前语言模型分数来自字符 1—5 gram 基线'}`,
		'',
	];
	if (result.referenceMixture?.masked) {
		lines.push(
			'## 参考风格簇',
			'',
			`> ${result.referenceMixture.interpretation}`,
			'',
			...result.referenceMixture.masked.chapters.map((chapters, index) => `- 风格簇 ${clusterLabel(index)}：训练回目 ${chapters.join('、')}`),
			`- 章节级 silhouette：${number(result.referenceMixture.masked.silhouette, 3)}`,
			...(result.referenceMixture.masked.silhouette < 0.2
				? ['- 当前二簇分离度较弱，只能作为内部异质性提示，不能据此支持“两位作者”结论。']
				: []),
			'',
		);
	}

	for (const input of result.inputs) {
		const aggregate = input.aggregate;
		lines.push(
			`## ${input.id}`,
			'',
			`来源：\`${input.file}\``,
			'',
			'| 总体相容度 | 特征通道 | 困惑度通道 | 结论 | 95% 区间 |',
			'| ---: | ---: | ---: | --- | --- |',
			`| ${number(aggregate.overall)} | ${number(aggregate.feature)} | ${number(aggregate.languageModel)} | ${aggregate.band} | ${aggregate.confidenceInterval ? `${number(aggregate.confidenceInterval.lower)}—${number(aggregate.confidenceInterval.upper)}` : '—'} |`,
			'',
		);
		if (input.warnings.length) {
			lines.push('### 警告', '');
			for (const warning of input.warnings) lines.push(`- ${warning}`);
			lines.push('');
		}

		lines.push(
			'### 逐片结果',
			'',
			'| 片段 | 字数 | 对白占比 | 风格簇 | 总分 | 特征 | 困惑度 | BPC | 判断 |',
			'| --- | ---: | ---: | --- | ---: | ---: | ---: | ---: | --- |',
		);
		for (const fragment of input.fragments) {
			const clusters = fragment.masked.featureCluster === fragment.masked.languageCluster
				? clusterLabel(fragment.masked.featureCluster)
				: `${clusterLabel(fragment.masked.featureCluster)}/${clusterLabel(fragment.masked.languageCluster)}`;
			lines.push(`| ${fragment.id} | ${fragment.characters} | ${percent(fragment.dialogueRatio)} | ${clusters} | ${number(fragment.compatibility.overall)} | ${number(fragment.compatibility.feature)} | ${number(fragment.compatibility.languageModel)} | ${number(fragment.masked.bpc, 3)} | ${fragment.compatibility.band} |`);
		}
		lines.push('');

		const worst = [...input.fragments]
			.sort((left, right) => (left.compatibility.overall ?? Number.POSITIVE_INFINITY) - (right.compatibility.overall ?? Number.POSITIVE_INFINITY))
			.slice(0, Math.min(5, input.fragments.length));
		lines.push('### 优先复核片段', '');
		for (const fragment of worst) {
			lines.push(
				`#### ${fragment.id}（${number(fragment.compatibility.overall)}）`,
				'',
				`> ${escapeCell(fragment.excerpt)}${fragment.excerpt.length >= 160 ? '……' : ''}`,
				'',
				`- 原文偏移：${fragment.sourceOffset.start ?? '—'}—${fragment.sourceOffset.end ?? '—'}`,
				`- 最近风格簇：特征 ${clusterLabel(fragment.masked.featureCluster)}，语言模型 ${clusterLabel(fragment.masked.languageCluster)}`,
				`- 无遮蔽敏感性：${number(fragment.unmaskedSensitivity.overall)}（与主分相差 ${number(fragment.unmaskedSensitivity.deltaFromMasked)}）`,
				`- 复写检查：最长 ${fragment.copying.longestMatch} 字，12-gram 重合 ${percent(fragment.copying.ngramOverlap)}`,
			);
			if (fragment.nearestReferences.length) {
				lines.push(`- 最近参考：${fragment.nearestReferences.map((reference) => `第 ${reference.chapter} 回 ${reference.fragmentId}`).join('；')}`);
			}
			for (const suggestion of fragment.suggestions) lines.push(`- ${suggestion}`);
			lines.push('');
		}
	}
	return `${lines.join('\n').trim()}\n`;
}
