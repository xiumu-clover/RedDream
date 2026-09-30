import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { authenticateReviewer, verifyAccessToken } from '../../scripts/audio/cloud-review/lib/auth.js';
import { handleApiRequest } from '../../scripts/audio/cloud-review/lib/api.js';
import {
	buildCloudReviewBatch,
	nextReviewState,
	validateCloudDecision,
	validateReviewManifest,
} from '../../scripts/audio/cloud-review/lib/protocol.js';

function target(overrides = {}) {
	return {
		reviewKey: 'a'.repeat(64),
		targetId: 'dialogue:081-b1:u01',
		kind: 'dialogue_fragment',
		blockId: '081-b1',
		unitIndex: 0,
		speakerRef: '袭人',
		blockText: '这一句完整正文。',
		unitText: '一句完整正文',
		context: null,
		milestones: { autoPassed: true },
		audio: {
			cachePath: `content/audio/.cache/${'b'.repeat(64)}.wav`,
			fileHash: 'b'.repeat(64),
			renderHash: 'c'.repeat(64),
			durationSeconds: 2.5,
		},
		...overrides,
	};
}

function bundle() {
	const pending = target();
	const approved = target({ reviewKey: 'd'.repeat(64), targetId: 'dialogue:081-b2:u01' });
	const planned = target({ reviewKey: 'e'.repeat(64), targetId: 'dialogue:081-b3:u01', audio: null, milestones: { autoPassed: false } });
	return {
		plan: { chapter: '081', scene: 'xiren-three-opera', planHash: 'f'.repeat(64), targets: [pending, approved, planned] },
		approvals: { records: [
			{ reviewKey: pending.reviewKey, status: 'pending_review', binding: { fileHash: pending.audio.fileHash } },
			{ reviewKey: approved.reviewKey, status: 'approved', binding: { fileHash: approved.audio.fileHash } },
			{ reviewKey: planned.reviewKey, status: 'planned', binding: { fileHash: null } },
		] },
		status: { counts: { dialogueTargets: 3, remainingReviewCount: 2, byStatus: { approved: 1, planned: 1 } } },
	};
}

test('云批次只上传当前可试听且尚未决定的精确哈希版本', () => {
	const result = buildCloudReviewBatch(bundle(), '2026-09-17T00:00:00.000Z');
	assert.equal(result.manifest.targets.length, 1);
	assert.equal(result.uploads.length, 1);
	assert.equal(result.manifest.targets[0].reviewKey, 'a'.repeat(64));
	assert.equal(result.manifest.targets[0].speakerLabel, '袭人');
	assert.equal(result.manifest.targets[0].audio.objectKey, `review-audio/v1/${'b'.repeat(64)}.wav`);
	assert.equal(result.manifest.summary.alreadyApproved, 1);
	assert.equal(result.manifest.summary.waitingForRender, 1);
	assert.equal(validateReviewManifest(result.manifest), result.manifest);
});

test('手机审核只接受通过或带意见的重录，并拒绝过期批次', () => {
	const manifest = buildCloudReviewBatch(bundle()).manifest;
	const base = { planHash: manifest.planHash, reviewKey: manifest.targets[0].reviewKey, decisionId: 'decision-123456789' };
	assert.equal(validateCloudDecision({ ...base, action: 'approve' }, manifest).action, 'approve');
	assert.equal(validateCloudDecision({ ...base, action: 'rerecord', note: '语气太急，请更委屈。' }, manifest).note, '语气太急，请更委屈。');
	assert.throws(() => validateCloudDecision({ ...base, action: 'rerecord', note: '' }, manifest), /填写简短意见/u);
	assert.throws(() => validateCloudDecision({ ...base, action: 'reject' }, manifest), /只支持/u);
	assert.throws(() => validateCloudDecision({ ...base, action: 'approve', planHash: '0'.repeat(64) }, manifest), /已经更新/u);
});

test('队列按决定历史计算剩余数量并返回下一条', () => {
	const manifest = buildCloudReviewBatch(bundle()).manifest;
	const empty = nextReviewState([manifest], []);
	assert.equal(empty.remaining, 1);
	assert.equal(empty.target.reviewKey, manifest.targets[0].reviewKey);
	const done = nextReviewState([manifest], [{ plan_hash: manifest.planHash, review_key: manifest.targets[0].reviewKey }]);
	assert.equal(done.remaining, 0);
	assert.equal(done.target, null);
	assert.equal(done.summary.waitingForRender, 1);
});

