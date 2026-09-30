/** Shorten only measured PCM silence; never fade or remove voiced samples. */
export function limitPcmSilence(wav, policy = {}) {
	if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') {
		throw new Error('输入不是 RIFF WAV。');
	}
	let format;
	let pcm;
	for (let offset = 12; offset + 8 <= wav.length;) {
		const name = wav.toString('ascii', offset, offset + 4);
		const length = wav.readUInt32LE(offset + 4);
		const start = offset + 8;
		if (start + length > wav.length) throw new Error('WAV chunk 长度越界。');
		if (name === 'fmt ') {
			if (length < 16) throw new Error('WAV fmt chunk 不完整。');
			format = { codec: wav.readUInt16LE(start), channels: wav.readUInt16LE(start + 2),
				sampleRate: wav.readUInt32LE(start + 4), bits: wav.readUInt16LE(start + 14) };
		}
		if (name === 'data') pcm = wav.subarray(start, start + length);
		offset = start + length + (length % 2);
	}
	if (format?.codec !== 1 || format.channels !== 1 || format.sampleRate !== 24000
		|| format.bits !== 16 || !pcm?.length || pcm.length % 2) {
		throw new Error('静音修整只接受 24 kHz 单声道 PCM16 WAV。');
	}
	const thresholdDbfs = policy.thresholdDbfs ?? -43;
	const minimumGapMs = policy.minimumGapMs ?? 80;
	const leadingMs = policy.leadingMs ?? 70;
	const trailingMs = policy.trailingMs ?? 70;
	const internalMs = policy.internalMs ?? 260;
	const sampleRate = format.sampleRate;
	const frameSamples = sampleRate / 100;
	const totalSamples = pcm.length / 2;
	const quiet = [];
	for (let start = 0; start < totalSamples; start += frameSamples) {
		const count = Math.min(frameSamples, totalSamples - start);
		let squared = 0;
		for (let index = 0; index < count; index += 1) {
			const value = pcm.readInt16LE((start + index) * 2) / 32768;
			squared += value * value;
		}
		quiet.push(20 * Math.log10(Math.max(1e-8, Math.sqrt(squared / count))) <= thresholdDbfs);
	}
	const cuts = [];
	let runStart = -1;
	for (let index = 0; index <= quiet.length; index += 1) {
		if (index < quiet.length && quiet[index] && runStart < 0) runStart = index;
		if ((index === quiet.length || !quiet[index]) && runStart >= 0) {
			const start = runStart * frameSamples;
			const end = Math.min(totalSamples, index * frameSamples);
			const lengthMs = (end - start) * 1000 / sampleRate;
			if (lengthMs >= minimumGapMs) {
				let from;
				let to;
				let kind;
				if (start === 0) {
					kind = 'leading';
					from = 0;
					to = end - Math.round(leadingMs * sampleRate / 1000);
				} else if (end === totalSamples) {
					kind = 'trailing';
					from = start + Math.round(trailingMs * sampleRate / 1000);
					to = totalSamples;
				} else {
					kind = 'internal';
					const keep = Math.round(internalMs * sampleRate / 1000);
					from = start + Math.floor(keep / 2);
					to = end - Math.ceil(keep / 2);
				}
				if (to > from) cuts.push({ kind, from, to, originalMs: Math.round(lengthMs),
					removedMs: Math.round((to - from) * 1000 / sampleRate) });
			}
			runStart = -1;
		}
	}
	const pieces = [];
	let cursor = 0;
	for (const cut of cuts) {
		pieces.push(pcm.subarray(cursor * 2, cut.from * 2));
		cursor = cut.to;
	}
	pieces.push(pcm.subarray(cursor * 2));
	const data = Buffer.concat(pieces);
	if (data.length < sampleRate) throw new Error('静音修整后的片段异常过短。');
	const header = Buffer.alloc(44);
	header.write('RIFF', 0, 'ascii');
	header.writeUInt32LE(data.length + 36, 4);
	header.write('WAVEfmt ', 8, 'ascii');
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(sampleRate, 24);
	header.writeUInt32LE(sampleRate * 2, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write('data', 36, 'ascii');
	header.writeUInt32LE(data.length, 40);
	return { wav: Buffer.concat([header, data]), cuts: cuts.map(({ kind, originalMs, removedMs }) => ({
		kind, originalMs, retainedMs: originalMs - removedMs, removedMs,
	})) };
}

function pcmInternalGaps(wav, thresholdDbfs) {
	if (wav.length < 44 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE'
		|| wav.toString('ascii', 36, 40) !== 'data' || wav.readUInt16LE(20) !== 1 || wav.readUInt32LE(24) !== 24000
		|| wav.readUInt16LE(22) !== 1 || wav.readUInt16LE(34) !== 16
		|| wav.readUInt32LE(40) + 44 !== wav.length) {
		throw new Error('停顿补足只接受标准 24 kHz 单声道 PCM16 WAV。');
	}
	const frameSamples = 240;
	const pcm = wav.subarray(44);
	const totalSamples = pcm.length / 2;
	const quiet = [];
	for (let start = 0; start < totalSamples; start += frameSamples) {
		const count = Math.min(frameSamples, totalSamples - start);
		let squared = 0;
		for (let index = 0; index < count; index += 1) {
			const value = pcm.readInt16LE((start + index) * 2) / 32768;
			squared += value * value;
		}
		quiet.push(20 * Math.log10(Math.max(1e-8, Math.sqrt(squared / count))) <= thresholdDbfs);
	}
	const gaps = [];
	let runStart = -1;
	for (let index = 0; index <= quiet.length; index += 1) {
		if (index < quiet.length && quiet[index] && runStart < 0) runStart = index;
		if ((index === quiet.length || !quiet[index]) && runStart >= 0) {
			const start = runStart * frameSamples;
			const end = Math.min(totalSamples, index * frameSamples);
			if (start > 0 && end < totalSamples && end - start >= frameSamples * 8) gaps.push({ start, end });
			runStart = -1;
		}
	}
	return { pcm, gaps };
}

