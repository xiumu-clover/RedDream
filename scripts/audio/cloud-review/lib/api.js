import { authenticateReviewer, authenticateSync } from './auth.js';
import {
	nextReviewState,
	validateCloudDecision,
	validateReviewManifest,
} from './protocol.js';

const APP_ID = 'honglou-cloud-review';
const MAX_BATCH_BYTES = 2_000_000;
const MAX_AUDIO_BYTES = 32 * 1024 * 1024;

function json(body, status = 200, extraHeaders = {}) {
	return Response.json(body, {
		status,
		headers: {
			'Cache-Control': 'no-store',
			'X-Content-Type-Options': 'nosniff',
			...extraHeaders,
		},
	});
}

function safeManifest(row) {
	return validateReviewManifest(JSON.parse(row.manifest_json));
}

async function activeManifests(database) {
	const query = await database.prepare(
		'SELECT manifest_json FROM review_batches WHERE active = 1 ORDER BY published_at, chapter, scene',
	).all();
	return query.results.map(safeManifest);
}

async function decisionsForActiveBatches(database) {
	const query = await database.prepare(
		'SELECT decision_id, plan_hash, review_key, action, note, reviewer, decided_at FROM review_decisions ORDER BY decided_at, decision_id',
	).all();
	return query.results;
}

function base64Url(bytes) {
	return btoa(String.fromCharCode(...bytes))
		.replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

async function audioAccessToken(planHash, reviewKey, secret) {
	const key = await crypto.subtle.importKey(
		'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
	);
	const signature = await crypto.subtle.sign(
		'HMAC', key, new TextEncoder().encode(`${planHash}:${reviewKey}`),
	);
	return base64Url(new Uint8Array(signature));
}

function constantTimeText(left, right) {
	let difference = left.length ^ right.length;
	for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
		difference |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
	}
	return difference === 0;
}

async function publicReviewState(state, env) {
	if (!state.target) return state;
	const { objectKey: _objectKey, fileHash: _fileHash, renderHash: _renderHash, ...audio } = state.target.audio;
	const audioPath = `/api/review/audio/${state.manifest.planHash}/${state.target.reviewKey}`;
	const audioUrl = env?.REVIEWER_TOKEN
		? `${audioPath}?access=${await audioAccessToken(state.manifest.planHash, state.target.reviewKey, env.REVIEWER_TOKEN)}`
		: audioPath;
	return {
		...state,
		target: {
			...state.target,
			binding: undefined,
			audio: {
				...audio,
				url: audioUrl,
			},
		},
	};
}

export async function loadReviewState(database, env) {
	const [manifests, decisions] = await Promise.all([
		activeManifests(database),
		decisionsForActiveBatches(database),
	]);
	return publicReviewState(nextReviewState(manifests, decisions), env);
}

async function manifestForPlan(database, planHash, activeOnly = true) {
	const row = await database.prepare(
		`SELECT manifest_json FROM review_batches WHERE plan_hash = ?${activeOnly ? ' AND active = 1' : ''}`,
	).bind(planHash).first();
	return row ? safeManifest(row) : null;
}

async function readJsonBody(request, maximum = MAX_BATCH_BYTES) {
	const declared = Number(request.headers.get('Content-Length') || 0);
	if (declared > maximum) throw Object.assign(new Error('请求内容过大。'), { status: 413 });
	const text = await request.text();
	if (new TextEncoder().encode(text).byteLength > maximum) throw Object.assign(new Error('请求内容过大。'), { status: 413 });
	try {
		return JSON.parse(text);
	} catch {
		throw new Error('请求不是有效 JSON。');
	}
}

function audioObjectKey(filename) {
	if (!/^[a-f0-9]{64}\.(wav|mp3|m4a|ogg|opus)$/u.test(filename)) throw new Error('音频对象名称无效。');
	return `review-audio/v1/${filename}`;
}

