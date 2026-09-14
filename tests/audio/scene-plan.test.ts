import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import { chapterToAudioCandidates, sha256 } from '../../scripts/audio/audio-blocks.js';
import { normalizeLegacyNoteMarkers, stripFrontmatter } from '../../scripts/audio/chapter-text.js';
import { replaceFileAtomic } from '../../scripts/audio/files.js';
import {
	CHARACTER_VOICE_IDS,
	SCENE_DEFINITIONS,
	applyPronunciationOverrides,
	alignSceneBlocks,
	buildCosyVoiceInstruction,
	chorusForBlock,
	computeSpeechLevelGain,
	extractSceneByAnchors,
	passesWhisperStructuralReview,
	resolveSceneNarratorPlan,
	selectSceneVoiceCardId,
	sceneFragmentRenderHash,
	sceneOutputDirectory,
	splitChineseDialogue,
	splitChineseDialogueWithDelivery,
} from '../../scripts/audio/scene-plan.js';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const chapterPath = join(
	projectRoot,
	'content',
	'chapters',
	'guiyou',
	'081-惜昵近公子做良媒 讳笞罚丫鬟结恶党.md',
);

async function loadCurrentScene() {
	const source = await readFile(chapterPath, 'utf8');
	const candidates = chapterToAudioCandidates(compileChapter(
		normalizeLegacyNoteMarkers(stripFrontmatter(source)),
		{ sourceName: '081-test.md' },
	));
	const definition = SCENE_DEFINITIONS['xiren-three-opera'];
	const extracted = extractSceneByAnchors(candidates, definition);
	const pendingMap = JSON.parse(await readFile(
		join(projectRoot, 'content', 'audio', '.cache', 'pending', '081.json'),
		'utf8',
	));
	const annotationDocument = JSON.parse(await readFile(
		join(projectRoot, 'content', 'audio', 'annotations', '081.json'),
		'utf8',
	));
	const aligned = alignSceneBlocks({ sceneBlocks: extracted.blocks, pendingMap, annotationDocument });
	return { definition, extracted, aligned, pendingMap, annotationDocument };
}

test('按当前正文锚点提取完整争吵场景', async () => {
	const { extracted } = await loadCurrentScene();
	assert.equal(extracted.blocks.length, 51);
	assert.equal(extracted.blocks.filter(({ kind }) => kind === 'narration').length, 29);
	assert.equal(extracted.blocks.filter(({ kind }) => kind === 'dialogue').length, 22);
	assert.match(extracted.actualStartText, /^且说宝玉独自闷闷回怡红院来/u);
	assert.equal(extracted.actualEndText, '说罢动了气，一面理着头发衣襟，往屋里去了。');
});

test('旧 blockId 偏移时按文本、hash 和上下文对齐，不按当前位置套标注', async () => {
	const { extracted, pendingMap, annotationDocument } = await loadCurrentScene();
	const shiftedBlocks = extracted.blocks.map((block) => ({
		...block,
		order: block.order + 8,
	}));
	const aligned = alignSceneBlocks({
		sceneBlocks: shiftedBlocks,
		pendingMap,
		annotationDocument,
	});
	assert.equal(aligned.filter(({ alignmentStatus }) => alignmentStatus === 'paused').length, 0);
	assert.equal(aligned[0].order, 30);
	assert.equal(aligned[0].blockId, '081-b0022');
	assert.equal(aligned[0].alignmentMethod, 'current-annotation-text-hash-context');
	assert.equal(aligned[0].annotation.speakerRef, '$narrator');
	assert.equal(aligned[1].blockId, '081-b0023');
	assert.equal(aligned[1].annotation.speakerRef, 'jia-baoyu');
	assert.notEqual(aligned[0].blockId, `081-b${String(aligned[0].order).padStart(4, '0')}`);
});

test('无法可靠对齐的块只标记 paused，不会继承同 ID 的无关标注', () => {
	const text = '完全不同的新对白。';
	const block = {
		order: 99,
		kind: 'dialogue',
		text,
		textHash: sha256(text),
		contextHash: 'new-context',
	};
	const pendingMap = {
		blocks: [{
			order: 99,
			blockId: '081-b0099',
			kind: 'dialogue',
			text: '不相干的旧对白。',
			textHash: sha256('不相干的旧对白。'),
			contextHash: 'old-context',
		}],
	};
	const result = alignSceneBlocks({
		sceneBlocks: [block],
		pendingMap,
		annotationDocument: {
			annotations: {
				'081-b0099': {
					textHash: pendingMap.blocks[0].textHash,
					contextHash: 'old-context',
					speakerRef: 'xiren',
				},
			},
		},
	});
	assert.equal(result[0].alignmentStatus, 'paused');
	assert.equal(result[0].annotation, undefined);
});

