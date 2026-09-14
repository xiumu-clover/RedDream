import { randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import {
	loadProductionBundle,
	resolveCachePath,
	saveReviewAction,
	syncSceneProduction,
} from './review-state.js';
import { loadOrBuildReviewSource } from './review-source.js';

export const LOOPBACK_HOST = '127.0.0.1';
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const UI_ROOT = fileURLToPath(new URL('./review-ui/', import.meta.url));
const MAX_BODY_BYTES = 32 * 1024;

function parseArguments(argv) {
	const options = { chapter: '081', scene: 'xiren-three-opera', port: '4381' };
	const flags = new Set(['open', 'sync-only']);
	for (let index = 0; index < argv.length; index += 1) {
		const part = argv[index];
		if (!part.startsWith('--')) throw new Error(`无法识别参数 ${part}。`);
		const [name, inline] = part.slice(2).split('=', 2);
		if (flags.has(name) && inline === undefined) {
			options[name] = true;
			continue;
		}
		const value = inline ?? argv[++index];
		if (!value || value.startsWith('--')) throw new Error(`参数 --${name} 缺少值。`);
		options[name] = value;
	}
	const chapter = String(options.chapter).padStart(3, '0');
	const scene = String(options.scene);
	const port = Number(options.port);
	if (!/^\d{3}$/u.test(chapter)) throw new Error('chapter 必须是三位回目编号。');
	if (!/^[a-z0-9-]+$/u.test(scene)) throw new Error('scene 只能包含小写字母、数字和连字符。');
	if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('port 必须在 1024–65535 之间。');
	return { chapter, scene, port, open: options.open === true, syncOnly: options['sync-only'] === true };
}

function jsonResponse(response, status, body) {
	const data = Buffer.from(JSON.stringify(body));
	response.writeHead(status, {
		'Content-Type': 'application/json; charset=utf-8',
		'Content-Length': data.length,
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	});
	response.end(data);
}

function effectiveRecords(bundle) {
	const records = new Map(bundle.approvals.records.map((record) => [record.reviewKey, record]));
	return bundle.plan.targets.map((target) => ({
		...target,
		decision: records.get(target.reviewKey) || null,
		effectiveStatus: records.get(target.reviewKey)?.status || target.reviewState,
	}));
}

function publicState(bundle) {
	return {
		policy: bundle.policy,
		plan: { ...bundle.plan, targets: effectiveRecords(bundle) },
		status: bundle.status,
	};
}

function contentType(path) {
	return ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' })[extname(path)]
		|| 'application/octet-stream';
}

async function readBody(request) {
	const parts = [];
	let size = 0;
	for await (const part of request) {
		size += part.length;
		if (size > MAX_BODY_BYTES) throw Object.assign(new Error('请求内容过大。'), { status: 413 });
		parts.push(part);
	}
	try {
		return JSON.parse(Buffer.concat(parts).toString('utf8'));
	} catch {
		throw Object.assign(new Error('请求不是有效 JSON。'), { status: 400 });
	}
}

export function hostIsAllowed(host, port) {
	return host === `${LOOPBACK_HOST}:${port}`;
}

export function originIsAllowed(origin, port) {
	return origin === `http://${LOOPBACK_HOST}:${port}`;
}

function bearerToken(request, url) {
	return request.headers['x-review-token'] || url.searchParams.get('token');
}

async function sendAudio(response, path, rangeHeader) {
	const info = await stat(path);
	let start = 0;
	let end = info.size - 1;
	let status = 200;
	if (rangeHeader) {
		const match = /^bytes=(\d*)-(\d*)$/u.exec(rangeHeader);
		if (!match) return jsonResponse(response, 416, { error: '无效 Range。' });
		start = match[1] ? Number(match[1]) : 0;
		end = match[2] ? Number(match[2]) : end;
		if (start > end || end >= info.size) return jsonResponse(response, 416, { error: 'Range 超出文件。' });
		status = 206;
	}
	response.writeHead(status, {
		'Content-Type': extname(path).toLowerCase() === '.mp3' ? 'audio/mpeg' : 'audio/wav',
		'Accept-Ranges': 'bytes',
		'Content-Length': end - start + 1,
		...(status === 206 ? { 'Content-Range': `bytes ${start}-${end}/${info.size}` } : {}),
		'Cache-Control': 'private, max-age=3600',
		'X-Content-Type-Options': 'nosniff',
	});
	createReadStream(path, { start, end }).pipe(response);
}

export async function initializeProduction(projectRoot, chapter, scene) {
	const reviewSource = await loadOrBuildReviewSource({ projectRoot, chapter, scene });
	return syncSceneProduction({ projectRoot, reviewSource });
}

export async function createReviewServer({
	projectRoot = PROJECT_ROOT,
	chapter = '081',
	scene = 'xiren-three-opera',
	port = 4381,
	token = randomBytes(24).toString('hex'),
} = {}) {
	await initializeProduction(projectRoot, chapter, scene);
	let mutationQueue = Promise.resolve();
	const queueMutation = (operation) => {
		const next = mutationQueue.then(operation, operation);
		mutationQueue = next.catch(() => {});
		return next;
	};
	const server = http.createServer(async (request, response) => {
		try {
			if (!hostIsAllowed(request.headers.host, port)) return jsonResponse(response, 400, { error: '拒绝非环回 Host。' });
			const url = new URL(request.url, `http://${LOOPBACK_HOST}:${port}`);
			if (request.method === 'GET' && ['/', '/app.js', '/styles.css'].includes(url.pathname)) {
				const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
				const data = await readFile(join(UI_ROOT, file));
				response.writeHead(200, {
					'Content-Type': contentType(file),
					'Content-Length': data.length,
					'Cache-Control': 'no-store',
					'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self'; connect-src 'self'; img-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
					'X-Content-Type-Options': 'nosniff',
				});
				return response.end(data);
			}
			if (bearerToken(request, url) !== token) return jsonResponse(response, 403, { error: '审核令牌无效。' });
			if (request.method === 'GET' && url.pathname === '/api/state') {
				return jsonResponse(response, 200, publicState(await loadProductionBundle(projectRoot, chapter, scene)));
			}
			if (request.method === 'GET' && url.pathname.startsWith('/api/audio/')) {
				const reviewKey = decodeURIComponent(url.pathname.slice('/api/audio/'.length));
				const kind = url.searchParams.get('kind') || 'fragment';
				const bundle = await loadProductionBundle(projectRoot, chapter, scene);
				const target = bundle.plan.targets.find((item) => item.reviewKey === reviewKey);
				if (!target) return jsonResponse(response, 404, { error: '音频目标不存在或已过期。' });
				const relativePath = kind === 'voice-card' ? target.voiceCard?.cachePath : target.audio?.cachePath;
				if (!relativePath) return jsonResponse(response, 404, { error: '当前目标没有该音频。' });
				return sendAudio(response, resolveCachePath(projectRoot, relativePath), request.headers.range);
			}
			if (request.method === 'POST' && ['/api/action', '/api/refresh'].includes(url.pathname)) {
				if (!originIsAllowed(request.headers.origin, port)) return jsonResponse(response, 403, { error: '拒绝跨源写入。' });
				if (url.pathname === '/api/refresh') {
					const bundle = await queueMutation(() => initializeProduction(projectRoot, chapter, scene));
					return jsonResponse(response, 200, publicState(bundle));
				}
				const body = await readBody(request);
				const bundle = await queueMutation(() => saveReviewAction({ projectRoot, chapter, scene, ...body }));
				return jsonResponse(response, 200, publicState(bundle));
			}
			return jsonResponse(response, 404, { error: '接口不存在。' });
		} catch (error) {
			const status = error.code === 'STALE_PLAN' || error.code === 'STALE_TARGET' ? 409 : error.status || 400;
			return jsonResponse(response, status, { error: error instanceof Error ? error.message : String(error) });
		}
	});
	return { server, token, url: `http://${LOOPBACK_HOST}:${port}/?token=${token}` };
}

async function main() {
	const options = parseArguments(process.argv.slice(2));
	if (options.syncOnly) {
		const result = await initializeProduction(PROJECT_ROOT, options.chapter, options.scene);
		console.log(`审核状态已同步：${result.paths.status}`);
		console.log(`待处理对白：${result.status.counts.remainingReviewCount}`);
		return;
	}
	const instance = await createReviewServer(options);
	await new Promise((resolve, reject) => {
		instance.server.once('error', reject);
		instance.server.listen(options.port, LOOPBACK_HOST, resolve);
	});
	console.log(`对白审核台已启动：${instance.url}`);
	console.log('关闭此窗口即可停止服务。');
	if (options.open && process.platform === 'win32') {
		const child = spawn('explorer.exe', [instance.url], { detached: true, stdio: 'ignore', windowsHide: true });
		child.unref();
	}
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(`[审核台错误] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