async function digestHex(data) {
	return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))]
		.map((value) => value.toString(16).padStart(2, '0')).join('');
}

async function serveAudio(request, env, pathname) {
	const parts = pathname.split('/').filter(Boolean);
	if (parts.length !== 5) return json({ error: '音频地址无效。' }, 404);
	const [, , , planHash, reviewKey] = parts;
	const manifest = await manifestForPlan(env.REVIEW_DB, planHash);
	const target = manifest?.targets.find((item) => item.reviewKey === reviewKey);
	if (!target) return json({ error: '音频目标不存在或已经过期。' }, 404);
	const options = request.headers.has('Range') ? { range: request.headers } : undefined;
	const object = await env.REVIEW_AUDIO.get(target.audio.objectKey, options);
	if (!object) return json({ error: '待审音频尚未上传。' }, 404);
	const headers = new Headers({
		'Cache-Control': 'private, max-age=3600',
		'Accept-Ranges': 'bytes',
		'ETag': object.httpEtag,
		'X-Content-Type-Options': 'nosniff',
	});
	object.writeHttpMetadata(headers);
	let status = 200;
	if (object.range?.offset !== undefined && object.range?.length !== undefined) {
		status = 206;
		headers.set('Content-Range', `bytes ${object.range.offset}-${object.range.offset + object.range.length - 1}/${object.size}`);
		headers.set('Content-Length', String(object.range.length));
	} else {
		headers.set('Content-Length', String(object.size));
	}
	return new Response(object.body, { status, headers });
}

