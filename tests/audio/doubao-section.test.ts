import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { approvedArtifactText, buildExcerptTargets, buildSectionTargets, canReuseLegacy, resolveApprovedAssembly, resolveReviewSceneSources, selectSectionBlocks, shouldConditionArtifact, synthesisSpec, verifiedReferences, withCurrentAssemblySettings } from '../../scripts/audio/generate_doubao_section.js';
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
test('已批准且要求保留的音频跳过片段静音修整', () => {
	const conditioning = { silencePolicy: { leadingMs: 60, trailingMs: 70 } };
	assert.equal(shouldConditionArtifact({ cacheType: 'section' }, conditioning), true);
	assert.equal(shouldConditionArtifact({ approvedAssembly: { preserveReviewedAudio: false } }, conditioning), true);
	assert.equal(shouldConditionArtifact({ approvedAssembly: { preserveReviewedAudio: true } }, conditioning), false);
	assert.equal(shouldConditionArtifact({ cacheType: 'section' }, null), false);
});
test('获批口语化入片分别保留正文和实际配音文本', () => {
	const target = { synthesisText: '我的儿' };
	assert.deepEqual(approvedArtifactText(target, {}), { synthesisText: '我的儿', subtitleText: '我的儿' });
	assert.deepEqual(approvedArtifactText(target, { synthesisText: '我的儿啊！' }),
		{ synthesisText: '我的儿啊！', subtitleText: '我的儿啊！' });
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

test('第一节合入获批宝玉改动并保留原黛玉片段', async () => {
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
		'e88498bd7ae9ae998620ad6a0d213b46937c779daa7f1e3e3e55ac6655a2b52f');
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
	// 禁用的旧备用卡必须拦截；以下路由回归仅使用移除该备用卡的内存副本，不改81回配置。
	await assert.rejects(() => verifiedReferences(section, decisions), /jia-baoyu:daily.*没有绑定|声卡已被用户禁用/u);
	const activeSection = structuredClone(section);
	delete activeSection.voiceCards['jia-baoyu:daily'];
	const references = await verifiedReferences(activeSection, decisions);
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const byBlock = (blockId: string) => targets.filter((item: { blockId: string }) => item.blockId === blockId);
	assert.equal(byBlock('081-b0030')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0076')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0083')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0097')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0071')[0].reference.id, 'xiren:assertive-rivalry');
	assert.equal(byBlock('081-b0090')[0].reference.id, 'xiren:assertive-rivalry');
	assert.equal(byBlock('081-b0254')[0].speakerRef, 'dou-guan');
	assert.equal(byBlock('081-b0254')[0].reference.id, 'dou-guan');
	assert.equal(byBlock('081-b0052')[0].normalizationMode, 'short-safe-peak-v1');
	assert.equal(byBlock('081-b0052')[0].providerOverride.promptMode, 'strict-text');
	assert.equal(byBlock('081-b0105')[0].providerOverride.promptMode, 'strict-text');
	assert.equal(byBlock('081-b0247')[1].text,
		'偏太太不许我去瞧，叫人怎么样呢？芳官她们如今可好？');
	assert.equal(byBlock('081-b0247')[1].providerOverride.retryVersion, 1);
	assert.match(byBlock('081-b0247')[1].instruction, /芳官她们如今可好/u);
	assert.equal(byBlock('081-b0248')[2].providerOverride.retryVersion, 3);
	assert.match(byBlock('081-b0248')[2].instruction, /语速中等偏慢/u);
	assert.match(byBlock('081-b0248')[2].instruction, /严禁添加任何字音/u);
	assert.equal(byBlock('081-b0046')[0].text, '正是，正是！只消这一句。你若说得出口，我们掉头就走。');
	assert.equal(byBlock('081-b0046')[0].speakerRef, 'dou-guan');
	assert.equal(byBlock('081-b0046')[0].providerOverride.retryVersion, 1);
	assert.equal(byBlock('081-b0028')[2].pauseAfterMs, 80);
	assert.equal(byBlock('081-b0247')[1].pauseAfterMs, 190);
	assert.equal(byBlock('081-b0248')[1].pauseAfterMs, 110);
	assert.equal(byBlock('081-b0060')[0].pauseAfterMs, 160);
	assert.equal(byBlock('081-b0061')[0].pauseAfterMs, 120);
	assert.equal(section.fragmentConditioning['narration:081-b0093:u01'].silencePolicy.internalMs, 260);
	assert.equal(section.excerpts['review-round1-daiyu-release-v1'].performanceReference.sameSpeaker, true);
	const pronunciationPreview = buildExcerptTargets(targets, 'review-round3-baoyu-chunyan-v3',
		section.excerpts['review-round3-baoyu-chunyan-v3']);
	assert.equal(pronunciationPreview[0].text, '春燕是我差出去了。等人到齐，叫她们候着，我回来有话说。');
	assert.equal(pronunciationPreview[0].synthesisText, '春燕是我拆出去了。等人到齐，叫她们候着，我回来有话说。');
	const partOne = buildExcerptTargets(targets, 'section-02-part-1-v1', section.excerpts['section-02-part-1-v1']);
	assert.equal(partOne.length, 78);
	assert.equal(byBlock('081-b0036').length, 3);
	assert.equal(byBlock('081-b0036')[2].text, '我们几个被各自干娘领了回去，日日被逼着说人家。');
	assert.equal(byBlock('081-b0036')[2].synthesisText, '我们几个被各自干娘领了回去，日日被逼着说人家。');
	assert.equal(byBlock('081-b0258').length, 2);
	assert.equal(partOne[0].targetId, 'narration:081-b0022:u01');
	assert.equal(partOne.at(-1).targetId, 'narration:081-b0072:u01');
	assert.equal(partOne.find((item: { targetId: string }) => item.targetId === 'dialogue:081-b0028:u01').pauseAfterMs, 90);
	assert.equal(partOne.find((item: { targetId: string }) => item.targetId === 'dialogue:081-b0248:u02').pauseAfterMs, 100);
	const partTwoProfile = section.excerpts['section-02-part-2-v1'];
	const partTwo = buildExcerptTargets(targets, 'section-02-part-2-v1', partTwoProfile);
	assert.equal(partTwo.length, 52);
	assert.equal(partTwo[0].targetId, 'narration:081-b0073:u01');
	assert.equal(partTwo.at(-1).targetId, 'narration:081-b0114:u01');
	assert.equal(partTwo.find((item: { targetId: string }) => item.targetId === 'dialogue:081-b0109:u02').pauseAfterMs, 80);
	assert.equal(partTwoProfile.temporaryPlaceholders[0].status, 'temporary-placeholder-not-approved');
	const partTwoApproved = await resolveApprovedAssembly(partTwo, { approvedAssembly: partTwoProfile.approvedAssembly });
	assert.equal(partTwoApproved.sourceByTarget.size, 5);
	assert.equal(partTwoApproved.groupByFirst.size, 1);
	assert.equal(partTwoApproved.coveredTargetIds.size, 11);
	assert.equal(partTwoApproved.sourceByTarget.get('narration:081-b0105:u01').assemblyGainDb, 20);
	assert.equal(partTwoApproved.groupByFirst.get('dialogue:081-b0090:u01').preserveReviewedAudio, true);
	const sectionApproved = await resolveApprovedAssembly(targets, section);
	assert.equal(sectionApproved.sourceByTarget.size, 5);
	assert.equal(sectionApproved.groupByFirst.size, 3);
	assert.equal(sectionApproved.coveredTargetIds.size, 21);
	assert.equal(sectionApproved.sourceByTarget.get('narration:081-b0039:u01').fileHash,
		'dcfd35e22c610e3f19bd3c93fab61caf5c87bb427948d5ed431df156ba59e2d6');
	assert.match(sectionApproved.sourceByTarget.get('narration:081-b0039:u01').reason, /前导都.*长静音.*荳官道/u);
	assert.equal(sectionApproved.groupByFirst.get('dialogue:081-b0090:u01').id,
		'xiren-household-light-approved-v3');
	assert.equal(sectionApproved.groupByFirst.get('dialogue:081-b0090:u01').preserveReviewedAudio, true);
	assert.equal(sectionApproved.groupByFirst.get('dialogue:081-b0248:u02').id,
		'baoyu-reassurance-original-base-slower-v9-approved');
	assert.deepEqual(sectionApproved.groupByFirst.get('dialogue:081-b0248:u02').targetIds,
		['dialogue:081-b0248:u02', 'dialogue:081-b0248:u03']);
	assert.equal(sectionApproved.groupByFirst.get('dialogue:081-b0248:u02').path,
		'content/audio/.cache/doubao/sections/081/02/excerpts/review-baoyu-reassurance-original-base-slower-v9/scene.wav');
	assert.equal(sectionApproved.groupByFirst.get('dialogue:081-b0248:u02').fileHash,
		'e4866aa548b5eae879438bbaebe18b6c35e3320aa0aca7b04b946ea637bfddba');
	assert.equal(section.excerpts['review-baoyu-reassurance-original-base-v7'].status,
		'superseded-by-user-approved-slower-v9');
	assert.equal(byBlock('081-b0079')[0].reference.id, 'young-maids-pool:chunyan-proxy');
	assert.equal(sections.sectionApprovals[0].sectionId, '01');
	assert.equal(sections.sectionApprovals[0].binding.mp3FileHash,
		'a5acbe654fbeda5dc33e7837340fb0313a2d29d2fb29914ecbd63eea234848c5');
	const reviewPlan = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/plan.json'), 'utf8'));
	const reviewSources = await resolveReviewSceneSources(targets, reviewPlan);
	assert.equal(reviewSources.size, 37);
	for (const targetId of [
		'dialogue:081-b0028:u05', 'dialogue:081-b0028:u07', 'dialogue:081-b0046:u01',
		'dialogue:081-b0249:u02', 'dialogue:081-b0257:u02', 'dialogue:081-b0059:u02', 'dialogue:081-b0061:u02',
	]) assert.equal(reviewSources.has(targetId), false);
	assert.equal(reviewSources.has('dialogue:081-b0036:u01'), false);
	assert.equal(reviewSources.has('dialogue:081-b0036:u02'), false);
	assert.equal(reviewSources.has('dialogue:081-b0028:u01'), true);
	assert.equal(reviewSources.has('dialogue:081-b0247:u01'), true);
	assert.equal(reviewSources.has('dialogue:081-b0247:u02'), false);
	assert.equal(reviewSources.has('dialogue:081-b0248:u03'), false);
	assert.equal(reviewSources.has('dialogue:081-b0074:u01'), false);
});

