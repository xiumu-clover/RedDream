import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildExcerptTargets, buildSectionTargets, canReuseLegacy, resolveApprovedAssembly, resolveReviewSceneSources, selectSectionBlocks, synthesisSpec, verifiedReferences, withCurrentAssemblySettings } from '../../scripts/audio/generate_doubao_section.js';
import { hashJson } from '../../scripts/audio/audio-blocks.js';
import { limitPcmSilence, stretchInternalPcmSilence, splicePcmSuffix, trimPcmTail } from '../../scripts/audio/wav-silence.js';

const root = resolve(import.meta.dirname, '..', '..');

test('第81回第一节按当前正文锚点完整截取，不受旧 blockId 顺序影响', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const blocks = selectSectionBlocks(pending.blocks, sections.sections[0]);
	assert.equal(blocks.length, 23);
	assert.match(blocks[0].text, /^第八十一回/u);
	assert.match(blocks.at(-1)!.text, /仍到炕上闭目歇息。$/u);
	assert.equal(blocks.some((item: { text: string }) => item.text.includes('怡红院，将到门首')), false);
	const shifted = blocks.map((item: { text: string }, index: number) => ({ ...item, blockId: `shifted-${index}` }));
	assert.deepEqual(selectSectionBlocks(shifted, sections.sections[0]).map((item: { text: string }) => item.text), blocks.map((item: { text: string }) => item.text));
});

test('锚点重复或丢失时停止，不静默截错剧情', () => {
	assert.throws(() => selectSectionBlocks([{ text: '开头' }, { text: '开头' }, { text: '结尾' }], {
		startAnchor: '开头', endAnchor: '结尾',
	}), /不唯一/u);
	assert.throws(() => selectSectionBlocks([{ text: '结尾' }, { text: '开头' }], {
		startAnchor: '开头', endAnchor: '结尾',
	}), /顺序错误/u);
});

test('合成哈希响应正文、标注、音色卡、提示文本和参数变化', () => {
	const target = {
		targetId: 'dialogue:081-b0007:u01', blockTextHash: 'block', text: '好兄弟，别为我伤心。',
		synthesisText: '好兄弟，别为我伤心。', annotationHash: 'annotation', speakerRef: 'jia-yingchun',
		reference: { id: 'yingchun:v1', path: 'content/audio/.cache/card.wav', fileHash: 'card', text: '卡片准确文本。' },
		instruction: '克制而温柔。', providerOverride: null,
	};
	const provider = { provider: 'doubao', audioGenerationApi: { model: 'seed-audio-1.0', requestVersion: 'v1' }, audio: { format: 'wav', sampleRate: 24000 } };
	const base = hashJson(synthesisSpec(target, provider, 'split-v1'));
	for (const changed of [
		{ ...target, text: '好兄弟，别再伤心。' },
		{ ...target, annotationHash: 'changed' },
		{ ...target, reference: { ...target.reference, fileHash: 'changed' } },
		{ ...target, reference: { ...target.reference, text: '改过的卡片文本。' } },
		{ ...target, instruction: '更急切。' },
		{ ...target, performanceReference: { id: 'delivery', path: 'delivery.wav', fileHash: 'a'.repeat(64) } },
	]) assert.notEqual(hashJson(synthesisSpec(changed, provider, 'split-v1')), base);
	assert.notEqual(hashJson(synthesisSpec(target, provider, 'split-v2')), base);
	assert.notEqual(hashJson(synthesisSpec(target, { ...provider, audio: { ...provider.audio, sampleRate: 16000 } }, 'split-v1')), base);
});

