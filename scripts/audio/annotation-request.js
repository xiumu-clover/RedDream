import { access } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { ANNOTATION_VOCABULARY } from './audio-blocks.js';
import { writeTextAtomic } from './files.js';

function projectRelative(projectRoot, path) {
	return relative(projectRoot, path).replaceAll('\\', '/');
}

function speakerCatalog(index) {
	const aliases = new Map();
	for (const [name, id] of Object.entries(index.characters || {})) {
		aliases.set(id, [...(aliases.get(id) || []), name]);
	}
	return Object.keys(index.cards || {}).sort().map((id) => ({
		id,
		aliases: aliases.get(id) || [],
	}));
}

export async function writeAnnotationRequest({
	projectRoot,
	chapterId,
	source,
	blocks,
	pending,
	voiceIndex,
}) {
	const researchDirectory = join(projectRoot, 'research');
	try {
		await access(researchDirectory);
	} catch (error) {
		if (error?.code === 'ENOENT') {
			throw new Error(
				'找不到 research/ 私有研究仓库；请先将 RedDream-Research 克隆到项目根目录的 research/。',
			);
		}
		throw error;
	}
	const directory = join(researchDirectory, 'drafts', 'audio-annotations');
	const requestPath = join(directory, `${chapterId}.request.md`);
	const pendingIds = new Set(pending.map(({ block }) => block.blockId));
	const blockIndex = new Map(blocks.map((block, index) => [block.blockId, index]));

	const sections = pending.map(({ block, reason }) => {
		const index = blockIndex.get(block.blockId);
		const previous = index > 0 ? blocks[index - 1] : undefined;
		const next = index < blocks.length - 1 ? blocks[index + 1] : undefined;
		return [
			`### ${block.blockId} · ${block.kind}`,
			'',
			`原因：${reason}；正文第 ${block.source.line} 行`,
			`textHash：\`${block.textHash}\``,
			`contextHash：\`${block.contextHash}\``,
			...(block.changeRatio === undefined ? [] : [`- 变化率：${(block.changeRatio * 100).toFixed(1)}%`]),
			'',
			`前：${previous?.text || '（无）'}`,
			'',
			`正文：${block.text}`,
			'',
			`后：${next?.text || '（无）'}`,
		].join('\n');
	});

	const content = `# 第 ${Number(chapterId)} 回音频标注任务

源文件：\`${source}\`

请结合上下文，为下面 ${pending.length} 个语音块生成细腻、克制且可验证的朗读标注，并把结果合并到 \`content/audio/annotations/${chapterId}.json\` 的 \`annotations\` 对象中。不要修改小说正文、blockId、textHash 或 contextHash。

## 约束

- \`speakerRef\` 使用人物音色卡 ID；旁白使用 \`$narrator\`。引号只是对话候选，书名、转述或内心引用可以标为旁白。
- emotion.family：${ANNOTATION_VOCABULARY.emotionFamilies.join(' / ')}。
- pace：${ANNOTATION_VOCABULARY.paces.join(' / ')}。
- pitch：${ANNOTATION_VOCABULARY.pitches.join(' / ')}。
- energy：${ANNOTATION_VOCABULARY.energies.join(' / ')}。
- timbre：${ANNOTATION_VOCABULARY.timbres.join(' / ')}，至少一项。
- modifiers：${ANNOTATION_VOCABULARY.modifiers.join(' / ')}，可以为空数组。
- emotion.variant 使用简短、细腻的语气名称，例如 rage、sullen-anger、choked-sadness、bitter-smile、solemn。
- Edge-TTS 不能保证真实演绎哭腔、冷笑等修饰；仍应保留语义，供以后切换更强的服务商。

## 输出格式

只输出一个可以直接合并进 \`annotations\` 的 JSON 对象。每个键必须采用下面的完整结构；旁白块通常使用 \`$narrator\`，对话块根据上下文选择人物音色卡。

\`\`\`json
{
  "${chapterId}-b0001": {
    "textHash": "原样复制本块 textHash",
    "contextHash": "原样复制本块 contextHash",
    "speakerRef": "$narrator",
    "emotion": { "family": "calm", "variant": "neutral", "intensity": 1 },
    "pace": "medium",
    "pitch": "medium",
    "energy": "medium",
    "timbre": ["clear"],
    "modifiers": [],
    "reviewStatus": "ai-reviewed",
    "confidence": 0.8,
    "note": "说明人物、情绪和演绎依据"
  }
}
\`\`\`

## 可用音色卡

\`$narrator\`（随网站男/女旁白设置切换）

${speakerCatalog(voiceIndex).map(({ id, aliases }) => `- \`${id}\`：${aliases.join('、') || '无人物别名'}`).join('\n')}

## 待标注块

${sections.join('\n\n')}

## 完成检查

- 必须覆盖这些 blockId：${[...pendingIds].join('、')}。
- JSON 必须保留文件中的其他已有标注。
- 完成后重新运行 \`generate_audio.bat\`。
`;

	await writeTextAtomic(requestPath, content);
	return { path: requestPath, relativePath: projectRelative(projectRoot, requestPath) };
}
