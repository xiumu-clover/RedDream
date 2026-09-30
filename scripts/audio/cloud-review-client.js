import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJsonIfExists } from './files.js';

export const CLOUD_REVIEW_CONFIG_PATH = join(
	'content', 'audio', '.cache', 'cloud-review', 'config.json',
);

export async function loadCloudReviewConfig(projectRoot) {
	const saved = await readJsonIfExists(join(projectRoot, CLOUD_REVIEW_CONFIG_PATH));
	const config = {
		baseUrl: process.env.CLOUD_REVIEW_URL || saved?.baseUrl,
		accessClientId: process.env.CLOUDFLARE_ACCESS_CLIENT_ID || saved?.accessClientId,
		accessClientSecret: process.env.CLOUDFLARE_ACCESS_CLIENT_SECRET || saved?.accessClientSecret,
		syncToken: process.env.CLOUD_REVIEW_SYNC_TOKEN || saved?.syncToken,
	};
	if (!config.baseUrl || !config.syncToken) {
		throw new Error(`缺少云评审配置。请在 ${CLOUD_REVIEW_CONFIG_PATH.replaceAll('\\', '/')} 保存 baseUrl 和 syncToken。`);
	}
	const url = new URL(config.baseUrl);
	if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
		throw new Error('云评审 baseUrl 必须是没有查询参数的 HTTPS 地址。');
	}
	config.baseUrl = url.href.replace(/\/$/u, '');
	return config;
}

function syncHeaders(config, extra = {}) {
	return {
		Authorization: `Bearer ${config.syncToken}`,
		...(config.accessClientId ? { 'CF-Access-Client-Id': config.accessClientId } : {}),
		...(config.accessClientSecret ? { 'CF-Access-Client-Secret': config.accessClientSecret } : {}),
		...extra,
	};
}

export async function cloudReviewRequest(config, path, options = {}) {
	const response = await fetch(`${config.baseUrl}${path}`, {
		...options,
		headers: syncHeaders(config, options.headers),
	});
	if (response.ok) return response;
	let message = `云评审请求失败 ${response.status}`;
	try {
		message = (await response.json()).error || message;
	} catch {}
	throw Object.assign(new Error(message), { status: response.status });
}

export async function uploadReviewAudio(config, upload, absolutePath) {
	const filename = upload.objectKey.split('/').at(-1);
	const path = `/api/sync/audio/${encodeURIComponent(filename)}`;
	const existing = await fetch(`${config.baseUrl}${path}`, {
		method: 'HEAD',
		headers: syncHeaders(config),
	});
	if (existing.ok) return false;
	if (existing.status !== 404) {
		let message = `检查云端音频失败 ${existing.status}`;
		try { message = (await existing.json()).error || message; } catch {}
		throw new Error(message);
	}
	const data = await readFile(absolutePath);
	await cloudReviewRequest(config, path, {
		method: 'PUT',
		body: data,
		headers: { 'Content-Type': upload.contentType, 'Content-Length': String(data.length) },
	});
	return true;
}
