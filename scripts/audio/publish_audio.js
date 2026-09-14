#!/usr/bin/env node

import { copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJsonIfExists } from './files.js';
import { inspectAudioArtifact } from './track.js';

const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));
const AUDIO_CONTENT_DIRECTORY = join(PROJECT_ROOT, 'content', 'audio');
const CACHE_TRACK_DIRECTORY = join(AUDIO_CONTENT_DIRECTORY, '.cache', 'tracks');
const PUBLIC_AUDIO_DIRECTORY = join(PROJECT_ROOT, 'public', 'audio');
const CONFIG_PATH = join(AUDIO_CONTENT_DIRECTORY, 'config.json');
const MAP_DIRECTORY = join(AUDIO_CONTENT_DIRECTORY, 'maps');
const MANIFEST_PATH = join(PUBLIC_AUDIO_DIRECTORY, 'manifest.json');
const MAX_PAGES_ASSET_BYTES = 25 * 1024 * 1024;

class PublishInputError extends Error {}

function projectRelative(path) {
	return relative(PROJECT_ROOT, path).replaceAll('\\', '/');
}

function normalizeChapterNumber(input, config) {
	const value = String(input || '').trim();
	const number = Number(value);
	if (!/^\d{1,3}$/u.test(value) || !Number.isInteger(number)
		|| number < config.chapterRange.min || number > config.chapterRange.max) {
		throw new PublishInputError(
			`请输入第 ${config.chapterRange.min} 至 ${config.chapterRange.max} 回的有效编号。`,
		);
	}
	return String(number).padStart(3, '0');
}

function localTrackPath(localPath) {
	if (typeof localPath !== 'string' || !localPath) throw new Error('音频 map 缺少 localPath。');
	const path = resolve(PROJECT_ROOT, localPath);
	const escaped = relative(CACHE_TRACK_DIRECTORY, path);
	if (escaped.startsWith('..') || isAbsolute(escaped)) {
		throw new Error(`音频 map 的本地路径超出缓存目录：${localPath}`);
	}
	return path;
}

async function verifyTrack(variant, output) {
	if (!output?.trackHash || !output?.fileHash) {
		throw new Error(`${variant} 整轨记录缺少 trackHash 或 fileHash，请先运行 generate_audio.bat。`);
	}
	const path = localTrackPath(output.localPath);
	let artifact;
	try {
		artifact = await inspectAudioArtifact(path);
	} catch (error) {
		if (error?.code === 'ENOENT') throw new Error(`${variant} 整轨文件不存在，请先重新生成。`);
		throw error;
	}
	if (artifact.fileHash !== output.fileHash) {
		throw new Error(`${variant} 整轨文件 hash 与 map 不一致，请重新生成。`);
	}
	if (artifact.bytes >= MAX_PAGES_ASSET_BYTES) {
		throw new Error(
			`${variant} 整轨为 ${(artifact.bytes / 1024 / 1024).toFixed(2)} MiB，达到或超过 Pages 25 MiB 单文件上限，禁止发布。`,
		);
	}
	return { path, ...artifact, trackHash: output.trackHash };
}

function migrateManifest(manifest) {
	if (!manifest) return { version: 2, chapters: {} };
	if (manifest.version === 2 && manifest.chapters && typeof manifest.chapters === 'object') {
		return manifest;
	}
	if (manifest.version !== 1 || !manifest.chapters || typeof manifest.chapters !== 'object') {
		throw new Error('public/audio/manifest.json 的格式无效。');
	}
	const chapters = {};
	for (const [chapterId, entry] of Object.entries(manifest.chapters)) {
		chapters[chapterId] = {
			defaultVariant: 'female',
			variants: {
				female: {
					url: entry.path || `/audio/${chapterId}.mp3`,
					trackHash: entry.buildHash,
					fileHash: entry.fileHash,
					bytes: entry.bytes,
					durationSeconds: entry.durationSeconds,
				},
			},
			legacy: entry,
		};
	}
	return { version: 2, chapters };
}

