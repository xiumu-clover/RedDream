import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { writeAnnotationRequest } from '../../scripts/audio/annotation-request.js';
import { copyFileAtomic, writeJsonAtomic, writeTextAtomic } from '../../scripts/audio/files.js';

test('原子写入可在 Windows 上安全替换已有文件', async (context) => {
	const directory = await mkdtemp(join(tmpdir(), 'hlm-audio-files-'));
	context.after(() => rm(directory, { recursive: true, force: true }));
	const jsonPath = join(directory, 'state.json');
	const textPath = join(directory, 'note.md');
	const copyPath = join(directory, 'copied.md');

	await writeJsonAtomic(jsonPath, { version: 1 });
	await writeJsonAtomic(jsonPath, { version: 2 });
	assert.deepEqual(JSON.parse(await readFile(jsonPath, 'utf8')), { version: 2 });

	await writeTextAtomic(textPath, '第一版');
	await writeTextAtomic(textPath, '第二版');
	await writeFile(copyPath, '旧副本', 'utf8');
	await copyFileAtomic(textPath, copyPath);
	assert.equal(await readFile(copyPath, 'utf8'), '第二版');
});

test('缺少私有研究仓库时不会悄悄创建未备份的标注任务', async (context) => {
	const projectRoot = await mkdtemp(join(tmpdir(), 'hlm-audio-request-'));
	context.after(() => rm(projectRoot, { recursive: true, force: true }));

	await assert.rejects(
		writeAnnotationRequest({
			projectRoot,
			chapterId: '081',
			source: 'content/chapters/guiyou/081-test.md',
			blocks: [],
			pending: [],
			voiceIndex: {},
		}),
		/RedDream-Research/u,
	);
});
