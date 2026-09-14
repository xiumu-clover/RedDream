import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { hashJson } from '../../scripts/audio/audio-blocks.js';
import { createPolicyDocument } from '../../scripts/audio/review-state.js';
import { createReviewServer, hostIsAllowed, LOOPBACK_HOST, originIsAllowed } from '../../scripts/audio/review-server.js';

test('审核服务只接受固定环回 Host 与同源写入', () => {
	assert.equal(LOOPBACK_HOST, '127.0.0.1');
	assert.equal(hostIsAllowed('127.0.0.1:4381', 4381), true);
	assert.equal(hostIsAllowed('localhost:4381', 4381), false);
	assert.equal(hostIsAllowed('192.168.1.5:4381', 4381), false);
	assert.equal(originIsAllowed('http://127.0.0.1:4381', 4381), true);
	assert.equal(originIsAllowed('https://evil.example', 4381), false);
});

async function freePort() {
	const probe = createNetServer();
	await new Promise((resolve, reject) => probe.listen(0, LOOPBACK_HOST, resolve).once('error', reject));
	const address = probe.address();
	await new Promise((resolve) => probe.close(resolve));
	return typeof address === 'object' && address ? address.port : 43819;
}

test('服务只提供计划登记的缓存音频，并拒绝无令牌和跨源写入', async (context) => {
	const root = await mkdtemp(join(tmpdir(), 'review-server-'));
	const cachePath = join(root, 'content', 'audio', '.cache', 'clip.wav');
	const policyPath = join(root, 'content', 'audio', 'production', 'policy.json');
	const annotations = { annotations: { a: { value: 1 } } };
	const annotationSetHash = hashJson(annotations.annotations);
	const reviewSource = {
		version: 1, chapter: '081', scene: 'xiren-three-opera',
		source: { path: 'content/chapters/081.md', fileHash: 'source' }, annotationSetHash,
		narration: { total: 1, rendered: 1, autoPassed: 1, allAutoPassed: true },
		targets: [{
			targetId: 'dialogue:081-b1:u01', kind: 'dialogue_fragment', blockId: '081-b1', unitIndex: 0,
			blockText: '一句话', unitText: '一句话', context: null, speakerRef: 'xiren', annotationSnapshot: {}, annotationHash: 'a',
			voiceCard: { id: 'xiren', fileHash: 'card' },
			audio: { cachePath: 'content/audio/.cache/clip.wav', renderHash: 'render', fileHash: 'file' },
			automaticCheck: { structuralPass: true }, technicalIssues: [], milestones: { planned: true, rendered: true, autoPassed: true }, reviewState: 'pending_review',
		}],
	};
	await mkdir(join(policyPath, '..'), { recursive: true });
	await mkdir(join(root, 'content', 'audio', 'annotations'), { recursive: true });
	await mkdir(join(root, 'content', 'audio', '.cache', 'drama', '081', 'xiren-three-opera'), { recursive: true });
	await mkdir(join(cachePath, '..'), { recursive: true });
	await Promise.all([
		writeFile(policyPath, JSON.stringify(createPolicyDocument())),
		writeFile(join(root, 'content', 'audio', 'annotations', '081.json'), JSON.stringify(annotations)),
		writeFile(join(root, 'content', 'audio', '.cache', 'drama', '081', 'xiren-three-opera', 'review-source.json'), JSON.stringify(reviewSource)),
		writeFile(cachePath, Buffer.from('RIFF-test-audio')),
	]);
	const port = await freePort();
	const token = 'test-token';
	const instance = await createReviewServer({ projectRoot: root, chapter: '081', scene: 'xiren-three-opera', port, token });
	await new Promise((resolve, reject) => instance.server.listen(port, LOOPBACK_HOST, resolve).once('error', reject));
	context.after(() => new Promise((resolve) => instance.server.close(resolve)));
	const base = `http://${LOOPBACK_HOST}:${port}`;
	assert.equal((await fetch(`${base}/api/state`)).status, 403);
	const stateResponse = await fetch(`${base}/api/state`, { headers: { 'X-Review-Token': token } });
	assert.equal(stateResponse.status, 200);
	const state = await stateResponse.json();
	const key = state.plan.targets[0].reviewKey;
	const audio = await fetch(`${base}/api/audio/${key}?token=${token}`);
	assert.equal(audio.status, 200);
	assert.equal(Buffer.from(await audio.arrayBuffer()).toString(), 'RIFF-test-audio');
	const denied = await fetch(`${base}/api/action`, { method: 'POST', headers: { Origin: 'https://evil.example', 'X-Review-Token': token, 'Content-Type': 'application/json' }, body: '{}' });
	assert.equal(denied.status, 403);
});
