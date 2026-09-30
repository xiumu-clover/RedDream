import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { loadPublishedAudioManifest } from '../../src/lib/chapters/audio-manifest.ts';

test('有效音频清单保留已发布章节', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'reddream-audio-manifest-'));
	const path = join(directory, 'manifest.json');
	try {
		await writeFile(path, JSON.stringify({ version: 2, chapters: { '081': { variants: {} } } }));
		const manifest = await loadPublishedAudioManifest(path);
		assert.deepEqual(manifest.chapters['081'], { variants: {} });
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test('音频清单缺失或损坏时隐藏播放器但不中断正文', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'reddream-audio-manifest-'));
	const path = join(directory, 'manifest.json');
	const warnings: string[] = [];
	const warn = (message: string) => warnings.push(message);
	try {
		assert.deepEqual(await loadPublishedAudioManifest(path, warn), { version: 2, chapters: {} });
		await writeFile(path, '{ broken json');
		assert.deepEqual(await loadPublishedAudioManifest(path, warn), { version: 2, chapters: {} });
		await writeFile(path, JSON.stringify({ version: 2, chapters: null }));
		assert.deepEqual(await loadPublishedAudioManifest(path, warn), { version: 2, chapters: {} });
		assert.equal(warnings.length, 3);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});