test('旁白只路由 Edge，五个角色对白只路由指定 CosyVoice 卡', async () => {
	const { aligned } = await loadCurrentScene();
	for (const block of aligned) {
		if (block.kind === 'narration') assert.equal(block.annotation.speakerRef, '$narrator');
		else assert.equal(CHARACTER_VOICE_IDS.has(block.annotation.speakerRef), true);
	}
	const counts = Object.fromEntries([...CHARACTER_VOICE_IDS].map((id) => [
		id,
		aligned.filter((block) => block.annotation.speakerRef === id).length,
	]));
	assert.deepEqual(counts, {
		'jia-baoyu': 9,
		xiren: 3,
		'ai-guan': 5,
		'dou-guan': 3,
		'kui-guan': 2,
	});
});

test('三处齐声块选择标注指定的艾官、荳官、葵官主声', async () => {
	const { definition, aligned } = await loadCurrentScene();
	for (const [blockId, mainVoice] of Object.entries({
		'081-b0032': 'ai-guan',
		'081-b0053': 'dou-guan',
		'081-b0065': 'kui-guan',
	})) {
		const chorus = chorusForBlock(definition, aligned.find((block) => block.blockId === blockId));
		assert.equal(chorus.mainVoice, mainVoice);
		assert.deepEqual(chorus.voices, [mainVoice]);
		assert.equal(chorus.mode, 'single-main');
	}
});

test('宝玉在本场统一用“有什么话咱且轻轻说”片段所用卡，袭人和三官保持各自路由', () => {
	const block = (speakerRef, variant) => ({
		blockId: '081-test',
		annotation: { speakerRef, emotion: { family: 'mixed', variant, intensity: 2 } },
	});
	assert.equal(selectSceneVoiceCardId(block('jia-baoyu', 'urgent-restraint')), 'jia-baoyu:restrained-sadness');
	assert.equal(selectSceneVoiceCardId(block('jia-baoyu', 'guilty-consolation')), 'jia-baoyu:restrained-sadness');
	assert.equal(selectSceneVoiceCardId(block('jia-baoyu', 'grieving-compassion')), 'jia-baoyu:restrained-sadness');
	assert.equal(selectSceneVoiceCardId(block('xiren', 'defensive-indignation')), 'xiren:assertive-rivalry');
	assert.equal(selectSceneVoiceCardId(block('ai-guan', 'scathing-rage')), 'ai-guan');
	assert.equal(selectSceneVoiceCardId(block('dou-guan', 'collective-outcry')), 'dou-guan');
	assert.equal(selectSceneVoiceCardId(block('kui-guan', 'forced-agreement')), 'kui-guan');
});

test('标注可强制艾官开头整句独立连贯合成，不改原文', () => {
	const text = '好你个西洋花点子哈巴狗儿！不枉李奶奶说你妆狐媚子哄人，果然是个刁滑狐狸！';
	const opening = '好你个西洋花点子哈巴狗儿！';
	const units = splitChineseDialogueWithDelivery(text, {
		forcedUnits: [{ text: opening, speed: 1.16, continuous: true }],
	});
	assert.equal(units.map((unit) => unit.text).join(''), text);
	assert.equal(units[0].text, opening);
	assert.equal(units[0].delivery?.continuous, true);
	assert.equal(units[0].delivery?.speed, 1.16);
});

test('合成读音覆盖不改书面原文', () => {
	const source = '莫不是李嬷嬷又来排揎丫头不成？';
	assert.equal(
		applyPronunciationOverrides(source, [{ text: '排揎', pinyin: 'pái xuān', replacement: '排宣' }]),
		'莫不是李嬷嬷又来排宣丫头不成？',
	);
	assert.match(source, /排揎/u);
});

test('短片段电平校准以 RMS 为目标并受峰值上限保护', () => {
	assert.equal(computeSpeechLevelGain({
		rmsDbfs: -44.2,
		peakDbfs: -24.1,
		targetRmsDbfs: -22,
		peakLimitDbfs: -3,
	}), 21.1);
	assert.equal(computeSpeechLevelGain({
		rmsDbfs: -18,
		peakDbfs: -2,
		targetRmsDbfs: -22,
		peakLimitDbfs: -3,
	}), -4);
});

test('Whisper 结构验收容忍单字同音展开，但拦截重复和长缺失', () => {
	const base = {
		expectedNormalized: '须得闹开',
		transcriptNormalized: '需要点闹开',
		lengthRatio: 1.2,
		repeatedUnexpectedSpan: null,
		differences: [{ operation: 'replace', expected: '须得', actual: '需要点' }],
	};
	assert.equal(passesWhisperStructuralReview(base), true);
	assert.equal(passesWhisperStructuralReview({ ...base, repeatedUnexpectedSpan: '哄人' }), false);
	assert.equal(passesWhisperStructuralReview({
		...base,
		transcriptNormalized: '闹开',
		lengthRatio: 0.5,
		differences: [{ operation: 'delete', expected: '须得', actual: '' }],
	}), false);
});