test('旧片段只有同文、同标注、同人物卡和同指令才可复用', () => {
	const old = {
		targetId: 'a', text: '你好', synthesisText: '你好', annotationHash: 'ann', instruction: '轻声',
		reference: { id: 'card', fileHash: 'hash' },
	};
	const current = { ...old, reference: { ...old.reference, path: 'card.wav' } };
	const fragment = { targetId: 'a', text: '你好', synthesisText: '你好', annotationHash: 'ann',
		referenceId: 'card', referenceFileHash: 'hash', subtitleExact: true, fileHash: 'file', path: 'fragment.wav' };
	assert.equal(canReuseLegacy(current, old, fragment), true);
	assert.equal(canReuseLegacy({ ...current, reference: { ...current.reference, fileHash: 'new' } }, old, fragment), false);
	assert.equal(canReuseLegacy({ ...current, instruction: '愤怒' }, old, fragment), false);
	assert.equal(canReuseLegacy({ ...current, providerOverride: { retryVersion: 2 } }, old, fragment), false);
	assert.equal(canReuseLegacy({ ...current, performanceReference: { id: 'delivery', path: 'delivery.wav', fileHash: 'a'.repeat(64) } }, old, fragment), false);
	assert.equal(canReuseLegacy(current, old, { ...fragment, subtitleExact: false }), false);
});

test('缓存音色仍采用当前小样的拼接停顿，而非旧缓存中的停顿', () => {
	const cached = { pauseAfterMs: 85, assemblyGainDb: 0, normalizationMode: null, fileHash: 'same-audio' };
	const current = { pauseAfterMs: 220, assemblyGainDb: 1, normalizationMode: 'short-safe-peak-v1' };
	assert.deepEqual(withCurrentAssemblySettings(cached, current), { ...cached, ...current });
	assert.equal(cached.pauseAfterMs, 85);
});

test('第一节重新读取当前标注的读音、强制单元、问句语气和停顿', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const section = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8')).sections[0];
	const references = Object.fromEntries(['$narrator', ...Object.keys(section.voiceCards)]
		.map((speaker) => [speaker, { id: section.voiceCards[speaker]?.id || 'narrator', path: 'card.wav', fileHash: 'hash', text: '准确文本' }]));
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const byId = new Map(targets.map((target: { targetId: string }) => [target.targetId, target]));
	assert.match(byId.get('narration:081-b0001:u01').synthesisText, /会吃罚，丫鬟结恶党/u);
	assert.doesNotMatch(byId.get('narration:081-b0004:u01').synthesisText, /多言，只得/u);
	assert.equal(byId.get('narration:081-b0012:u01').providerOverride.promptMode, 'strict-text');
	assert.equal(byId.get('narration:081-b0012:u01').normalizationMode, 'short-safe-peak-v1');
	assert.equal(byId.get('narration:081-b0010:u01').normalizationMode, 'short-safe-peak-v1');
	assert.match(byId.get('dialogue:081-b0016:u01').instruction, /句尾微微上扬/u);
	assert.equal(document.annotations['081-b0016'].emotion.family, 'sadness');
	assert.match(byId.get('dialogue:081-b0016:u01').instruction, /难过和担忧/u);
	assert.equal(document.annotations['081-b0018'].emotion.intensity, 3);
	assert.equal(document.annotations['081-b0018'].pace, 'fast');
	assert.match(byId.get('dialogue:081-b0018:u01').instruction, /明显难过.*中速略快/u);
	assert.equal(document.annotations['081-b0244'].emotion.intensity, 3);
	assert.match(byId.get('dialogue:081-b0244:u01').instruction, /明显难过.*中速略快/u);
	assert.match(byId.get('dialogue:081-b0018:u04').instruction, /反要受.*fǎn yào shòu/u);
	assert.equal(document.annotationSetHash, hashJson(document.annotations));
	assert.equal(byId.get('dialogue:081-b0007:u01').reference.id, 'xiangling:calm-poetry-talk-v1');
	assert.equal(byId.get('dialogue:081-b0005:u01').pauseAfterMs, 0);
	assert.equal(byId.get('narration:081-b0010:u01').pauseAfterMs, 80);
	for (const index of [1, 2, 3]) assert.equal(byId.get(`dialogue:081-b0018:u0${index}`).pauseAfterMs, 85);
	assert.equal(targets.map((target: { text: string }) => target.text).join(''), selectSectionBlocks(pending.blocks, section).map((block: { text: string }) => block.text).join(''));
});

