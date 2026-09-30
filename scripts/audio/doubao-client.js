import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { replaceFileAtomic } from './files.js';

const DEFAULT_CONFIG_PATH = join('content', 'audio', '.cache', 'doubao', 'config.json');

export class DoubaoApiError extends Error {
	constructor(message, { status, code, logId, retryable = false } = {}) {
		super(message);
		this.name = 'DoubaoApiError';
		this.status = status;
		this.code = code;
		this.logId = logId;
		this.retryable = retryable;
	}
}

function nonEmptyString(value) {
	return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export async function loadDoubaoCredentials(projectRoot, env = process.env) {
	let saved;
	const configPath = resolve(projectRoot, DEFAULT_CONFIG_PATH);
	try {
		saved = JSON.parse(await readFile(configPath, 'utf8'));
	} catch (error) {
		if (error?.code !== 'ENOENT') throw new Error(`${configPath} 不是有效的豆包本地配置。`, { cause: error });
	}
	const apiKey = nonEmptyString(env.DOUBAO_API_KEY) || nonEmptyString(saved?.apiKey);
	if (!apiKey) {
		throw new Error(
			`缺少豆包 API Key。请在 ${configPath} 写入 {"apiKey":"..."}，或设置 DOUBAO_API_KEY；该目录已被 Git 忽略。`,
		);
	}
	return { apiKey, configPath };
}

export function extractJsonValues(text, { final = true } = {}) {
	const values = [];
	let start = -1;
	let depth = 0;
	let inString = false;
	let escaped = false;
	let consumed = 0;
	for (let index = 0; index < text.length; index += 1) {
		const character = text[index];
		if (start < 0) {
			if (/\s/u.test(character)) {
				consumed = index + 1;
				continue;
			}
			if (character !== '{' && character !== '[') {
				throw new Error(`豆包响应包含无法解析的前缀：${JSON.stringify(text.slice(index, index + 40))}`);
			}
			start = index;
			depth = 1;
			continue;
		}
		if (inString) {
			if (escaped) escaped = false;
			else if (character === '\\') escaped = true;
			else if (character === '"') inString = false;
			continue;
		}
		if (character === '"') inString = true;
		else if (character === '{' || character === '[') depth += 1;
		else if (character === '}' || character === ']') {
			depth -= 1;
			if (depth === 0) {
				values.push(JSON.parse(text.slice(start, index + 1)));
				consumed = index + 1;
				start = -1;
			}
		}
	}
	const remainder = text.slice(consumed);
	if (final && remainder.trim()) throw new Error('豆包响应在结束时仍包含不完整 JSON。');
	return { values, remainder };
}

async function readJsonStream(body) {
	if (!body) throw new Error('豆包响应没有响应体。');
	const decoder = new TextDecoder();
	let pending = '';
	const values = [];
	for await (const chunk of body) {
		pending += decoder.decode(chunk, { stream: true });
		const parsed = extractJsonValues(pending, { final: false });
		values.push(...parsed.values);
		pending = parsed.remainder;
	}
	pending += decoder.decode();
	const parsed = extractJsonValues(pending, { final: true });
	values.push(...parsed.values);
	return values;
}

function delay(milliseconds) {
	return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function summarizeResponse(values) {
	const audio = [];
	const sentences = [];
	let usage;
	for (const value of values) {
		if (!value || typeof value !== 'object') continue;
		if (value.code !== undefined && value.code !== 0) {
			throw new DoubaoApiError(`豆包合成失败：${value.message || `错误码 ${value.code}`}`, {
				code: value.code,
			});
		}
		if (typeof value.data === 'string' && value.data) audio.push(Buffer.from(value.data, 'base64'));
		if (value.sentence && typeof value.sentence === 'object') sentences.push(value.sentence);
		if (value.usage && typeof value.usage === 'object') usage = value.usage;
	}
	if (audio.length === 0) throw new Error('豆包响应未包含音频数据。');
	return { audio: Buffer.concat(audio), sentences, usage, responseChunks: values.length };
}

export class DoubaoTtsClient {
	constructor({ apiKey, endpoint, resourceId, maxAttempts = 3, timeoutMs = 180000, fetchImpl = fetch }) {
		this.apiKey = apiKey;
		this.endpoint = endpoint;
		this.resourceId = resourceId;
		this.maxAttempts = maxAttempts;
		this.timeoutMs = timeoutMs;
		this.fetchImpl = fetchImpl;
	}

	async synthesize(request) {
		let lastError;
		for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
			const requestId = randomUUID();
			try {
				const response = await this.fetchImpl(this.endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Connection': 'keep-alive',
						'X-Api-Key': this.apiKey,
						'X-Api-Resource-Id': this.resourceId,
						'X-Api-Request-Id': requestId,
						'X-Control-Require-Usage-Tokens-Return': '*',
					},
					body: JSON.stringify({ req_params: request }),
					signal: AbortSignal.timeout(this.timeoutMs),
				});
				const logId = response.headers.get('x-tt-logid') || undefined;
				if (!response.ok) {
					const detail = (await response.text()).slice(0, 500);
					throw new DoubaoApiError(`豆包 HTTP ${response.status}：${detail || response.statusText}`, {
						status: response.status,
						logId,
						retryable: response.status === 429 || response.status >= 500,
					});
				}
				const values = await readJsonStream(response.body);
				try {
					return { ...summarizeResponse(values), requestId, logId, attempt };
				} catch (error) {
					if (error instanceof DoubaoApiError && !error.logId) error.logId = logId;
					throw error;
				}
			} catch (error) {
				lastError = error;
				const retryable = error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError'
					|| error instanceof TypeError;
				if (!retryable || attempt === this.maxAttempts) break;
				await delay(800 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 250));
			}
		}
		throw lastError;
	}
}

