import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { compileChapter } from '../../src/lib/chapters/compiler.ts';
import {
	injectVoiceSentinels,
	loadAnnotatedAudioPlan,
	resolveVoiceSegments,
	speechSegmentsFromMarkedChapter,
} from '../../scripts/audio/audio-script.js';
import {
	chapterToSpeechText,
	normalizeLegacyNoteMarkers,
	stripFrontmatter,
} from '../../scripts/audio/chapter-text.js';
import { inspectMp3Buffer } from '../../scripts/audio/mp3.js';
import { splitSpeechText } from '../../scripts/audio/text-chunks.js';
import { EdgeTtsProvider } from '../../scripts/audio/tts/providers/edge.js';

test('移除 frontmatter，并报告未闭合的 frontmatter', () => {
	assert.equal(
		stripFrontmatter('---\norder: 81\n---\n[T]题\n正文'),
		'[T]题\n正文',
	);
	assert.equal(stripFrontmatter('[T]题\n正文'), '[T]题\n正文');
	assert.throws(() => stripFrontmatter('---\norder: 81\n[T]题'), /frontmatter 未闭合/);
});

test('朗读文本只保留标题、正文、普通诗词、长赋和加粗内容', () => {
	const source = normalizeLegacyNoteMarkers(`[T]第八十一回
正文甲[zp]脂批[zpsc]脂批诗[-][-]正文乙
[mp]书批[-]
[sc]普通诗一
普通诗二[-]
[fu]长赋正文[-]
正文[B]重点[-][wz1]尾注[zp]尾注中的脂批[-][-]
[B]正文丙[-]【夹批：未使用标准标记的编辑批语】正文丁
[img]插图.png
不朗读图注[-]`);
	const compiled = compileChapter(source, { sourceName: 'audio-test.md' });
	const speech = chapterToSpeechText(compiled);

	assert.match(speech, /第八十一回/);
	assert.match(speech, /正文甲正文乙/);
	assert.match(speech, /普通诗一\n普通诗二/);
	assert.match(speech, /长赋正文/);
	assert.match(speech, /重点/);
	assert.match(speech, /正文丙正文丁/);
	assert.doesNotMatch(speech, /脂批|书批|尾注|图注|插图|编辑批语/);
	assert.doesNotMatch(speech, /\[(?:zp|mp|sc|fu|B|T|wz|img|-)\]/u);
});

test('长文本优先按中文句读切分且不超过限制', () => {
	const text = '甲'.repeat(25) + '。' + '乙'.repeat(25) + '，' + '丙'.repeat(25) + '。';
	const chunks = splitSpeechText(text, 30);

	assert.ok(chunks.length >= 3);
	assert.ok(chunks.every((chunk) => chunk.length <= 30));
	assert.equal(chunks.join(''), text);
});

test('MP3 探测器验证完整音频帧并计算时长', () => {
	const frameLength = 144;
	const audio = Buffer.alloc(frameLength * 2);
	for (const offset of [0, frameLength]) {
		audio.set([0xff, 0xf3, 0x64, 0xc4], offset);
	}
	const info = inspectMp3Buffer(audio);

	assert.equal(info.frames, 2);
	assert.equal(info.sampleRate, 24_000);
	assert.equal(info.bitrateKbps, 48);
	assert.equal(info.channels, 1);
	assert.equal(info.durationSeconds, 0.048);
	assert.throws(() => inspectMp3Buffer(Buffer.from('not mp3')), /没有有效/);
});

test('派生音频脚本移除 voice 标记后保持原文并生成角色分段', () => {
	const canonical = `[T]第八十一回
旁白道：“我很难过，[B]但仍要说。[-]”
[zp]脂批[-]
[sc]诗句一
诗句二[-]`;
	const annotated = `[T]第八十一回
旁白道：[voice:jia-baoyu|sad]“我很难过，[B]但仍要说。[-]”[-]
[zp]脂批[-]
[sc]诗句一
诗句二[-]`;
	const injected = injectVoiceSentinels(annotated);
	assert.equal(injected.canonicalSource, canonical);

	const compiled = compileChapter(injected.markedSource, { sourceName: '081.audio.md' });
	const plan = speechSegmentsFromMarkedChapter(compiled, injected.markers, 'narrator');
	assert.equal(plan.segments.length, 3);
	assert.equal(plan.segments[0].voiceCardId, 'narrator');
	assert.equal(plan.segments[1].voiceCardId, 'jia-baoyu');
	assert.equal(plan.segments[1].emotion, 'sad');
	assert.match(plan.segments[1].text, /我很难过，.*但仍要说/u);
	assert.doesNotMatch(plan.speechText, /脂批|voice/u);
	assert.match(plan.speechText, /诗句一\n诗句二/u);
});

test('音色卡情感覆盖基础韵律并报告缺失卡片', () => {
	const cards = {
		narrator: {
			provider: 'edge',
			voice: 'zh-CN-XiaoxiaoNeural',
			prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' },
			emotions: { neutral: {} },
		},
		'jia-baoyu': {
			provider: 'edge',
			voice: 'zh-CN-YunxiNeural',
			prosody: { rate: '+2%', pitch: '+1Hz', volume: '+0%' },
			emotions: { sad: { rate: '-10%', pitch: '-2Hz' } },
		},
	};
	const [segment] = resolveVoiceSegments([
		{ text: '台词', voiceCardId: 'jia-baoyu', emotion: 'sad' },
	], cards);
	assert.equal(segment.voice, 'zh-CN-YunxiNeural');
	assert.equal(segment.rate, '-10%');
	assert.equal(segment.pitch, '-2Hz');
	assert.equal(segment.volume, '+0%');
	assert.throws(
		() => resolveVoiceSegments([{ text: '台词', voiceCardId: 'missing', emotion: 'neutral' }], cards),
		/缺少音色卡：missing/u,
	);
});