test('第一节人物路由没有 Edge 回退，也不配置公开输出', async () => {
	const config = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const section = config.sections[0];
	assert.deepEqual(Object.keys(section.voiceCards).sort(), ['jia-baoyu', 'jia-yingchun', 'lady-wang', 'lin-daiyu']);
	for (const card of Object.values(section.voiceCards) as Array<{ path: string }>) {
		assert.match(card.path, /\.wav$/u);
		assert.doesNotMatch(card.path, /legacy-edge|public\/audio/u);
	}
	assert.doesNotMatch(JSON.stringify(section), /public\/audio/u);
});

test('王夫人 delivery 卡只获本节草稿选用，不能冒充全局批准', async () => {
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const decisions = JSON.parse(await readFile(join(root, 'content/audio/.cache/voice-cards/review-decisions.json'), 'utf8'));
	const section = sections.sections[0];
	const card = section.voiceCards['lady-wang'];
	assert.equal(card.localDraftSelection.scope, '081:01:draft');
	assert.match(card.path, /lady-wang\/measured-consultation-v2\/voice-card-delivery\.wav$/u);
	const references = await verifiedReferences(section, decisions);
	assert.equal(references['lady-wang'].fileHash, card.localDraftSelection.fileHash);
	assert.equal(references['lady-wang'].approvalId, null);
	assert.equal(references['lady-wang'].selectionStatus, 'user-selected-local-draft');
	await assert.rejects(() => verifiedReferences({ ...section, id: '02' }, decisions), /本节草稿选卡记录/u);
});

test('对白小样只压缩静音，不吞掉两侧有声采样', () => {
	const sampleRate = 24000;
	const lengths = [500, 500, 2000, 500, 500];
	const total = lengths.reduce((sum, value) => sum + value, 0) * 24;
	const wav = Buffer.alloc(44 + total * 2);
	wav.write('RIFF', 0, 'ascii');
	wav.writeUInt32LE(wav.length - 8, 4);
	wav.write('WAVEfmt ', 8, 'ascii');
	wav.writeUInt32LE(16, 16);
	wav.writeUInt16LE(1, 20);
	wav.writeUInt16LE(1, 22);
	wav.writeUInt32LE(sampleRate, 24);
	wav.writeUInt32LE(sampleRate * 2, 28);
	wav.writeUInt16LE(2, 32);
	wav.writeUInt16LE(16, 34);
	wav.write('data', 36, 'ascii');
	wav.writeUInt32LE(total * 2, 40);
	let offset = 44;
	for (const [index, length] of lengths.entries()) {
		for (let sample = 0; sample < length * 24; sample += 1) {
			wav.writeInt16LE(index % 2 ? 5000 : 0, offset);
			offset += 2;
		}
	}
	const result = limitPcmSilence(wav, { leadingMs: 70, trailingMs: 70, internalMs: 260 });
	assert.equal(result.wav.readUInt32LE(40) / 2 / sampleRate, 1.4);
	assert.deepEqual(result.cuts.map((cut: { kind: string }) => cut.kind), ['leading', 'internal', 'trailing']);
	let voiced = 0;
	for (let index = 44; index < result.wav.length; index += 2) if (result.wav.readInt16LE(index) === 5000) voiced += 1;
	assert.equal(voiced, sampleRate);
	const stretched = stretchInternalPcmSilence(result.wav, [320]);
	assert.equal(stretched.wav.readUInt32LE(40) / 2 / sampleRate, 1.46);
	assert.equal(stretched.additions[0].addedMs, 60);
	let stretchedVoiced = 0;
	for (let index = 44; index < stretched.wav.length; index += 2) if (stretched.wav.readInt16LE(index) === 5000) stretchedVoiced += 1;
	assert.equal(stretchedVoiced, sampleRate);
	const replacement = Buffer.from(stretched.wav);
	for (let index = 44; index < replacement.length; index += 2) {
		if (replacement.readInt16LE(index) === 5000) replacement.writeInt16LE(6000, index);
	}
	const spliceSpec = { prefixGapIndex: 0, replacementGapIndex: 0, expectedPrefixGapCount: 1, expectedReplacementGapCount: 1 };
	const repaired = splicePcmSuffix(stretched.wav, replacement, spliceSpec);
	let oldSamples = 0;
	let newSamples = 0;
	for (let index = 44; index < repaired.wav.length; index += 2) {
		if (repaired.wav.readInt16LE(index) === 5000) oldSamples += 1;
		if (repaired.wav.readInt16LE(index) === 6000) newSamples += 1;
	}
	assert.equal(oldSamples, sampleRate / 2);
	assert.equal(newSamples, sampleRate / 2);
	assert.equal(repaired.splice.joinSilenceMs, 320);
	assert.throws(() => splicePcmSuffix(stretched.wav, replacement, { ...spliceSpec, expectedPrefixGapCount: 2 }), /静音锚点不符/u);
	const trimmed = trimPcmTail(stretched.wav, 1.2, 80);
	assert.equal(trimmed.wav.readUInt32LE(40) / 2 / sampleRate, 1.2);
	assert.equal(trimmed.wav.readInt16LE(trimmed.wav.length - 2), 0);
	assert.equal(Math.round(trimmed.repair.removedMs), 260);
	assert.throws(() => limitPcmSilence(Buffer.alloc(44)), /RIFF/u);
});

