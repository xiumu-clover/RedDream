import { createHash, randomBytes } from 'node:crypto';
import WebSocket from 'ws';

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split('.')[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;
const WSS_URL =
	'wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1';
const VOICES_URL =
	'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list';
const WINDOWS_EPOCH_SECONDS = 11644473600;
const FIVE_MINUTES_SECONDS = 300;
const OUTPUT_FORMAT = 'audio-24khz-48kbitrate-mono-mp3';

let clockSkewSeconds = 0;

class EdgeHandshakeError extends Error {
	constructor(statusCode, headers) {
		super(`Edge TTS WebSocket 握手返回 HTTP ${statusCode}。`);
		this.statusCode = statusCode;
		this.headers = headers;
	}
}

function connectionId() {
	return randomBytes(16).toString('hex');
}

function generateMuid() {
	return randomBytes(16).toString('hex').toUpperCase();
}

function generateSecMsGec() {
	let seconds = Math.floor(Date.now() / 1000 + clockSkewSeconds) + WINDOWS_EPOCH_SECONDS;
	seconds -= seconds % FIVE_MINUTES_SECONDS;
	const windowsTicks = BigInt(seconds) * 10_000_000n;
	return createHash('sha256')
		.update(`${windowsTicks}${TRUSTED_CLIENT_TOKEN}`, 'ascii')
		.digest('hex')
		.toUpperCase();
}

function synthesisUrl() {
	const query = new URLSearchParams({
		TrustedClientToken: TRUSTED_CLIENT_TOKEN,
		ConnectionId: connectionId(),
		'Sec-MS-GEC': generateSecMsGec(),
		'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
	});
	return `${WSS_URL}?${query}`;
}

function requestHeaders() {
	return {
		Pragma: 'no-cache',
		'Cache-Control': 'no-cache',
		Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
		'User-Agent':
			`Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 `
			+ `(KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 `
			+ `Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
		'Accept-Encoding': 'gzip, deflate, br, zstd',
		'Accept-Language': 'en-US,en;q=0.9',
		Cookie: `muid=${generateMuid()};`,
	};
}

function adjustClockSkew(headers) {
	const serverDate = typeof headers?.get === 'function' ? headers.get('date') : headers?.date;
	const serverMilliseconds = typeof serverDate === 'string' ? Date.parse(serverDate) : Number.NaN;
	if (!Number.isFinite(serverMilliseconds)) return false;
	const adjustedNow = Date.now() + clockSkewSeconds * 1000;
	clockSkewSeconds += (serverMilliseconds - adjustedNow) / 1000;
	return true;
}

function voicesUrl() {
	const query = new URLSearchParams({
		TrustedClientToken: TRUSTED_CLIENT_TOKEN,
		'Sec-MS-GEC': generateSecMsGec(),
		'Sec-MS-GEC-Version': SEC_MS_GEC_VERSION,
	});
	return `${VOICES_URL}?${query}`;
}

async function fetchEdgeVoicesOnce() {
	const response = await fetch(voicesUrl(), { headers: requestHeaders() });
	if (!response.ok) {
		const error = new EdgeHandshakeError(response.status, response.headers);
		await response.body?.cancel();
		throw error;
	}
	const voices = await response.json();
	if (!Array.isArray(voices)) throw new Error('Edge-TTS 音色列表返回格式无效。');
	return voices;
}

/**
 * Query the current Edge Read Aloud voice catalog.
 */
export async function listEdgeVoices() {
	try {
		return await fetchEdgeVoicesOnce();
	} catch (error) {
		if (!(error instanceof EdgeHandshakeError)
			|| error.statusCode !== 403
			|| !adjustClockSkew(error.headers)) {
			throw error;
		}
		return fetchEdgeVoicesOnce();
	}
}

function openWebSocketOnce(connectTimeoutMs) {
	const socket = new WebSocket(synthesisUrl(), {
		perMessageDeflate: true,
		headers: requestHeaders(),
	});

	return new Promise((resolve, reject) => {
		const timeout = setTimeout(() => {
			cleanup();
			socket.terminate();
			reject(new Error(`连接 Edge-TTS 超时（${connectTimeoutMs / 1000} 秒）。`));
		}, connectTimeoutMs);

		function cleanup() {
			clearTimeout(timeout);
			socket.off('open', handleOpen);
			socket.off('error', handleError);
			socket.off('unexpected-response', handleUnexpectedResponse);
		}

		function handleOpen() {
			cleanup();
			resolve(socket);
		}

		function handleError(error) {
			cleanup();
			reject(error);
		}

		function handleUnexpectedResponse(_request, response) {
			const error = new EdgeHandshakeError(response.statusCode, response.headers);
			response.resume();
			cleanup();
			reject(error);
		}

		socket.once('open', handleOpen);
		socket.once('error', handleError);
		socket.once('unexpected-response', handleUnexpectedResponse);
	});
}

async function openWebSocket(connectTimeoutMs) {
	try {
		return await openWebSocketOnce(connectTimeoutMs);
	} catch (error) {
		if (!(error instanceof EdgeHandshakeError)
			|| error.statusCode !== 403
			|| !adjustClockSkew(error.headers)) {
			throw error;
		}
		return openWebSocketOnce(connectTimeoutMs);
	}
}

function edgeDateString() {
	const date = new Date(Date.now() + clockSkewSeconds * 1000);
	const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	const twoDigits = (value) => String(value).padStart(2, '0');
	return `${weekdays[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${twoDigits(date.getUTCDate())} `
		+ `${date.getUTCFullYear()} ${twoDigits(date.getUTCHours())}:${twoDigits(date.getUTCMinutes())}:`
		+ `${twoDigits(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`;
}

function speechConfigMessage() {
	return `X-Timestamp:${edgeDateString()}\r\n`
		+ 'Content-Type:application/json; charset=utf-8\r\n'
		+ 'Path:speech.config\r\n\r\n'
		+ '{"context":{"synthesis":{"audio":{"metadataoptions":'
		+ '{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},'
		+ `"outputFormat":"${OUTPUT_FORMAT}"}}}}\r\n`;
}

function ssmlMessage({ text, voice, rate, pitch, volume }) {
	const requestId = connectionId();
	const ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>"
		+ `<voice name='${voice}'><prosody pitch='${pitch}' rate='${rate}' volume='${volume}'>`
		+ `${text}</prosody></voice></speak>`;
	return `X-RequestId:${requestId}\r\n`
		+ 'Content-Type:application/ssml+xml\r\n'
		+ `X-Timestamp:${edgeDateString()}Z\r\n`
		+ `Path:ssml\r\n\r\n${ssml}`;
}

function audioFromBinaryMessage(data) {
	const message = Buffer.from(data);
	if (message.length < 2) throw new Error('Edge-TTS 返回了缺少头长度的二进制消息。');
	const headerLength = message.readUInt16BE(0);
	if (headerLength + 2 > message.length) {
		throw new Error('Edge-TTS 返回的音频头长度无效。');
	}
	const headers = message.subarray(2, headerLength + 2).toString('utf8');
	if (!/(?:^|\r\n)Path:audio(?:\r\n|$)/u.test(headers)) {
		throw new Error('Edge-TTS 返回了未知的二进制消息。');
	}
	return message.subarray(headerLength + 2);
}

/**
 * Synthesize one already XML-escaped text chunk with the current Edge Read Aloud protocol.
 *
 * @returns {Promise<Buffer>}
 */
export async function synthesizeEdgeSpeech({
	text,
	voice,
	rate,
	pitch,
	volume,
	connectTimeoutMs = 30_000,
	receiveTimeoutMs = 60_000,
}) {
	const socket = await openWebSocket(connectTimeoutMs);

	return new Promise((resolve, reject) => {
		const audioChunks = [];
		let settled = false;
		let receiveTimeout;

		function cleanup() {
			clearTimeout(receiveTimeout);
			socket.removeAllListeners('message');
		}

		function finish(error) {
			if (settled) return;
			settled = true;
			cleanup();
			// Edge does not acknowledge a WebSocket close frame promptly. Keep
			// no-op handlers on both ws and its Windows TLS transport before using
			// ws.terminate(); delayed ECONNRESET events can otherwise arrive after
			// a successful turn and crash a later, unrelated synthesis phase.
			const ignoreShutdownError = () => {};
			socket.on('error', ignoreShutdownError);
			if (socket._socket && typeof socket._socket.on === 'function') {
				const transport = socket._socket;
				transport.on('error', ignoreShutdownError);
				transport.once('close', () => {
					transport.on('error', ignoreShutdownError);
				});
			}
			if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
			if (error) reject(error);
			else resolve(Buffer.concat(audioChunks));
		}

		function resetReceiveTimeout() {
			clearTimeout(receiveTimeout);
			receiveTimeout = setTimeout(() => {
				finish(new Error(`等待 Edge-TTS 音频超时（${receiveTimeoutMs / 1000} 秒）。`));
			}, receiveTimeoutMs);
		}

		socket.on('message', (data, isBinary) => {
			try {
				resetReceiveTimeout();
				if (isBinary) {
					const audio = audioFromBinaryMessage(data);
					if (audio.length > 0) audioChunks.push(audio);
					return;
				}
				if (data.toString().includes('Path:turn.end')) {
					if (audioChunks.length === 0) {
						finish(new Error('Edge-TTS 没有返回音频数据。'));
					} else {
						finish();
					}
				}
			} catch (error) {
				finish(error);
			}
		});
		socket.once('error', finish);
		socket.once('close', (code) => {
			if (!settled) finish(new Error(`Edge-TTS 连接提前关闭（代码 ${code}）。`));
		});

		resetReceiveTimeout();
		try {
			socket.send(speechConfigMessage());
			socket.send(ssmlMessage({ text, voice, rate, pitch, volume }));
		} catch (error) {
			finish(error);
		}
	});
}

export { OUTPUT_FORMAT };
