import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const VOICE_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export async function loadVoiceCardCatalog(projectRoot) {
	const directory = join(projectRoot, 'content', 'audio', 'voice-cards');
	const indexPath = join(directory, 'index.json');
	let indexRaw;
	let index;
	try {
		indexRaw = await readFile(indexPath, 'utf8');
		index = JSON.parse(indexRaw);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error('找不到 content/audio/voice-cards/index.json。');
		if (error instanceof SyntaxError) throw new Error('音色卡 index.json 不是有效 JSON。');
		throw error;
	}
	if (Number(index.version) !== 1 || !index.cards || typeof index.cards !== 'object') {
		throw new Error('音色卡 index.json 的 version 必须为 1，且必须包含 cards 对象。');
	}

	const cards = {};
	const sources = [indexRaw];
	for (const [id, filename] of Object.entries(index.cards)) {
		if (!VOICE_ID_PATTERN.test(id)) throw new Error(`音色卡 ID“${id}”格式无效。`);
		if (typeof filename !== 'string' || basename(filename) !== filename) {
			throw new Error(`音色卡“${id}”的文件路径不安全。`);
		}
		let raw;
		let card;
		try {
			raw = await readFile(join(directory, filename), 'utf8');
			card = JSON.parse(raw);
		} catch (error) {
			if (error?.code === 'ENOENT') throw new Error(`找不到音色卡 ${filename}。`);
			if (error instanceof SyntaxError) throw new Error(`音色卡 ${filename} 不是有效 JSON。`);
			throw error;
		}
		if (Number(card.version) !== 1 || card.id !== id) {
			throw new Error(`音色卡 ${filename} 的 version 或 id 与索引不一致。`);
		}
		cards[id] = card;
		sources.push(`${filename}\n${raw}`);
	}

	return {
		index,
		cards,
		catalogHash: createHash('sha256').update(sources.join('\n'), 'utf8').digest('hex'),
	};
}
