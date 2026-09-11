import { once } from 'node:events';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { inspectMp3File } from '../../mp3.js';
import { splitSpeechText } from '../../text-chunks.js';
import { listEdgeVoices, OUTPUT_FORMAT, synthesizeEdgeSpeech } from '../edge-client.js';

const DEFAULT_VOICE = 'zh-CN-XiaoxiaoNeural';
const DEFAULT_RATE = '+0%';
const DEFAULT_PITCH = '+0Hz';
const DEFAULT_VOLUME = '+0%';
const DEFAULT_MAX_CHARS = 1000;
const DEFAULT_ATTEMPTS = 3;

function escapeXml(text) {
	return text
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&apos;');
}

function ensureSafeAttribute(name, value) {
	if (!/^[A-Za-z0-9+.%_-]+$/u.test(String(value))) {
		throw new Error(`${name} 包含不安全字符：${String(value)}`);
	}
}

function positiveInteger(value, fallback, name) {
	if (value === undefined || value === '') return fallback;
	const parsed = Number(value);
	if (!Number.isInteger(parsed) || parsed < 1) {
		throw new Error(`${name} 必须是正整数。`);
	}
	return parsed;
}

async function fileExists(path) {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (error?.code === 'ENOENT') return false;
		throw error;
	}
}

async function replaceCompletedFile(temporaryPath, outputPath) {
	const backupPath = `${outputPath}.previous`;
	await rm(backupPath, { force: true });
	const hadPreviousFile = await fileExists(outputPath);

	if (hadPreviousFile) await rename(outputPath, backupPath);
	try {
		await rename(temporaryPath, outputPath);
	} catch (error) {
		if (hadPreviousFile) await rename(backupPath, outputPath);
		throw error;
	}
	if (hadPreviousFile) await rm(backupPath, { force: true });
}

function delay(milliseconds) {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export class EdgeTtsProvider {
	name = 'edge';

	constructor(options = {}) {
		this.voice = String(options.voice || DEFAULT_VOICE);
		this.rate = String(options.rate || DEFAULT_RATE);
		this.pitch = String(options.pitch || DEFAULT_PITCH);
		this.volume = String(options.volume || DEFAULT_VOLUME);
		this.maxChunkChars = positiveInteger(
			options.maxChunkChars,
			DEFAULT_MAX_CHARS,
			'TTS_MAX_CHARS',
		);
		this.maxAttempts = positiveInteger(options.maxAttempts, DEFAULT_ATTEMPTS, 'TTS_RETRIES');

		ensureSafeAttribute('TTS_VOICE', this.voice);
		ensureSafeAttribute('TTS_RATE', this.rate);
		ensureSafeAttribute('TTS_PITCH', this.pitch);
		ensureSafeAttribute('TTS_VOLUME', this.volume);
	}

	get settings() {
		return {
			voice: this.voice,
			rate: this.rate,
			pitch: this.pitch,
			volume: this.volume,
			outputFormat: OUTPUT_FORMAT,
		};
	}

	resolveSettings(options = {}) {
		const settings = {
			voice: String(options.voice || this.voice),
			rate: String(options.rate || this.rate),
			pitch: String(options.pitch || this.pitch),
			volume: String(options.volume || this.volume),
		};
		ensureSafeAttribute('voice', settings.voice);
		ensureSafeAttribute('rate', settings.rate);
		ensureSafeAttribute('pitch', settings.pitch);
		ensureSafeAttribute('volume', settings.volume);
		return settings;
	}

	async listVoices({ locale } = {}) {
		const voices = await listEdgeVoices();
		if (!locale) return voices;
		return voices.filter((voice) => voice.Locale === locale);
	}

	createSynthesisUnits(text, segments) {
		if (text !== undefined && segments !== undefined) {
			throw new Error('TTS 请求不能同时提供 text 和 segments。');
		}
		const sourceSegments = segments ?? [{ text }];
		if (!Array.isArray(sourceSegments)) throw new Error('TTS segments 必须是数组。');

		const units = [];
		for (const segment of sourceSegments) {
			if (!segment || typeof segment.text !== 'string') {
				throw new Error('每个 TTS 分段都必须包含文本。');
			}
			const settings = this.resolveSettings(segment);
			for (const chunk of splitSpeechText(segment.text, this.maxChunkChars)) {
				units.push({
					text: chunk,
					...settings,
					voiceCardId: segment.voiceCardId,
					emotion: segment.emotion,
				});
			}
		}
		if (units.length === 0) throw new Error('没有可供朗读的正文。');
		return units;
	}

	async synthesizeChunk(text, options = {}) {
		const settings = this.resolveSettings(options);
		return synthesizeEdgeSpeech({
			text: escapeXml(text),
			...settings,
		});
	}

	async synthesizeChunkWithRetry(unit, progress) {
		let lastError;
		for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
			progress(attempt);
			try {
				return await this.synthesizeChunk(unit.text, unit);
			} catch (error) {
				lastError = error;
				if (attempt < this.maxAttempts) await delay(750 * attempt);
			}
		}
		throw lastError;
	}

	async synthesizeToFile({ text, segments, outputPath, onProgress }) {
		const units = this.createSynthesisUnits(text, segments);

		await mkdir(dirname(outputPath), { recursive: true });
		const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
		const output = createWriteStream(temporaryPath, { flags: 'wx' });

		try {
			for (let index = 0; index < units.length; index += 1) {
				const unit = units[index];
				const audio = await this.synthesizeChunkWithRetry(unit, (attempt) => {
					onProgress?.({
						index: index + 1,
						total: units.length,
						attempt,
						voiceCardId: unit.voiceCardId,
						emotion: unit.emotion,
					});
				});
				if (!output.write(audio)) await once(output, 'drain');
			}

			const closed = once(output, 'close');
			output.end();
			await closed;
			const result = await stat(temporaryPath);
			if (result.size === 0) throw new Error('生成的临时音频为空。');
			const audioInfo = await inspectMp3File(temporaryPath);
			await replaceCompletedFile(temporaryPath, outputPath);
			return { path: outputPath, chunks: units.length, ...audioInfo };
		} catch (error) {
			output.destroy();
			if (!output.closed) {
				await new Promise((resolve) => output.once('close', resolve));
			}
			await rm(temporaryPath, { force: true });
			const detail = error instanceof Error ? error.message : String(error);
			throw new Error(
				`Edge-TTS 合成失败：${detail} 请检查网络后重试；若服务不可用，可切换 TTS_PROVIDER。`,
				{ cause: error },
			);
		}
	}
}
