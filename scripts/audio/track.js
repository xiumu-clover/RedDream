import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { hashJson } from './audio-blocks.js';
import { sha256File } from './files.js';
import { inspectMp3File } from './mp3.js';

export const TRACK_ASSEMBLER_VERSION = 'mp3-frame-concat-v1';

export async function inspectAudioArtifact(path) {
	const [audio, fileHash] = await Promise.all([
		inspectMp3File(path),
		sha256File(path),
	]);
	return { ...audio, fileHash };
}

export async function getValidCachedAudio(path, expectedFileHash) {
	try {
		const artifact = await inspectAudioArtifact(path);
		if (expectedFileHash && artifact.fileHash !== expectedFileHash) return undefined;
		return artifact;
	} catch (error) {
		if (error?.code === 'ENOENT') return undefined;
		return undefined;
	}
}

export function trackHashForFragments(renderHashes) {
	return hashJson({ version: TRACK_ASSEMBLER_VERSION, renderHashes });
}

export async function assembleMp3Track(fragmentPaths, outputPath) {
	if (!Array.isArray(fragmentPaths) || fragmentPaths.length === 0) {
		throw new Error('整轨拼接缺少音频片段。');
	}
	await mkdir(dirname(outputPath), { recursive: true });
	const temporaryPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
	try {
		const buffers = [];
		for (const path of fragmentPaths) buffers.push(await readFile(path));
		await writeFile(temporaryPath, Buffer.concat(buffers), { flag: 'wx' });
		const artifact = await inspectAudioArtifact(temporaryPath);
		await rm(outputPath, { force: true });
		await rename(temporaryPath, outputPath);
		return { path: outputPath, ...artifact };
	} catch (error) {
		await rm(temporaryPath, { force: true });
		throw new Error(`整轨 MP3 拼接失败：${error instanceof Error ? error.message : String(error)}`, {
			cause: error,
		});
	}
}
