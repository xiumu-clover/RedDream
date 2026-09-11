import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import {
	chapterToAudioCandidates,
	hashJson,
	reconcileAudioBlocks,
	resolveChapterAnnotations,
	sha256,
	textChangeRatio,
	voiceAnnotationHash,
} from '../../scripts/audio/audio-blocks.js';
import { resolveBlockRenderSpec } from '../../scripts/audio/render-plan.js';
import { assembleMp3Track, trackHashForFragments } from '../../scripts/audio/track.js';

function annotationFor(block: Record<string, any>, overrides: Record<string, any> = {}) {
	return {
		textHash: block.textHash,
		contextHash: block.contextHash,
		speakerRef: '$narrator',
		emotion: { family: 'calm', variant: 'neutral', intensity: 1 },
		pace: 'medium',
		pitch: 'medium',
		energy: 'medium',
		timbre: ['clear'],
		modifiers: [],
		reviewStatus: 'ai-reviewed',
		...overrides,
	};
}

function compileBody(source: string, sourceName: string) {
	return chapterToAudioCandidates(compileChapter(`[T]测试回目[-]\n${source}`, { sourceName })).slice(1);
}

test('AST 分块过滤批注并区分标题、段落、对话和诗词', () => {
	const compiled = compileChapter(`[T]第八十一回[-]
旁白甲[zp]脂批[-]道：“人物说话。”旁白乙。
[sc]诗句一
诗句二[-]
[fu]赋正文[-]`, { sourceName: '081-test.md' });
	const blocks = chapterToAudioCandidates(compiled);

	assert.deepEqual(blocks.map(({ kind }) => kind), [
		'narration', 'narration', 'dialogue', 'narration', 'poetry', 'poetry',
	]);
	assert.equal(blocks[0].sourceRole, 'title');
	assert.equal(blocks[2].text, '人物说话。');
	assert.equal(blocks[4].text, '诗句一\n诗句二');
	assert.doesNotMatch(blocks.map(({ text }) => text).join(''), /脂批/u);
	assert.throws(
		() => chapterToAudioCandidates(compileChapter('[T]测试[-]\n旁白：“没有闭合。', { sourceName: 'bad.md' })),
		/双引号没有在本段闭合/u,
	);
});

test('编辑距离以 Unicode 字符计算', () => {
	assert.equal(textChangeRatio('甲乙丙丁', '甲乙戊丁'), 0.25);
	assert.equal(textChangeRatio('完全相同', '完全相同'), 0);
});

test('稳定 blockId 可跨插入保留，重复短句不会共用身份', () => {
	const original = compileBody('甲段。\n“是。”\n乙段。\n“是。”', 'original.md');
	const first = reconcileAudioBlocks('081', original);
	const previousMap = { blocks: first.blocks, nextBlockNumber: first.nextBlockNumber };
	const inserted = compileBody('新增段。\n甲段。\n“是。”\n乙段。\n“是。”', 'inserted.md');
	const second = reconcileAudioBlocks('081', inserted, previousMap);

	assert.equal(new Set(first.blocks.map(({ blockId }) => blockId)).size, first.blocks.length);
	assert.equal(second.blocks[1].blockId, first.blocks[0].blockId);
	assert.equal(second.blocks[2].blockId, first.blocks[1].blockId);
	assert.equal(second.blocks[4].blockId, first.blocks[3].blockId);
	assert.notEqual(second.blocks[2].blockId, second.blocks[4].blockId);
});

test('旁白小改自动继承，诗词修改要求重新标注', () => {
	const original = compileBody('旁白共有十个文字。\n[sc]原诗一句[-]', 'original.md');
	const first = reconcileAudioBlocks('081', original);
	const changed = compileBody('旁白共有十一个文字。\n[sc]新诗一句[-]', 'changed.md');
	const second = reconcileAudioBlocks('081', changed, {
		blocks: first.blocks,
		nextBlockNumber: first.nextBlockNumber,
	});

	assert.equal(second.blocks[0].matchStatus, 'auto-reused');
	assert.equal(second.blocks[1].matchStatus, 'needs-review');
});

test('标注绑定 text/context hash，自动继承时更新绑定', () => {
	const original = compileBody('旁白共有十个文字。', 'a.md');
	const first = reconcileAudioBlocks('081', original);
	const changed = compileBody('旁白共有十一个文字。', 'b.md');
	const second = reconcileAudioBlocks('081', changed, { blocks: first.blocks, nextBlockNumber: 2 });
	const oldBlock = first.blocks[0];
	const result = resolveChapterAnnotations({
		chapterId: '081',
		blocks: second.blocks,
		document: {
			version: 1,
			chapter: '081',
			annotations: { [oldBlock.blockId]: annotationFor(oldBlock) },
		},
		voiceCardIds: new Set(),
	});

	assert.equal(result.pending.length, 0);
	assert.equal(result.accepted[oldBlock.blockId].textHash, second.blocks[0].textHash);
	assert.equal(result.accepted[oldBlock.blockId].reviewStatus, 'auto-reused');
	assert.equal(result.document.annotationSetHash, hashJson(result.document.annotations));
});

test('男女旁白生成不同 renderHash，人物对话跨轨共用 renderHash', () => {
	const block = {
		blockId: '081-b0001',
		text: '测试文字。',
		textHash: sha256('测试文字。'),
	};
	const config = {
		narratorProfiles: {
			female: { provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural', rate: '+0%', pitch: '+0Hz', volume: '+0%' },
			male: { voiceCardId: 'narrator' },
		},
	};
	const cards = {
		narrator: { id: 'narrator', provider: 'edge', voice: 'zh-CN-YunyangNeural', prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' }, emotions: { neutral: {} } },
		person: { id: 'person', provider: 'edge', voice: 'zh-CN-YunxiNeural', prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' }, emotions: { neutral: {} } },
	};
	const narrator = annotationFor({ ...block, contextHash: 'context' });
	const female = resolveBlockRenderSpec({ block, annotation: narrator, variant: 'female', config, cards });
	const male = resolveBlockRenderSpec({ block, annotation: narrator, variant: 'male', config, cards });
	assert.notEqual(female.renderHash, male.renderHash);

	const dialogue = { ...narrator, speakerRef: 'person' };
	const dialogueFemale = resolveBlockRenderSpec({ block, annotation: dialogue, variant: 'female', config, cards });
	const dialogueMale = resolveBlockRenderSpec({ block, annotation: dialogue, variant: 'male', config, cards });
	assert.equal(dialogueFemale.renderHash, dialogueMale.renderHash);
	assert.equal(voiceAnnotationHash(dialogue), voiceAnnotationHash({ ...dialogue, note: '不影响声音' }));
});

test('整轨 hash 与片段顺序相关，并可拼接同格式 MP3', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'hlm-track-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const frame = Buffer.alloc(144);
	frame.set([0xff, 0xf3, 0x64, 0xc4]);
	await mkdir(directory, { recursive: true });
	await writeFile(join(directory, 'a.mp3'), frame);
	await writeFile(join(directory, 'b.mp3'), frame);
	const result = await assembleMp3Track(
		[join(directory, 'a.mp3'), join(directory, 'b.mp3')],
		join(directory, 'track.mp3'),
	);

	assert.equal(result.frames, 2);
	assert.equal(result.bytes, 288);
	assert.notEqual(trackHashForFragments(['a', 'b']), trackHashForFragments(['b', 'a']));
});
