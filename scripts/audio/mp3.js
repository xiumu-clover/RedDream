import { readFile } from 'node:fs/promises';

const MPEG1_LAYER3_BITRATES = [
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_LAYER3_BITRATES = [
	0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const MPEG1_SAMPLE_RATES = [44_100, 48_000, 32_000];

function id3v2Length(buffer, offset) {
	if (buffer.subarray(offset, offset + 3).toString('ascii') !== 'ID3') return 0;
	if (offset + 10 > buffer.length) throw new Error('MP3 的 ID3v2 文件头不完整。');
	const sizeBytes = buffer.subarray(offset + 6, offset + 10);
	if (sizeBytes.some((value) => value > 0x7f)) throw new Error('MP3 的 ID3v2 长度无效。');
	const tagSize = (sizeBytes[0] << 21) | (sizeBytes[1] << 14) | (sizeBytes[2] << 7) | sizeBytes[3];
	return 10 + tagSize;
}

function parseFrameHeader(buffer, offset) {
	if (offset + 4 > buffer.length) return undefined;
	const header = buffer.readUInt32BE(offset);
	if ((header >>> 21) !== 0x7ff) return undefined;

	const versionBits = (header >>> 19) & 0b11;
	const layerBits = (header >>> 17) & 0b11;
	const bitrateIndex = (header >>> 12) & 0b1111;
	const sampleRateIndex = (header >>> 10) & 0b11;
	const padding = (header >>> 9) & 1;
	const channelMode = (header >>> 6) & 0b11;
	if (versionBits === 0b01 || layerBits !== 0b01
		|| bitrateIndex === 0 || bitrateIndex === 0b1111 || sampleRateIndex === 0b11) {
		return undefined;
	}

	const isMpeg1 = versionBits === 0b11;
	const divisor = isMpeg1 ? 1 : versionBits === 0b10 ? 2 : 4;
	const sampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex] / divisor;
	const bitrateKbps = (isMpeg1 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES)[bitrateIndex];
	const samplesPerFrame = isMpeg1 ? 1152 : 576;
	const frameLength = Math.floor(
		(isMpeg1 ? 144_000 : 72_000) * bitrateKbps / sampleRate,
	) + padding;
	return {
		bitrateKbps,
		channels: channelMode === 0b11 ? 1 : 2,
		frameLength,
		sampleRate,
		samplesPerFrame,
	};
}

/**
 * Validate an MP3 as a complete sequence of MPEG Layer III frames.
 *
 * @param {Buffer} buffer
 */
export function inspectMp3Buffer(buffer) {
	if (!Buffer.isBuffer(buffer) || buffer.length === 0) throw new Error('MP3 文件为空。');

	let offset = id3v2Length(buffer, 0);
	let frames = 0;
	let durationSeconds = 0;
	let sampleRate;
	let bitrateKbps;
	let channels;

	while (offset < buffer.length) {
		if (buffer.length - offset === 128
			&& buffer.subarray(offset, offset + 3).toString('ascii') === 'TAG') {
			offset += 128;
			break;
		}

		const frame = parseFrameHeader(buffer, offset);
		if (!frame) throw new Error(`MP3 在字节 ${offset} 处没有有效的 MPEG Layer III 帧头。`);
		if (offset + frame.frameLength > buffer.length) {
			throw new Error(`MP3 最后一个音频帧不完整（字节 ${offset}）。`);
		}
		if (sampleRate !== undefined && frame.sampleRate !== sampleRate) {
			throw new Error(`MP3 在字节 ${offset} 处改变了采样率。`);
		}
		if (channels !== undefined && frame.channels !== channels) {
			throw new Error(`MP3 在字节 ${offset} 处改变了声道数。`);
		}
		sampleRate = frame.sampleRate;
		bitrateKbps ??= frame.bitrateKbps;
		channels ??= frame.channels;
		durationSeconds += frame.samplesPerFrame / frame.sampleRate;
		frames += 1;
		offset += frame.frameLength;
	}

	if (frames === 0 || offset !== buffer.length) throw new Error('MP3 没有完整的音频帧。');
	return {
		bytes: buffer.length,
		frames,
		durationSeconds: Number(durationSeconds.toFixed(3)),
		sampleRate,
		bitrateKbps,
		channels,
	};
}

export async function inspectMp3File(path) {
	return inspectMp3Buffer(await readFile(path));
}
