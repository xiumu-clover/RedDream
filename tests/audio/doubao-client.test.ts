import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DoubaoAudioGenerationClient, DoubaoTtsClient, extractJsonValues, loadDoubaoCredentials, writeBufferAtomic } from '../../scripts/audio/doubao-client.js';

test('豆包 Chunked JSON 可跨网络块解析且不丢音频', async () => {
	const parsed = extractJsonValues('{"code":0,"data":"YQ=="}\n{"code":0,"data":"Yg=="}');
	assert.equal(parsed.remainder, '');
	assert.equal(parsed.values.length, 2);
	assert.equal(parsed.values[1].data, 'Yg==');
});

test('豆包客户端发送新版鉴权头并拼接音频块', async () => {
	let captured;
	const encoder = new TextEncoder();
	const client = new DoubaoTtsClient({
		apiKey: 'private-test-key',
		endpoint: 'https://example.invalid/tts',
		resourceId: 'seed-tts-2.0',
		maxAttempts: 1,
		fetchImpl: async (url, options) => {
			captured = { url, options };
			return new Response(new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode('{"code":0,"data":"YQ==","sentence":{"text":"甲"}}'));
					controller.enqueue(encoder.encode('\n{"code":0,"data":"Yg==","usage":{"text_words":1}}'));
					controller.close();
				},
			}), { status: 200, headers: { 'X-Tt-Logid': 'log-1' } });
		},
	});
	const result = await client.synthesize({ text: '甲', speaker: 'voice', audio_params: { format: 'wav' } });
	assert.equal(result.audio.toString(), 'ab');
	assert.equal(result.logId, 'log-1');
	assert.equal(captured.options.headers['X-Api-Key'], 'private-test-key');
	assert.equal(captured.options.headers['X-Api-Resource-Id'], 'seed-tts-2.0');
	assert.equal(JSON.parse(captured.options.body).req_params.text, '甲');
});

test('豆包密钥只从环境或被忽略的本地配置读取', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'hlm-doubao-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	await assert.rejects(loadDoubaoCredentials(root, {}), /缺少豆包 API Key/u);
	const fromEnv = await loadDoubaoCredentials(root, { DOUBAO_API_KEY: 'env-key' });
	assert.equal(fromEnv.apiKey, 'env-key');
});

test('豆包音频生成客户端提交参考音频并读取字幕', async () => {
	let captured;
	const client = new DoubaoAudioGenerationClient({
		apiKey: 'private-test-key',
		endpoint: 'https://example.invalid/create',
		maxAttempts: 1,
		fetchImpl: async (url, options) => {
			captured = { url, options };
			return new Response(JSON.stringify({
				audio: Buffer.from('wav').toString('base64'),
				duration: 1.2,
				original_duration: 1.3,
				subtitle: { text: '甲' },
			}), { status: 200, headers: { 'X-Tt-Logid': 'audio-log-1' } });
		},
	});
	const result = await client.synthesize({
		model: 'seed-audio-1.0',
		text_prompt: '正文：甲',
		references: [{ audio_data: 'YQ==' }],
	});
	assert.equal(result.audio.toString(), 'wav');
	assert.equal(result.subtitle.text, '甲');
	assert.equal(result.logId, 'audio-log-1');
	assert.equal(captured.options.headers['X-Api-Key'], 'private-test-key');
	assert.equal(JSON.parse(captured.options.body).model, 'seed-audio-1.0');
});

test('豆包二进制结果使用原子替换', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'hlm-doubao-audio-'));
	context.after(() => rm(root, { recursive: true, force: true }));
	const path = join(root, 'nested', 'audio.wav');
	await writeBufferAtomic(path, Buffer.from('first'));
	await writeBufferAtomic(path, Buffer.from('second'));
	assert.equal((await readFile(path)).toString(), 'second');
});
