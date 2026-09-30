import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildCloudReviewBatch } from './cloud-review/lib/protocol.js';
import { cloudReviewRequest, loadCloudReviewConfig, uploadReviewAudio } from './cloud-review-client.js';
import { sha256File } from './files.js';
import { loadOrBuildReviewSource } from './review-source.js';
import { resolveCachePath, syncSceneProduction } from './review-state.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

function argumentsFor(argv) {
	const options = { chapter: '081', scene: 'xiren-three-opera' };
	for (let index = 0; index < argv.length; index += 2) {
		const name = argv[index]?.replace(/^--/u, '');
		const value = argv[index + 1];
		if (!['chapter', 'scene'].includes(name) || !value) throw new Error(`无法识别参数 ${argv[index] || ''}。`);
		options[name] = value;
	}
	options.chapter = String(options.chapter).padStart(3, '0');
	if (!/^\d{3}$/u.test(options.chapter) || !/^[a-z0-9-]+$/u.test(options.scene)) throw new Error('回目或场景参数无效。');
	return options;
}

async function mapConcurrent(values, limit, operation) {
	const results = [];
	let cursor = 0;
	async function worker() {
		while (cursor < values.length) {
			const index = cursor++;
			results[index] = await operation(values[index], index);
		}
	}
	await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
	return results;
}

export async function pushCloudReview({ projectRoot = PROJECT_ROOT, ...options } = {}) {
	const config = await loadCloudReviewConfig(projectRoot);
	const reviewSource = await loadOrBuildReviewSource({ projectRoot, chapter: options.chapter, scene: options.scene });
	const bundle = await syncSceneProduction({ projectRoot, reviewSource });
	const { manifest, uploads } = buildCloudReviewBatch(bundle);
	const uploaded = await mapConcurrent(uploads, 4, async (upload) => {
		const path = resolveCachePath(projectRoot, upload.cachePath);
		if (await sha256File(path) !== upload.fileHash) throw new Error(`本地待审文件哈希已变化：${upload.cachePath}`);
		return uploadReviewAudio(config, upload, path);
	});
	await cloudReviewRequest(config, '/api/sync/batch', {
		method: 'POST',
		body: JSON.stringify(manifest),
		headers: { 'Content-Type': 'application/json' },
	});
	return {
		planHash: manifest.planHash,
		playableReviewCount: manifest.targets.length,
		remainingReviewCount: manifest.summary.remainingReviewCount,
		uploadedCount: uploaded.filter(Boolean).length,
		reusedCount: uploaded.filter((value) => !value).length,
	};
}

async function main() {
	const result = await pushCloudReview(argumentsFor(process.argv.slice(2)));
	console.log(`云评审批次：${result.planHash}`);
	console.log(`可试听 ${result.playableReviewCount} 条；新上传 ${result.uploadedCount} 条；复用 ${result.reusedCount} 条。`);
	console.log(`当前仍未批准：${result.remainingReviewCount} 条。`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
	main().catch((error) => {
		console.error(`[云评审上传失败] ${error instanceof Error ? error.message : String(error)}`);
		process.exitCode = 1;
	});
}