export class DoubaoAudioGenerationClient {
	constructor({ apiKey, endpoint, maxAttempts = 3, timeoutMs = 300000, fetchImpl = fetch }) {
		this.apiKey = apiKey;
		this.endpoint = endpoint;
		this.maxAttempts = maxAttempts;
		this.timeoutMs = timeoutMs;
		this.fetchImpl = fetchImpl;
	}

	async synthesize(request) {
		let lastError;
		for (let attempt = 1; attempt <= this.maxAttempts; attempt += 1) {
			const requestId = randomUUID();
			try {
				const response = await this.fetchImpl(this.endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'X-Api-Key': this.apiKey,
						'X-Api-Request-Id': requestId,
					},
					body: JSON.stringify(request),
					signal: AbortSignal.timeout(this.timeoutMs),
				});
				const logId = response.headers.get('x-tt-logid') || undefined;
				const text = await response.text();
				let value;
				try {
					value = JSON.parse(text);
				} catch {
					throw new DoubaoApiError(`豆包音频生成返回了非 JSON 响应：${text.slice(0, 300)}`, {
						status: response.status,
						logId,
						retryable: response.status >= 500,
					});
				}
				if (!response.ok) {
					const serverMessage = value?.message || value?.header?.message || response.statusText;
					throw new DoubaoApiError(`豆包 HTTP ${response.status}：${serverMessage}`, {
						status: response.status,
						code: value?.code ?? value?.header?.code,
						logId,
						retryable: response.status === 429 || response.status >= 500,
					});
				}
				if (value?.code !== undefined && value.code !== 0) {
					throw new DoubaoApiError(`豆包音频生成失败：${value.message || `错误码 ${value.code}`}`, {
						code: value.code,
						logId,
					});
				}
				if (typeof value?.audio !== 'string' || !value.audio) {
					throw new DoubaoApiError('豆包音频生成响应未包含 audio。', { logId });
				}
				return {
					audio: Buffer.from(value.audio, 'base64'),
					durationSeconds: value.duration,
					originalDurationSeconds: value.original_duration,
					subtitle: value.subtitle,
					requestId,
					logId,
					attempt,
				};
			} catch (error) {
				lastError = error;
				const retryable = error?.retryable || error?.name === 'TimeoutError' || error?.name === 'AbortError'
					|| error instanceof TypeError;
				if (!retryable || attempt === this.maxAttempts) break;
				await delay(1000 * (2 ** (attempt - 1)) + Math.floor(Math.random() * 300));
			}
		}
		throw lastError;
	}
}

export async function writeBufferAtomic(path, value) {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${process.pid}.${Date.now()}.tmp`;
	try {
		await writeFile(temporaryPath, value, { flag: 'wx' });
		await replaceFileAtomic(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw error;
	}
}