async function installAtomically(items) {
	const transaction = `${process.pid}-${Date.now()}`;
	const installed = [];
	try {
		for (const item of items) {
			const backupPath = `${item.destination}.previous-${transaction}`;
			let hadPrevious = false;
			try {
				await rename(item.destination, backupPath);
				hadPrevious = true;
			} catch (error) {
				if (error?.code !== 'ENOENT') throw error;
			}
			installed.push({ ...item, backupPath, hadPrevious });
			await rename(item.staged, item.destination);
		}
	} catch (error) {
		for (const item of installed.reverse()) {
			await rm(item.destination, { force: true });
			if (item.hadPrevious) await rename(item.backupPath, item.destination);
		}
		await Promise.all(items.map(({ staged }) => rm(staged, { force: true })));
		throw error;
	}
	await Promise.allSettled(installed.map(({ backupPath }) => rm(backupPath, { force: true })));
}

async function main() {
	const config = await readJsonIfExists(CONFIG_PATH);
	const narratorVariants = config?.narratorProfiles && typeof config.narratorProfiles === 'object'
		? Object.keys(config.narratorProfiles)
		: [];
	if (Number(config?.version) !== 1 || !config.chapterRange
		|| !Array.isArray(config.publishAllowlist)
		|| narratorVariants.length !== 1
		|| !config.narratorProfiles?.[config.defaultVariant]) {
		throw new Error('content/audio/config.json 的发布配置无效。');
	}
	const chapterId = normalizeChapterNumber(process.argv[2], config);
	if (!config.publishAllowlist.includes(chapterId)) {
		throw new PublishInputError(
			`第 ${Number(chapterId)} 回尚未加入 Pages 发布白名单；当前只允许：${config.publishAllowlist.join('、')}。`,
		);
	}
	const checkOnly = process.argv.includes('--check');
	const confirmed = process.argv.includes('--yes');
	if (!checkOnly && !confirmed) {
		throw new PublishInputError('发布会修改 public/audio；请先使用 --check，确认后再使用 --yes。');
	}

	const map = await readJsonIfExists(join(MAP_DIRECTORY, `${chapterId}.json`));
	if (Number(map?.version) !== 1 || map.chapter !== chapterId || !map.outputs) {
		throw new Error(`找不到有效的 content/audio/maps/${chapterId}.json，请先生成旁白整轨。`);
	}
	const variant = narratorVariants[0];
	const label = config.narratorProfiles[variant].label || '旁白';
	const track = await verifyTrack(label, map.outputs[variant]);

	console.log(`第 ${Number(chapterId)} 回发布检查通过：`);
	console.log(`${label}：${(track.bytes / 1024 / 1024).toFixed(2)} MiB，${Math.round(track.durationSeconds / 60)} 分钟，${track.trackHash.slice(0, 12)}`);
	if (checkOnly) return;

	await mkdir(PUBLIC_AUDIO_DIRECTORY, { recursive: true });
	const transaction = `${process.pid}-${Date.now()}`;
	const trackDestination = join(PUBLIC_AUDIO_DIRECTORY, `${chapterId}.mp3`);
	const trackStaged = `${trackDestination}.${transaction}.tmp`;
	const manifestStaged = `${MANIFEST_PATH}.${transaction}.tmp`;
	try {
		await copyFile(track.path, trackStaged);

		const manifest = migrateManifest(await readJsonIfExists(MANIFEST_PATH));
		manifest.chapters[chapterId] = {
			source: map.source,
			sourceSpeechHash: map.sourceSpeechHash,
			defaultVariant: variant,
			variants: {
				[variant]: {
					url: `/audio/${chapterId}.mp3`,
					trackHash: track.trackHash,
					fileHash: track.fileHash,
					bytes: track.bytes,
					durationSeconds: track.durationSeconds,
				},
			},
			publishedAt: new Date().toISOString(),
		};
		await writeFile(manifestStaged, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

		await installAtomically([
			{ staged: trackStaged, destination: trackDestination },
			{ staged: manifestStaged, destination: MANIFEST_PATH },
		]);
	} catch (error) {
		await Promise.allSettled([trackStaged, manifestStaged].map((path) => rm(path, { force: true })));
		throw new Error(`发布失败，已尝试恢复旧文件：${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}

	console.log(`发布完成：${projectRelative(trackDestination)}`);
	console.log(`清单已更新：${projectRelative(MANIFEST_PATH)}`);
}

main().catch((error) => {
	console.error(`\n[错误] ${error instanceof Error ? error.message : String(error)}`);
	if (process.env.TTS_DEBUG === '1' && error instanceof Error) console.error(error.stack);
	process.exitCode = error instanceof PublishInputError ? 2 : 1;
});