test('宝玉停顿小样保持正文顺序和逗号，且不改变整节目标', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const section = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8')).sections[0];
	const references = Object.fromEntries(['$narrator', ...Object.keys(section.voiceCards)]
		.map((speaker) => [speaker, { id: speaker, path: 'card.wav', fileHash: 'hash', text: '准确文本' }]));
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const original = targets.find((target: { targetId: string }) => target.targetId === 'dialogue:081-b0018:u01');
	const preview = buildExcerptTargets(targets, 'baoyu-farewell-pause-v1', section.excerpts['baoyu-farewell-pause-v1']);
	assert.equal(preview.length, 7);
	assert.deepEqual(preview.map((target: { targetId: string }) => target.targetId), section.excerpts['baoyu-farewell-pause-v1'].targetIds);
	assert.equal(preview[1].synthesisText, '你也知道，二姐姐受的罪不少。');
	assert.equal(preview.at(-1).synthesisText, '怎么女儿家的命，就这样苦。');
	assert.equal(preview[4].providerOverride.retryVersion, 5);
	assert.match(preview[4].instruction, /难过而克制/u);
	assert.doesNotMatch(preview[4].instruction, /中速略快/u);
	const unchangedProfile = structuredClone(section.excerpts['baoyu-farewell-pause-v1']);
	delete unchangedProfile.targetOverrides;
	const previous = buildExcerptTargets(targets, 'baoyu-farewell-pause-v1', unchangedProfile);
	for (const index of [0, 1, 2, 3, 5, 6]) {
		assert.deepEqual(synthesisSpec(preview[index], provider, preview[index].splitVersion),
			synthesisSpec(previous[index], provider, previous[index].splitVersion));
	}
	assert.notDeepEqual(synthesisSpec(preview[4], provider, preview[4].splitVersion),
		synthesisSpec(previous[4], provider, previous[4].splitVersion));
	assert.equal(original.synthesisText, '你也知道二姐姐受的罪不少。');
	assert.equal(preview[1].pauseAfterMs, 520);
	assert.equal(preview[2].pauseAfterMs, 600);
	assert.equal(section.excerpts['baoyu-farewell-pause-v1'].tempoFactor, 0.94);
	assert.throws(() => buildExcerptTargets(targets, 'bad', { targetIds: [...section.excerpts['baoyu-farewell-pause-v1'].targetIds].reverse() }), /不按正文顺序/u);
});