test('音频脚本拒绝非法情感、嵌套 voice 和批语内 voice', () => {
	assert.throws(
		() => injectVoiceSentinels('[voice:jia-baoyu|wild]台词[-]'),
		/情感“wild”/u,
	);
	assert.throws(
		() => injectVoiceSentinels('[voice:jia-baoyu|sad]甲[voice:narrator|neutral]乙[-][-]'),
		/嵌套/u,
	);
	const injected = injectVoiceSentinels('[T]题\n[zp][voice:narrator|neutral]批语[-][-]');
	const compiled = compileChapter(injected.markedSource, { sourceName: 'omitted.audio.md' });
	assert.throws(
		() => speechSegmentsFromMarkedChapter(compiled, injected.markers, 'narrator'),
		/不朗读内容/u,
	);
});

test('完整加载派生 Markdown、原章节哈希和音色卡目录', async (context) => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'hlm-audio-script-'));
	context.after(() => rm(projectRoot, { recursive: true, force: true }));
	const chapterDirectory = join(projectRoot, 'content', 'chapters', 'guiyou');
	const cardDirectory = join(projectRoot, 'content', 'audio', 'voice-cards');
	const audioScriptDirectory = join(projectRoot, 'content', 'audio', 'chapters');
	await Promise.all([
		mkdir(chapterDirectory, { recursive: true }),
		mkdir(cardDirectory, { recursive: true }),
		mkdir(audioScriptDirectory, { recursive: true }),
	]);

	const chapterPath = join(chapterDirectory, '081-测试.md');
	const canonicalBody = '[T]第八十一回\n旁白道：“开场。”\n正文。';
	const rawChapterSource = `---\norder: 81\n---\n${canonicalBody}`;
	const sourceHash = createHash('sha256').update(rawChapterSource, 'utf8').digest('hex');
	const annotatedBody = '[T]第八十一回\n旁白道：[voice:jia-baoyu|warm]“开场。”[-]\n正文。';
	await writeFile(chapterPath, rawChapterSource, 'utf8');
	await writeFile(
		join(audioScriptDirectory, '081.audio.md'),
		`---\nversion: 1\nchapter: 81\nsource: content/chapters/guiyou/081-测试.md\nsourceHash: ${sourceHash}\ndefaultVoice: narrator\n---\n${annotatedBody}`,
		'utf8',
	);
	await writeFile(
		join(cardDirectory, 'index.json'),
		JSON.stringify({ version: 1, defaultNarrator: 'narrator', cards: {
			narrator: 'narrator.json',
			'jia-baoyu': 'jia-baoyu.json',
		} }),
		'utf8',
	);
	await Promise.all([
		writeFile(join(cardDirectory, 'narrator.json'), JSON.stringify({
			version: 1, id: 'narrator', provider: 'edge', voice: 'zh-CN-XiaoxiaoNeural',
			prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' }, emotions: { neutral: {} },
		}), 'utf8'),
		writeFile(join(cardDirectory, 'jia-baoyu.json'), JSON.stringify({
			version: 1, id: 'jia-baoyu', provider: 'edge', voice: 'zh-CN-YunxiNeural',
			prosody: { rate: '+0%', pitch: '+0Hz', volume: '+0%' }, emotions: { warm: { rate: '-2%' } },
		}), 'utf8'),
	]);

	const plan = await loadAnnotatedAudioPlan({
		projectRoot,
		chapterId: '081',
		chapterPath,
		rawChapterSource,
	});
	assert.ok(plan);
	assert.deepEqual(plan.voiceCardIds, ['jia-baoyu', 'narrator']);
	assert.equal(plan.segments[1].voiceCardId, 'jia-baoyu');
	assert.equal(plan.segments[1].rate, '-2%');
	assert.equal(plan.speechText, '第八十一回\n旁白道：“开场。”\n正文。');

	await assert.rejects(
		loadAnnotatedAudioPlan({
			projectRoot,
			chapterId: '081',
			chapterPath,
			rawChapterSource: `${rawChapterSource}\n已修改`,
		}),
		/sourceHash 已过期/u,
	);
});

test('Edge provider 将多音色段落继续按句读拆分并保留声音配置', () => {
	const provider = new EdgeTtsProvider({ maxChunkChars: 20 });
	const units = provider.createSynthesisUnits(undefined, [
		{
			text: `${'甲'.repeat(18)}。${'乙'.repeat(18)}。`,
			voiceCardId: 'jia-baoyu',
			emotion: 'sad',
			voice: 'zh-CN-YunxiNeural',
			rate: '-10%',
			pitch: '-2Hz',
			volume: '+0%',
		},
	]);
	assert.equal(units.length, 2);
	assert.ok(units.every((unit) => unit.text.length <= 20));
	assert.ok(units.every((unit) => unit.voice === 'zh-CN-YunxiNeural'));
	assert.ok(units.every((unit) => unit.voiceCardId === 'jia-baoyu'));
	assert.throws(
		() => provider.createSynthesisUnits('正文', [{ text: '台词' }]),
		/不能同时提供/u,
	);
});