/** Add exact silence only inside existing quiet gaps; preserves every original sample. */
export function stretchInternalPcmSilence(wav, targetMs, thresholdDbfs = -43) {
	const { pcm, gaps } = pcmInternalGaps(wav, thresholdDbfs);
	if (gaps.length !== targetMs.length || targetMs.some((value) => value !== null
		&& (!Number.isInteger(value) || value < 80 || value > 800))) {
		throw new Error(`逗号静音位置或目标配置不符：测得 ${gaps.length} 处，配置 ${targetMs.length} 处。`);
	}
	const chunks = [];
	const additions = [];
	let cursor = 0;
	for (const [index, gap] of gaps.entries()) {
		const originalMs = Math.round((gap.end - gap.start) / 24);
		const addSamples = targetMs[index] === null ? 0
			: Math.max(0, Math.round(targetMs[index] * 24) - (gap.end - gap.start));
		const middle = Math.floor((gap.start + gap.end) / 2);
		chunks.push(pcm.subarray(cursor * 2, middle * 2));
		if (addSamples) chunks.push(Buffer.alloc(addSamples * 2));
		cursor = middle;
		additions.push({ originalMs, targetMs: originalMs + addSamples / 24, addedMs: addSamples / 24 });
	}
	chunks.push(pcm.subarray(cursor * 2));
	const data = Buffer.concat(chunks);
	const header = Buffer.from(wav.subarray(0, 44));
	header.writeUInt32LE(data.length + 36, 4);
	header.writeUInt32LE(data.length, 40);
	return { wav: Buffer.concat([header, data]), additions };
}

/** Replace a suffix at explicitly checked quiet gaps, retaining voiced samples on both sides. */
export function splicePcmSuffix(original, replacement, spec, thresholdDbfs = -43) {
	const left = pcmInternalGaps(original, thresholdDbfs);
	const right = pcmInternalGaps(replacement, thresholdDbfs);
	if (left.gaps.length !== spec.expectedPrefixGapCount || right.gaps.length !== spec.expectedReplacementGapCount
		|| !Number.isInteger(spec.prefixGapIndex) || !Number.isInteger(spec.replacementGapIndex)
		|| !left.gaps[spec.prefixGapIndex] || !right.gaps[spec.replacementGapIndex]) {
		throw new Error(`句尾替换静音锚点不符：原音 ${left.gaps.length} 处，新音 ${right.gaps.length} 处。`);
	}
	const a = left.gaps[spec.prefixGapIndex];
	const b = right.gaps[spec.replacementGapIndex];
	const leftEnd = Math.floor((a.start + a.end) / 2);
	const rightStart = Math.floor((b.start + b.end) / 2);
	const data = Buffer.concat([left.pcm.subarray(0, leftEnd * 2), right.pcm.subarray(rightStart * 2)]);
	const header = Buffer.from(original.subarray(0, 44));
	header.writeUInt32LE(data.length + 36, 4);
	header.writeUInt32LE(data.length, 40);
	return { wav: Buffer.concat([header, data]), splice: {
		prefixEndSeconds: leftEnd / 24000, replacementStartSeconds: rightStart / 24000,
		joinSilenceMs: (leftEnd - a.start + b.end - rightStart) / 24,
	} };
}

/** Remove a known bad tail and taper the final retained samples to prevent a click. */
export function trimPcmTail(wav, endSeconds, fadeOutMs = 80) {
	const { pcm } = pcmInternalGaps(wav, -43);
	if (!Number.isFinite(endSeconds) || endSeconds <= 0
		|| !Number.isInteger(fadeOutMs) || fadeOutMs < 20 || fadeOutMs > 300) {
		throw new Error('尾部修整参数无效。');
	}
	const endSample = Math.round(endSeconds * 24000);
	const totalSamples = pcm.length / 2;
	if (endSample >= totalSamples || endSample < 2400) throw new Error('尾部修整位置超出有效音频。');
	const data = Buffer.from(pcm.subarray(0, endSample * 2));
	const fadeSamples = Math.min(endSample, Math.round(fadeOutMs * 24));
	for (let index = 0; index < fadeSamples; index += 1) {
		const position = endSample - fadeSamples + index;
		const gain = 1 - (index + 1) / fadeSamples;
		data.writeInt16LE(Math.round(data.readInt16LE(position * 2) * gain), position * 2);
	}
	const header = Buffer.from(wav.subarray(0, 44));
	header.writeUInt32LE(data.length + 36, 4);
	header.writeUInt32LE(data.length, 40);
	return { wav: Buffer.concat([header, data]), repair: {
		originalDurationSeconds: totalSamples / 24000,
		endSeconds,
		fadeOutMs,
		removedMs: (totalSamples - endSample) / 24,
	} };
}