test('长对白按自然标点分句且不改字、不漏字、不换序', () => {
	const text = '第一句很短。第二句稍微长一些，需要自然地继续说明，仍旧不能改动原文！最后一句呢？';
	const units = splitChineseDialogue(text, 24);
	assert.equal(units.join(''), text);
	assert.equal(units.every((unit) => [...unit].length <= 24), true);
});

test('CosyVoice 指令覆盖完整语义维度并保留 instruct2 结束标记', () => {
	const instruction = buildCosyVoiceInstruction({
		emotion: { family: 'anger', variant: 'defensive-indignation', intensity: 3 },
		pace: 'fast',
		pitch: 'high',
		energy: 'heavy',
		timbre: ['sharp', 'firm'],
		modifiers: ['crying'],
	});
	assert.match(instruction, /忍怒自辩/u);
	assert.match(instruction, /强烈情绪/u);
	assert.match(instruction, /中速略快/u);
	assert.match(instruction, /偏高但不尖叫/u);
	assert.match(instruction, /重力度但不咆哮/u);
	assert.match(instruction, /略尖锐/u);
	assert.match(instruction, /坚定/u);
	assert.match(instruction, /近落泪/u);
	assert.match(instruction, /不尖叫/u);
	assert.match(instruction, /<\|endofprompt\|>$/u);
});

test('宝玉疑心心理旁白在 Edge 基础规则上放慢并压沉', () => {
	const block = {
		blockId: '081-b0049',
		text: '宝玉疑心袭人，心里如被冰水浇透。',
		textHash: sha256('宝玉疑心袭人，心里如被冰水浇透。'),
	};
	const annotation = {
		textHash: block.textHash,
		contextHash: 'context',
		speakerRef: '$narrator',
		emotion: { family: 'fear', variant: 'tense-observation', intensity: 2 },
		pace: 'medium',
		pitch: 'low',
		energy: 'medium',
		timbre: ['breathy', 'clear'],
		modifiers: [],
		reviewStatus: 'ai-reviewed',
	};
	const cards = {
		narrator: {
			id: 'narrator',
			provider: 'edge',
			voice: 'zh-CN-YunjianNeural',
			prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
			emotions: { fear: { rate: '-3%', pitch: '+0Hz' }, neutral: {} },
		},
	};
	const plan = resolveSceneNarratorPlan({
		block,
		annotation,
		config: { narratorProfiles: { narrator: { voiceCardId: 'narrator' } } },
		cards,
	});
	assert.ok(Number.parseInt(plan.spec.rate, 10) <= -13);
	assert.ok(Number.parseInt(plan.spec.pitch, 10) <= -6);
	assert.ok(Number.parseInt(plan.spec.volume, 10) <= -4);
});

test('renderHash 响应正文、标注、音色卡、提示文本和参数变化', () => {
	const base = {
		textHash: 'text-a',
		annotationHash: 'annotation-a',
		voiceCardId: 'xiren',
		voiceCardFileHash: 'file-a',
		voiceCardText: '准确文本',
		provider: 'cosyvoice',
		modelVersion: 'CosyVoice2-0.5B',
		prosodyOrInstruction: '情绪指令',
		renderParameters: { speed: 1, maxTokenTextRatio: 12 },
	};
	const original = sceneFragmentRenderHash(base);
	for (const [field, value] of Object.entries({
		textHash: 'text-b',
		annotationHash: 'annotation-b',
		voiceCardId: 'jia-baoyu',
		voiceCardFileHash: 'file-b',
		voiceCardText: '另一准确文本',
		provider: 'edge',
		modelVersion: 'other-model',
		prosodyOrInstruction: '另一指令',
	})) {
		assert.notEqual(sceneFragmentRenderHash({ ...base, [field]: value }), original, field);
	}
	assert.notEqual(sceneFragmentRenderHash({ ...base, renderParameters: { ...base.renderParameters, speed: 1.1 } }), original);
});

test('原子替换失败会恢复旧缓存内容', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'hlm-scene-atomic-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const destination = join(directory, 'fragment.wav');
	await writeFile(destination, 'old-cache');
	await assert.rejects(() => replaceFileAtomic(join(directory, 'missing.tmp'), destination));
	assert.equal(await readFile(destination, 'utf8'), 'old-cache');
});

test('场景输出目录固定在本地 cache，不会进入 public/audio', () => {
	const output = sceneOutputDirectory(projectRoot, '081', 'xiren-three-opera');
	assert.match(output.replaceAll('\\', '/'), /content\/audio\/\.cache\/drama\/081\/xiren-three-opera$/u);
	assert.doesNotMatch(output.replaceAll('\\', '/'), /public\/audio/u);
});
