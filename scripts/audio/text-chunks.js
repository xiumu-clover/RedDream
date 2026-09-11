const STRONG_BOUNDARIES = ['\n', '。', '！', '？', '!', '?', '；', ';'];
const WEAK_BOUNDARIES = ['，', ',', '、', '：', ':'];

function lastBoundary(text, boundaries) {
	let best = -1;
	for (const boundary of boundaries) {
		best = Math.max(best, text.lastIndexOf(boundary));
	}
	return best < 0 ? -1 : best + 1;
}

/**
 * Split long narration at Chinese sentence or clause boundaries.
 * Every returned chunk is no longer than maxChars.
 *
 * @param {string} text
 * @param {number} [maxChars=1600]
 * @returns {string[]}
 */
export function splitSpeechText(text, maxChars = 1600) {
	if (!Number.isInteger(maxChars) || maxChars < 20) {
		throw new Error('TTS 分段长度必须是大于等于 20 的整数。');
	}

	const chunks = [];
	let remaining = text.trim();
	const minimumNaturalCut = Math.floor(maxChars * 0.4);

	while (remaining.length > maxChars) {
		const window = remaining.slice(0, maxChars);
		let cut = lastBoundary(window, STRONG_BOUNDARIES);
		if (cut < minimumNaturalCut) {
			cut = lastBoundary(window, WEAK_BOUNDARIES);
		}
		if (cut < minimumNaturalCut) cut = maxChars;

		const chunk = remaining.slice(0, cut).trim();
		if (chunk) chunks.push(chunk);
		remaining = remaining.slice(cut).trimStart();
	}

	if (remaining) chunks.push(remaining);
	return chunks;
}
