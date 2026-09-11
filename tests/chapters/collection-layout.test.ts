import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('../..', import.meta.url));
const chapterRoot = join(projectRoot, 'content', 'chapters');

async function markdownFiles(directory: string): Promise<string[]> {
	return (await readdir(directory, { withFileTypes: true }))
		.filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
		.map((entry) => entry.name)
		.sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
}

function withoutExtension(fileName: string): string {
	return fileName.slice(0, -'.md'.length);
}

test('章节源码按三个书册目录完整分组，且公开路由 ID 不重复', async () => {
	const [rootFiles, hongloumeng, guiyou, guiyouOriginal] = await Promise.all([
		markdownFiles(chapterRoot),
		markdownFiles(join(chapterRoot, 'hongloumeng')),
		markdownFiles(join(chapterRoot, 'guiyou')),
		markdownFiles(join(chapterRoot, 'guiyou-original')),
	]);

	assert.deepEqual(rootFiles, []);
	assert.equal(hongloumeng.length, 81);
	assert.ok(hongloumeng.includes('00-前言.md'));
	assert.deepEqual(
		hongloumeng.filter((name) => /^\d{3}-/u.test(name)).map((name) => Number(name.slice(0, 3))),
		Array.from({ length: 80 }, (_, index) => index + 1),
	);
	assert.equal(guiyou.length, 28);
	assert.deepEqual(
		guiyou.map((name) => Number(name.slice(0, 3))),
		Array.from({ length: 28 }, (_, index) => index + 81),
	);
	assert.deepEqual(
		guiyouOriginal,
		Array.from({ length: 28 }, (_, index) => `${index + 81}.md`),
	);

	const routeIds = [
		...hongloumeng.map(withoutExtension),
		...guiyou.map(withoutExtension),
		...guiyouOriginal.map((name) => `guiyou-original-${withoutExtension(name)}`),
	];
	assert.equal(routeIds.length, 137);
	assert.equal(new Set(routeIds).size, routeIds.length);
});