function base64Url(value) {
	return Buffer.from(value).toString('base64url');
}

test('Access JWT 必须验证签名、签发者、受众和有效期', async () => {
	const pair = await crypto.subtle.generateKey(
		{ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
		true,
		['sign', 'verify'],
	);
	const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
	jwk.kid = 'test-key';
	jwk.alg = 'RS256';
	const header = base64Url(JSON.stringify({ alg: 'RS256', kid: jwk.kid }));
	const payload = base64Url(JSON.stringify({
		iss: 'https://example.cloudflareaccess.com', aud: ['review-aud'],
		exp: Math.floor(Date.now() / 1000) + 300, email: 'owner@example.com',
	}));
	const input = `${header}.${payload}`;
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', pair.privateKey, new TextEncoder().encode(input));
	const token = `${input}.${Buffer.from(signature).toString('base64url')}`;
	const verified = await verifyAccessToken(token, {
		ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'review-aud',
	}, async () => Response.json({ keys: [jwk] }));
	assert.equal(verified.email, 'owner@example.com');
	await assert.rejects(() => verifyAccessToken(token, {
		ACCESS_TEAM_DOMAIN: 'https://example.cloudflareaccess.com', ACCESS_AUD: 'wrong-aud',
	}, async () => Response.json({ keys: [jwk] })), /声明无效/u);
});

test('加密评审链接使用独立令牌保护状态、决定和音频接口', async () => {
	const env = { REVIEWER_TOKEN: 'review-secret' };
	assert.equal(await authenticateReviewer(new Request('https://review.example', {
		headers: { Authorization: 'Bearer review-secret' },
	}), env), 'project-owner');
	await assert.rejects(() => authenticateReviewer(new Request('https://review.example', {
		headers: { Authorization: 'Bearer wrong-secret' },
	}), env), /评审链接凭据无效/u);
});

test('云页面保持极简，本地审核服务已经移除', async () => {
	const root = process.cwd();
	const html = await readFile(join(root, 'scripts', 'audio', 'cloud-review', 'public', 'index.html'), 'utf8');
	assert.match(html, /id="approve"/u);
	assert.match(html, /id="rerecord"/u);
	assert.doesNotMatch(html, /id="reject"|issue-filter|voice-audio/u);
	const app = await readFile(join(root, 'scripts', 'audio', 'cloud-review', 'public', 'app.js'), 'utf8');
	assert.match(app, /location\.hash/u);
	assert.match(app, /Authorization:`Bearer/u);
	assert.match(app, /audio'\)\.src=target\.audio\.url/u);
	await assert.rejects(() => stat(join(root, 'review_audio.bat')), (error) => error.code === 'ENOENT');
	await assert.rejects(() => stat(join(root, 'scripts', 'audio', 'review-server.js')), (error) => error.code === 'ENOENT');
});

class FakeStatement {
	database;
	sql;
	values = [];
	constructor(database, sql) { this.database = database; this.sql = sql.replace(/\s+/gu, ' ').trim(); }
	bind(...values) { this.values = values; return this; }
	async all() {
		if (this.sql.startsWith('SELECT manifest_json FROM review_batches WHERE active = 1')) {
			return { results: [...this.database.batches.values()].filter((row) => row.active).map((row) => ({ manifest_json: row.manifest_json })) };
		}
		if (this.sql.includes('FROM review_decisions WHERE plan_hash = ?')) {
			return { results: this.database.decisions.filter((row) => row.plan_hash === this.values[0]) };
		}
		if (this.sql.includes('FROM review_decisions ORDER BY')) return { results: [...this.database.decisions] };
		throw new Error(`FakeD1 未实现 all: ${this.sql}`);
	}
	async first() {
		if (this.sql.startsWith('SELECT manifest_json FROM review_batches WHERE plan_hash = ?')) {
			const row = this.database.batches.get(this.values[0]);
			if (!row || (this.sql.includes('active = 1') && !row.active)) return null;
			return { manifest_json: row.manifest_json };
		}
		throw new Error(`FakeD1 未实现 first: ${this.sql}`);
	}
	async run() {
		if (this.sql.startsWith('UPDATE review_batches SET active = 0')) {
			for (const row of this.database.batches.values()) {
				if (row.chapter === this.values[0] && row.scene === this.values[1]) row.active = 0;
			}
			return { success: true };
		}
		if (this.sql.startsWith('INSERT INTO review_batches')) {
			const [plan_hash, chapter, scene, manifest_json, published_at] = this.values;
			this.database.batches.set(plan_hash, { plan_hash, chapter, scene, manifest_json, published_at, active: 1 });
			return { success: true };
		}
		if (this.sql.startsWith('INSERT OR IGNORE INTO review_decisions')) {
			const [decision_id, plan_hash, review_key, target_id, action, note, reviewer, decided_at] = this.values;
			if (!this.database.decisions.some((row) => row.decision_id === decision_id)) {
				this.database.decisions.push({ decision_id, plan_hash, review_key, target_id, action, note, reviewer, decided_at });
			}
			return { success: true };
		}
		throw new Error(`FakeD1 未实现 run: ${this.sql}`);
	}
}

class FakeD1 {
	batches = new Map();
	decisions = [];
	prepare(sql) { return new FakeStatement(this, sql); }
	async batch(statements) { return Promise.all(statements.map((statement) => statement.run())); }
}

class FakeR2 {
	objects = new Map();
	async head(key) { return this.objects.has(key) ? { key } : null; }
	async put(key, data, options) { this.objects.set(key, { data: Buffer.from(data), options }); }
	async get(key) {
		const stored = this.objects.get(key);
		if (!stored) return null;
		return {
			body: stored.data,
			size: stored.data.length,
			httpEtag: '"test"',
			writeHttpMetadata(headers) { headers.set('Content-Type', stored.options.httpMetadata.contentType); },
		};
	}
}

function context(url, env, options = {}) {
	return { request: new Request(url, options), env };
}

test('云 API 完成音频上传、批次发布、手机决定和同步导出', async () => {
	const audio = Buffer.from('RIFF-cloud-review-test');
	const fileHash = createHash('sha256').update(audio).digest('hex');
	const data = bundle();
	data.plan.targets[0].audio.fileHash = fileHash;
	data.approvals.records[0].binding.fileHash = fileHash;
	const manifest = buildCloudReviewBatch(data, '2026-09-17T00:00:00.000Z').manifest;
	const env = { REVIEW_DB: new FakeD1(), REVIEW_AUDIO: new FakeR2(), REVIEWER_TOKEN: 'review-secret' };
	const dependencies = {
		authenticateSync: async () => 'sync',
		authenticateReviewer: async () => 'owner@example.com',
	};
	const filename = manifest.targets[0].audio.objectKey.split('/').at(-1);
	let response = await handleApiRequest(context(`https://review.example/api/sync/audio/${filename}`, env, {
		method: 'PUT', body: audio, headers: { 'Content-Type': 'audio/wav' },
	}), dependencies);
	assert.equal(response.status, 201);
	response = await handleApiRequest(context('https://review.example/api/sync/batch', env, {
		method: 'POST', body: JSON.stringify(manifest), headers: { 'Content-Type': 'application/json' },
	}), dependencies);
	assert.equal(response.status, 200);
	response = await handleApiRequest(context('https://review.example/api/review/state', env), dependencies);
	let state = await response.json();
	assert.equal(state.remaining, 1);
	assert.equal(state.target.reviewKey, manifest.targets[0].reviewKey);
	assert.match(state.target.audio.url, /\?access=/u);
	response = await handleApiRequest(context(`https://review.example${state.target.audio.url}`, env), dependencies);
	assert.equal(response.status, 200);
	response = await handleApiRequest(context('https://review.example/api/review/decision', env, {
		method: 'POST',
		body: JSON.stringify({
			decisionId: 'decision-cloud-test-01',
			planHash: manifest.planHash,
			reviewKey: manifest.targets[0].reviewKey,
			action: 'approve',
		}),
		headers: { 'Content-Type': 'application/json' },
	}), dependencies);
	state = await response.json();
	assert.equal(state.remaining, 0);
	response = await handleApiRequest(context(`https://review.example/api/sync/export?chapter=081&scene=xiren-three-opera&planHash=${manifest.planHash}`, env), dependencies);
	const exported = await response.json();
	assert.equal(exported.decisions.length, 1);
	assert.equal(exported.decisions[0].action, 'approve');
});