async function handleReviewerApi(context, reviewerAuth) {
	const { request, env } = context;
	const url = new URL(request.url);
	if (request.method === 'GET' && url.pathname.startsWith('/api/review/audio/') && env.REVIEWER_TOKEN) {
		const parts = url.pathname.split('/').filter(Boolean);
		const planHash = parts[3] || '';
		const reviewKey = parts[4] || '';
		const expected = await audioAccessToken(planHash, reviewKey, env.REVIEWER_TOKEN);
		if (!constantTimeText(url.searchParams.get('access') || '', expected)) {
			throw new Error('音频访问凭据无效。');
		}
		return serveAudio(request, env, url.pathname);
	}
	const reviewer = await reviewerAuth(request, env);
	if (request.method === 'GET' && url.pathname === '/api/review/state') {
		return json(await loadReviewState(env.REVIEW_DB, env));
	}
	if (request.method === 'GET' && url.pathname.startsWith('/api/review/audio/')) {
		return serveAudio(request, env, url.pathname);
	}
	if (request.method === 'POST' && url.pathname === '/api/review/decision') {
		const input = await readJsonBody(request, 8_192);
		const manifest = await manifestForPlan(env.REVIEW_DB, input.planHash);
		if (!manifest) throw Object.assign(new Error('审核批次已经更新，请刷新。'), { code: 'STALE_PLAN' });
		const decision = validateCloudDecision(input, manifest);
		await env.REVIEW_DB.prepare(
			`INSERT OR IGNORE INTO review_decisions
			(decision_id, plan_hash, review_key, target_id, action, note, reviewer, decided_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		).bind(
			decision.decisionId,
			decision.planHash,
			decision.reviewKey,
			decision.targetId,
			decision.action,
			decision.note,
			reviewer,
			new Date().toISOString(),
		).run();
		return json(await loadReviewState(env.REVIEW_DB, env));
	}
	return json({ error: '接口不存在。' }, 404);
}

async function handleSyncApi(context, syncAuth) {
	const { request, env } = context;
	const url = new URL(request.url);
	await syncAuth(request, env);
	if (url.pathname.startsWith('/api/sync/audio/')) {
		const filename = decodeURIComponent(url.pathname.slice('/api/sync/audio/'.length));
		const objectKey = audioObjectKey(filename);
		if (request.method === 'HEAD') {
			return new Response(null, { status: await env.REVIEW_AUDIO.head(objectKey) ? 204 : 404 });
		}
		if (request.method === 'PUT') {
			const declared = Number(request.headers.get('Content-Length') || 0);
			if (declared > MAX_AUDIO_BYTES) throw Object.assign(new Error('单个待审音频超过 32 MiB。'), { status: 413 });
			const data = await request.arrayBuffer();
			if (data.byteLength > MAX_AUDIO_BYTES) throw Object.assign(new Error('单个待审音频超过 32 MiB。'), { status: 413 });
			const expectedHash = filename.slice(0, 64);
			if (await digestHex(data) !== expectedHash) throw new Error('上传音频与文件哈希不一致。');
			await env.REVIEW_AUDIO.put(objectKey, data, {
				httpMetadata: { contentType: request.headers.get('Content-Type') || 'application/octet-stream' },
				customMetadata: { fileHash: expectedHash },
			});
			return json({ objectKey }, 201);
		}
	}
	if (request.method === 'POST' && url.pathname === '/api/sync/batch') {
		const manifest = validateReviewManifest(await readJsonBody(request));
		await env.REVIEW_DB.batch([
			env.REVIEW_DB.prepare(
				'UPDATE review_batches SET active = 0 WHERE chapter = ? AND scene = ?',
			).bind(manifest.chapter, manifest.scene),
			env.REVIEW_DB.prepare(
				`INSERT INTO review_batches (plan_hash, chapter, scene, manifest_json, published_at, active)
				VALUES (?, ?, ?, ?, ?, 1)
				ON CONFLICT(plan_hash) DO UPDATE SET manifest_json = excluded.manifest_json,
				published_at = excluded.published_at, active = 1`,
			).bind(
				manifest.planHash,
				manifest.chapter,
				manifest.scene,
				JSON.stringify(manifest),
				manifest.publishedAt,
			),
		]);
		return json({
			planHash: manifest.planHash,
			playableReviewCount: manifest.targets.length,
			remainingReviewCount: manifest.summary.remainingReviewCount,
		});
	}
	if (request.method === 'GET' && url.pathname === '/api/sync/export') {
		const chapter = url.searchParams.get('chapter') || '';
		const scene = url.searchParams.get('scene') || '';
		const planHash = url.searchParams.get('planHash') || '';
		const manifest = await manifestForPlan(env.REVIEW_DB, planHash, false);
		if (!manifest || manifest.chapter !== chapter || manifest.scene !== scene) return json({ error: '云端没有对应审核批次。' }, 404);
		const decisions = await env.REVIEW_DB.prepare(
			`SELECT decision_id, plan_hash, review_key, target_id, action, note, reviewer, decided_at
			FROM review_decisions WHERE plan_hash = ? ORDER BY decided_at, decision_id`,
		).bind(planHash).all();
		return json({
			version: 1,
			chapter,
			scene,
			planHash,
			decisions: decisions.results,
		});
	}
	return json({ error: '同步接口不存在。' }, 404);
}

export async function handleApiRequest(context, dependencies = {}) {
	const reviewerAuth = dependencies.authenticateReviewer || authenticateReviewer;
	const syncAuth = dependencies.authenticateSync || authenticateSync;
	try {
		if (!context.env.REVIEW_DB || !context.env.REVIEW_AUDIO) throw new Error('云审核存储尚未绑定。');
		const pathname = new URL(context.request.url).pathname;
		if (pathname === '/api/health') return json({ app: APP_ID });
		if (pathname.startsWith('/api/sync/')) return await handleSyncApi(context, syncAuth);
		if (pathname.startsWith('/api/review/')) return await handleReviewerApi(context, reviewerAuth);
		return json({ error: '接口不存在。' }, 404);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		const status = error.status || (error.code === 'STALE_PLAN' || error.code === 'STALE_TARGET' ? 409
			: /Access|凭据/u.test(message) ? 401 : 400);
		return json({ error: message }, status);
	}
}
