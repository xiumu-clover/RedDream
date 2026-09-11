import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, resolve } from 'node:path';
import { inspectMp3File } from './mp3.js';
import { createTtsProvider } from './tts/provider.js';

const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..', '..');
const CARD_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', 'voice-cards');
const OUTPUT_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio', '.cache', 'voice-previews');
const PREVIEW_TEXT =
	'庭院里风声渐起，远处钟声缓缓传来。说话不必夸张，只要字句清楚，情绪自然，便可听出这段声音的层次。';
const EXPECTED_SAMPLE_RATE = 24_000;
const EXPECTED_BITRATE = 48;

async function readJson(path) {
	return JSON.parse(await readFile(path, 'utf8'));
}

async function existingPreview(path) {
	try {
		return await inspectMp3File(path);
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		throw error;
	}
}

function assertAudioFormat(info, id) {
	if (info.bytes <= 0) throw new Error(`${id} 的试听文件为空。`);
	if (info.sampleRate !== EXPECTED_SAMPLE_RATE
		|| info.bitrateKbps !== EXPECTED_BITRATE
		|| info.channels !== 1) {
		throw new Error(
			`${id} 的试听格式为 ${info.sampleRate} Hz / ${info.bitrateKbps} kbps / `
			+ `${info.channels} 声道，要求 ${EXPECTED_SAMPLE_RATE} Hz / `
			+ `${EXPECTED_BITRATE} kbps / 单声道。`,
		);
	}
}

async function main() {
	const force = process.argv.includes('--force');
	const hanCount = [...PREVIEW_TEXT.matchAll(/\p{Script=Han}/gu)].length;
	if (hanCount < 40 || hanCount > 80) {
		throw new Error(`试听文本含 ${hanCount} 个汉字，不在 40–80 范围内。`);
	}

	const index = await readJson(join(CARD_DIRECTORY, 'index.json'));
	const catalogProvider = await createTtsProvider('edge');
	if (typeof catalogProvider.listVoices !== 'function') {
		throw new Error('当前 Edge provider 不支持实时查询音色目录。');
	}
	const liveVoices = await catalogProvider.listVoices({ locale: 'zh-CN' });
	const availableShortNames = new Set(liveVoices.map((voice) => voice.ShortName));
	console.log(
		`实时查询到 ${liveVoices.length} 个 zh-CN 音色：`
		+ liveVoices.map((voice) => voice.ShortName).join('、'),
	);

	const results = [];
	for (const [id, filename] of Object.entries(index.cards).sort(([left], [right]) =>
		left.localeCompare(right))) {
		const card = await readJson(join(CARD_DIRECTORY, filename));
		const outputPath = join(OUTPUT_DIRECTORY, `${id}.mp3`);
		try {
			if (card.provider !== 'edge') {
				throw new Error(`试听脚本当前只校验 edge 卡片，实际为 ${card.provider}。`);
			}
			if (!availableShortNames.has(card.voice)) {
				throw new Error(`实时 zh-CN 音色目录中不存在 ${card.voice}。`);
			}

			if (!force) {
				const current = await existingPreview(outputPath);
				if (current) {
					assertAudioFormat(current, id);
					results.push({ id, status: 'existing', ...current });
					console.log(`[已有] ${id}：${current.durationSeconds.toFixed(3)} 秒`);
					continue;
				}
			}

			const provider = await createTtsProvider(card.provider, {
				voice: card.voice,
				rate: card.prosody.rate,
				pitch: card.prosody.pitch,
				volume: card.prosody.volume,
			});
			await provider.synthesizeToFile({
				text: PREVIEW_TEXT,
				outputPath,
				onProgress: ({ attempt }) => {
					if (attempt > 1) console.log(`[重试] ${id}：第 ${attempt} 次`);
				},
			});
			const info = await inspectMp3File(outputPath);
			assertAudioFormat(info, id);
			results.push({ id, status: 'generated', ...info });
			console.log(`[完成] ${id}：${info.durationSeconds.toFixed(3)} 秒，${info.bytes} 字节`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			results.push({ id, status: 'failed', error: message });
			console.error(`[失败] ${id}：${message}`);
		}
	}

	const failed = results.filter((result) => result.status === 'failed');
	console.log(JSON.stringify({
		previewText: PREVIEW_TEXT,
		hanCharacters: hanCount,
		liveVoices: liveVoices.map((voice) => voice.ShortName),
		results: results.map((result) => ({
			id: result.id,
			status: result.status,
			bytes: result.bytes,
			durationSeconds: result.durationSeconds,
			sampleRate: result.sampleRate,
			bitrateKbps: result.bitrateKbps,
			channels: result.channels,
			error: result.error,
		})),
	}, null, 2));
	if (failed.length > 0) process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.stack : String(error));
	process.exitCode = 1;
});