test('第一节只合入两项获批宝玉改动，保留原黛玉片段', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const section = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8')).sections[0];
	const references = Object.fromEntries(['$narrator', ...Object.keys(section.voiceCards)]
		.map((speaker) => [speaker, { id: speaker, path: 'card.wav', fileHash: 'hash', text: '准确文本' }]));
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const approved = await resolveApprovedAssembly(targets, section);
	assert.equal(approved.sourceByTarget.size, 1);
	assert.equal(approved.groupByFirst.size, 1);
	assert.equal(approved.coveredTargetIds.size, 8);
	assert.equal(approved.coveredTargetIds.has('dialogue:081-b0005:u01'), true);
	assert.equal(approved.coveredTargetIds.has('dialogue:081-b0016:u01'), false);
	assert.equal(approved.sourceByTarget.get('dialogue:081-b0005:u01').fileHash,
		'6399a6f189fc6fe0416de131c6661f67db9d954a91d1f8be69e17de268f69067');
	assert.equal(approved.groupByFirst.get('narration:081-b0010:u01').fileHash,
		'43f02601ed03b872715833a0e43d3ddfc6c8697a93a9c3b905e93dafcea2b543');
	const broken = structuredClone(section);
	broken.approvedAssembly.groupOverrides[0].bindings[1].textHash = '0'.repeat(64);
	await assert.rejects(() => resolveApprovedAssembly(targets, broken), /正文或标注不一致/u);
});

test('第二节按剧情阶段切换主角多风格卡，群声仍为单一代表声', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const section = sections.sections[1];
	const decisions = JSON.parse(await readFile(join(root, 'content/audio/.cache/voice-cards/review-decisions.json'), 'utf8'));
	const references = await verifiedReferences(section, decisions);
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const byBlock = (blockId: string) => targets.filter((item: { blockId: string }) => item.blockId === blockId);
	assert.equal(byBlock('081-b0030')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0076')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0083')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0097')[0].reference.id, 'jia-baoyu:daily');
	assert.equal(byBlock('081-b0071')[0].reference.id, 'xiren:assertive-rivalry');
	assert.equal(byBlock('081-b0090')[0].reference.id, 'xiren:assertive-rivalry');
	assert.equal(byBlock('081-b0254')[0].speakerRef, 'dou-guan');
	assert.equal(byBlock('081-b0254')[0].reference.id, 'dou-guan');
	assert.equal(byBlock('081-b0052')[0].normalizationMode, 'short-safe-peak-v1');
	assert.equal(byBlock('081-b0052')[0].providerOverride.promptMode, 'strict-text');
	assert.equal(byBlock('081-b0105')[0].providerOverride.promptMode, 'strict-text');
	assert.equal(section.excerpts['review-round1-daiyu-release-v1'].performanceReference.sameSpeaker, true);
	const pronunciationPreview = buildExcerptTargets(targets, 'review-round3-baoyu-chunyan-v3',
		section.excerpts['review-round3-baoyu-chunyan-v3']);
	assert.equal(pronunciationPreview[0].text, '春燕是我差出去了。等人到齐，叫她们候着，我回来有话说。');
	assert.equal(pronunciationPreview[0].synthesisText, '春燕是我拆出去了。等人到齐，叫她们候着，我回来有话说。');
	assert.equal(byBlock('081-b0079')[0].reference.id, 'young-maids-pool:chunyan-proxy');
	assert.equal(sections.sectionApprovals[0].sectionId, '01');
	assert.equal(sections.sectionApprovals[0].binding.mp3FileHash,
		'a5acbe654fbeda5dc33e7837340fb0313a2d29d2fb29914ecbd63eea234848c5');
	const reviewPlan = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/plan.json'), 'utf8'));
	const reviewSources = await resolveReviewSceneSources(targets, reviewPlan);
	assert.equal(reviewSources.size, 48);
	assert.equal(reviewSources.has('dialogue:081-b0028:u01'), true);
	assert.equal(reviewSources.has('dialogue:081-b0074:u01'), false);
});