test('第三节使用当前获批路由，并统一使用用户指定的宝玉音色', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const section = sections.sections.find((item) => item.id === '03');
	const decisions = JSON.parse(await readFile(join(root, 'content/audio/.cache/voice-cards/review-decisions.json'), 'utf8'));
	const references = await verifiedReferences(section, decisions);
	const targets = buildSectionTargets({ blocks: selectSectionBlocks(pending.blocks, section),
		annotations: document.annotations, references, provider, section, segmenterVersion: pending.segmenterVersion });
	const byBlock = (blockId: string) => targets.filter((item: { blockId: string }) => item.blockId === blockId);
	assert.equal(references['jiang-yuhan'].approvalId, 'jiang-yuhan/natural-explanation-v2');
	assert.equal(references['jiang-yuhan'].fileHash, '1a6b5822379957aa6d55be6cfd815674f6e4a2e0396478f458c9fdb2a2f1d7f8');
	assert.equal(references['jiang-yuhan'].text, '这是茜香国女王进贡的物品，夏天系着，肌肤生香，不生汗渍。');
	assert.equal(references['jiang-yuhan'].assetKind, 'sourceReferenceMp3');
	assert.match(references['jiang-yuhan'].proxyNote, /原声参考 MP3/u);
	assert.equal(references['hua-zifang'].approvalId, 'jiang-yuhan/natural-explanation-v2');
	assert.equal(references['hua-zifang'].fileHash, '171f301580c98d531c08c3bc6425f0a5de35940a9312508ffc10159d600f5be7');
	assert.equal(references['hua-zifang'].text, '二爷放心，我既答应了，自然不会草率。');
	assert.match(references['hua-zifang'].proxyNote, /蒋玉菡本人原声.*代理/u);
	assert.equal(byBlock('081-b0265')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0143')[0].reference.id, 'jia-baoyu:restrained-sadness');
	assert.equal(byBlock('081-b0265')[0].reference.fileHash, byBlock('081-b0143')[0].reference.fileHash);
	assert.equal([...new Set(targets.filter((item: { speakerRef: string }) => item.speakerRef === 'jia-baoyu')
		.map((item: { reference: { id: string } }) => item.reference.id))].join(','), 'jia-baoyu:restrained-sadness');
	assert.equal(section.fragmentConditioning['narration:081-b0292:u01'].silencePolicy.minimumGapMs, 1000);
	assert.equal(section.fragmentConditioning['narration:081-b0292:u01'].silencePolicy.internalMs, 450);
	assert.deepEqual(section.fragmentConditioning['dialogue:081-b0279:u01'].tailRepair,
		{ endSeconds: 2.3, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['narration:081-b0122:u01'].tailRepair,
		{ endSeconds: 1.2, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['dialogue:081-b0281:u04'].tailRepair,
		{ endSeconds: 4.15, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['dialogue:081-b0285:u01'].tailRepair,
		{ endSeconds: 3.2, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['narration:081-b0266:u01'].tailRepair,
		{ endSeconds: 1.1, fadeOutMs: 30 });
	assert.equal(byBlock('081-b0138')[0].reference.id, 'xiren:assertive-rivalry');
	assert.equal(byBlock('081-b0291')[0].reference.id, 'lady-wang:measured-consultation-v2');
	assert.equal(byBlock('081-b0270')[0].providerOverride.promptMode, 'strict-text');
	assert.equal(targets.find((item: { targetId: string }) => item.targetId === 'narration:081-b0229:u01').pauseAfterMs, 80);
	assert.equal(sections.sectionApprovals.find((item) => item.sectionId === '02').binding.parts.length, 2);
});

test('第四节使用获批角色卡，未具名丫头和潘又安按审核结果独立路由', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const section = sections.sections.find((item) => item.id === '04');
	const decisions = JSON.parse(await readFile(join(root, 'content/audio/.cache/voice-cards/review-decisions.json'), 'utf8'));
	const references = await verifiedReferences(section, decisions);
	const blocks = selectSectionBlocks(pending.blocks, section);
	const targets = buildSectionTargets({ blocks, annotations: document.annotations, references, provider, section,
		segmenterVersion: pending.segmenterVersion });
	const byBlock = (blockId: string) => targets.filter((item: { blockId: string }) => item.blockId === blockId);
	assert.equal(blocks[0].blockId, '081-b0149');
	assert.equal(blocks.at(-1).blockId, '081-b0313');
	assert.equal(blocks.length, 43);
	assert.equal(targets.length, 52);
	assert.equal(byBlock('081-b0302')[0].speakerRef, 'young-maids-pool');
	assert.equal(byBlock('081-b0302')[0].voiceCardRoute, 'unnamed-young-maid');
	assert.equal(byBlock('081-b0302')[0].reference.id, 'unnamed-young-maid:chunyan-shared-v1');
	assert.notEqual(byBlock('081-b0302')[0].reference.fileHash, byBlock('081-b0173')[0].reference.fileHash);
	assert.equal(references['pan-youan'].approvalId, 'pan-youan/jiang-yuhan-natural-v2');
	assert.equal(references['pan-youan'].fileHash, '171f301580c98d531c08c3bc6425f0a5de35940a9312508ffc10159d600f5be7');
	assert.match(references['pan-youan'].proxyNote, /候选3.*蒋玉菡.*代理声/u);
	assert.equal(byBlock('081-b0305')[0].reference.id, 'pan-youan:jiang-yuhan-natural-v2-proxy-v1');
	assert.equal(byBlock('081-b0310')[0].reference.id, 'pan-youan:jiang-yuhan-natural-v2-proxy-v1');
	assert.equal(byBlock('081-b0299')[0].providerOverride.retryVersion, 2);
	assert.match(byBlock('081-b0299')[0].instruction, /不要添加不了、不及或其他尾音/u);
	assert.equal(byBlock('081-b0149')[0].pauseAfterMs, 120);
	assert.deepEqual(section.fragmentConditioning['narration:081-b0149:u01'].tailRepair,
		{ endSeconds: 33.52, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['narration:081-b0150:u01'].tailRepair,
		{ endSeconds: 1.72, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['narration:081-b0164:u01'].tailRepair,
		{ endSeconds: 2.88, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['dialogue:081-b0305:u01'].tailRepair,
		{ endSeconds: 1.72, fadeOutMs: 30 });
	assert.deepEqual(section.fragmentConditioning['dialogue:081-b0310:u01'].tailRepair,
		{ endSeconds: 4.82, fadeOutMs: 30 });
	assert.equal('publicOutput' in section, false);
});

test('第五节只使用获批甄士隐、香菱及两张代理卡，并保留定向重录规则', async () => {
	const pending = JSON.parse(await readFile(join(root, 'content/audio/.cache/pending/081.json'), 'utf8'));
	const document = JSON.parse(await readFile(join(root, 'content/audio/annotations/081.json'), 'utf8'));
	const provider = JSON.parse(await readFile(join(root, 'content/audio/providers/doubao.json'), 'utf8'));
	const sections = JSON.parse(await readFile(join(root, 'content/audio/production/chapters/081/sections.json'), 'utf8'));
	const section = sections.sections.find((item) => item.id === '05');
	const decisions = JSON.parse(await readFile(join(root, 'content/audio/.cache/voice-cards/review-decisions.json'), 'utf8'));
	const references = await verifiedReferences(section, decisions);
	const blocks = selectSectionBlocks(pending.blocks, section);
	const targets = buildSectionTargets({ blocks, annotations: document.annotations, references, provider, section,
		segmenterVersion: pending.segmenterVersion });
	const byBlock = (blockId: string) => targets.filter((item: { blockId: string }) => item.blockId === blockId);
	assert.equal(blocks[0].blockId, '081-b0314');
	assert.equal(blocks.at(-1).blockId, '081-b0367');
	assert.equal(blocks.length, 62);
	assert.equal(targets.length, 77);
	assert.deepEqual(Object.keys(section.voiceCards).sort(),
		['older-women-pool', 'xia-jingui', 'xiangling', 'zhen-shiyin']);
	assert.equal(references['zhen-shiyin'].approvalId, 'zhen-shiyin/warm-encouragement-v1');
	assert.equal(references.xiangling.approvalId, 'xiangling/calm-poetry-talk-v1');
	assert.equal(references['xia-jingui'].fileHash, 'b14ddeac6f9982d6825203bb1f7c3229a0966f4d42b4edfd9f3bb8893795069a');
	assert.match(references['xia-jingui'].proxyNote, /王熙凤.*代理声/u);
	assert.equal(references['older-women-pool'].fileHash,
		'd6f078c5e4a8b64ea76744ab6af7352ea4daa225db7ad752566aaeeaf5ce5d66');
	assert.match(references['older-women-pool'].proxyNote, /封氏.*贾母.*代理声/u);
	assert.equal(byBlock('081-b0356')[0].providerOverride.retryVersion, 1);
	assert.match(byBlock('081-b0356')[0].instruction, /不要压成耳语/u);
	assert.equal(byBlock('081-b0327')[0].providerOverride.promptMode, 'strict-text');
	assert.match(byBlock('081-b0327')[0].instruction, /不要扩写成寻找你/u);
	assert.equal('publicOutput' in section, false);
});
