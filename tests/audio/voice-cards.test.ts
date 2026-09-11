import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..', '..');
const cardDirectory = join(projectRoot, 'content', 'audio', 'voice-cards');
const idPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const ratePattern = /^[+-]\d+%$/u;
const pitchPattern = /^[+-]\d+Hz$/u;
const volumePattern = /^[+-]\d+%$/u;
const emotionNames = new Set([
	'neutral', 'warm', 'joy', 'sad', 'anger', 'fear', 'urgent', 'whisper', 'solemn',
]);

async function readJson(path: string) {
	return JSON.parse(await readFile(path, 'utf8'));
}

function validateProsody(prosody: Record<string, unknown>, source: string, partial = false) {
	assert.ok(prosody && typeof prosody === 'object', `${source} 必须是对象`);
	if (!partial || prosody.rate !== undefined) {
		assert.match(String(prosody.rate), ratePattern, `${source}.rate 格式错误`);
	}
	if (!partial || prosody.pitch !== undefined) {
		assert.match(String(prosody.pitch), pitchPattern, `${source}.pitch 格式错误`);
	}
	if (!partial || prosody.volume !== undefined) {
		assert.match(String(prosody.volume), volumePattern, `${source}.volume 格式错误`);
	}
	assert.deepEqual(
		Object.keys(prosody).filter((key) => !['rate', 'pitch', 'volume'].includes(key)),
		[],
		`${source} 含未知字段`,
	);
}

test('音色卡索引、字段和韵律保持一致', async () => {
	const index = await readJson(join(cardDirectory, 'index.json'));
	assert.equal(index.version, 1);
	assert.equal(index.defaultNarrator, 'narrator');
	assert.equal(index.characters['旁白'], 'narrator');

	const renderings = new Set<string>();
	for (const [id, filename] of Object.entries<string>(index.cards)) {
		assert.match(id, idPattern);
		assert.equal(filename, `${id}.json`);
		const card = await readJson(join(cardDirectory, filename));
		assert.equal(card.version, 1);
		assert.equal(card.id, id);
		assert.match(card.id, idPattern);
		assert.ok(['A', 'B', 'C'].includes(card.tier));
		assert.equal(card.provider, 'edge');
		assert.match(card.voice, /^zh-CN-[A-Za-z]+Neural$/u);
		assert.equal(typeof card.label, 'string');
		assert.ok(card.label.length > 0);
		assert.ok(Array.isArray(card.aliases));
		assert.ok(Array.isArray(card.sharedCharacters));
		assert.ok(Array.isArray(card.sourceCards));
		for (const source of card.sourceCards) {
			assert.match(source, /^research\//u, `${id} 的研究来源必须使用 research/ 相对路径`);
		}
		assert.equal(typeof card.rationale, 'string');
		assert.ok(card.rationale.length > 0);
		validateProsody(card.prosody, `${id}.prosody`);
		assert.ok(card.emotions.neutral);
		for (const [emotion, override] of Object.entries<Record<string, unknown>>(card.emotions)) {
			assert.ok(emotionNames.has(emotion), `${id} 含未知情感 ${emotion}`);
			validateProsody(override, `${id}.emotions.${emotion}`, true);
		}
		const rendering = JSON.stringify({
			provider: card.provider,
			voice: card.voice,
			prosody: card.prosody,
		});
		assert.ok(!renderings.has(rendering), `${id} 与另一张卡复制了同一实际声音配置`);
		renderings.add(rendering);

	}

	for (const [name, id] of Object.entries<string>(index.characters)) {
		assert.ok(index.cards[id], `${name} 指向未登记音色卡 ${id}`);
	}
});

test('第81回复用仅限不直接对话的同类配角，旁白保持独立', async () => {
	const index = await readJson(join(cardDirectory, 'index.json'));
	const speakers = [
		'孙家婆子', '贾迎春', '贾宝玉', '王夫人', '林黛玉',
		'艾官', '荳官', '葵官', '袭人', '春燕', '王夫人丫头', '麝月',
		'秋纹', '碧痕', '绮霰', '紫鹃', '蒋玉菡', '花自芳', '邢夫人', '司棋',
		'周瑞家的', '司棋母', '潘又安', '莲花儿', '香菱', '甄士隐',
		'夏金桂', '未知来客',
	];
	const assignments = speakers.map((speaker) => {
		assert.ok(index.characters[speaker], `第81回说话人物未入索引：${speaker}`);
		return [speaker, index.characters[speaker]];
	});
	const groups = new Map<string, string[]>();
	for (const [speaker, id] of assignments) {
		groups.set(id, [...(groups.get(id) ?? []), speaker]);
	}
	assert.deepEqual(
		[...groups.entries()].filter(([, names]) => names.length > 1),
		[
			['older-women-pool', ['孙家婆子', '司棋母']],
			['young-maids-pool', ['王夫人丫头', '莲花儿']],
		],
	);
	const ids = assignments.map(([, id]) => id);
	assert.ok(!ids.includes(index.defaultNarrator));
});
