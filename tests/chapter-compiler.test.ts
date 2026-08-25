import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
	ChapterSyntaxError,
	compileChapter,
	renderChapterHtml,
} from '../src/lib/chapter-compiler.ts';
import { validateChapterImages } from '../src/lib/chapter-images.ts';

function expectSyntaxError(
	source: string,
	message: RegExp,
	line?: number,
	column?: number,
): ChapterSyntaxError {
	let received: unknown;
	try {
		compileChapter(source, { sourceName: 'sample.md' });
	} catch (error) {
		received = error;
	}

	assert.ok(received instanceof ChapterSyntaxError, '应抛出 ChapterSyntaxError');
	assert.match(received.message, message);
	assert.equal(received.sourceName, 'sample.md');
	if (line !== undefined) assert.equal(received.position.line, line);
	if (column !== undefined) assert.equal(received.position.column, column);
	return received;
}

test('解析全部内容标记、跨行内容和嵌套脂批诗词', () => {
	const source = `[T]第一回

[zp]原脂批 [zpsc]诗一
诗二[-] 续批[-]

正文 [B]重点[-] [mp]自批一
自批二[-]

[sc]普通诗一
普通诗二[-]

[fu]长赋一
长赋二[-]`;
	const compiled = compileChapter(source, { sourceName: 'sample.md' });
	const rendered = renderChapterHtml(compiled);

	assert.equal(compiled.title, '第一回');
	assert.match(rendered.bodyHtml, /chapter-mark--zp/);
	assert.match(rendered.bodyHtml, /chapter-mark--zpsc/);
	assert.match(rendered.bodyHtml, /chapter-mark--mp/);
	assert.match(rendered.bodyHtml, /chapter-mark--bold[^>]*>重点<\/span>/);
	assert.match(rendered.bodyHtml, /自批一<br \/>/);
	assert.match(
		rendered.bodyHtml,
		/chapter-mark--mp[^>]*><span class="chapter-mp-indent"[^>]*><\/span>自批一<br \/><span class="chapter-mp-indent"[^>]*><\/span>自批二/,
	);
	assert.match(rendered.bodyHtml, /chapter-verse--sc/);
	assert.match(rendered.bodyHtml, /chapter-fu/);
	assert.match(rendered.bodyHtml, /诗一<br \/>诗二/);
});

test('[T] 在行末或文件末尾自动结束，并支持显式提前结束', () => {
	const atEof = compileChapter('[T]文件末标题');
	assert.equal(atEof.title, '文件末标题');

	const source = `[T]主标题[-]同一行正文

[T]副标题

后文`;
	const rendered = renderChapterHtml(compileChapter(source));
	assert.match(rendered.bodyHtml, /<h1[^>]*>主标题<\/h1>/);
	assert.match(rendered.bodyHtml, /同一行正文/);
	assert.match(rendered.bodyHtml, /<h2[^>]*>副标题<\/h2>/);
});

test('正文单换行直接分段，硬换行和韵文逐行换行', () => {
	const source = `[T]换行测试

甲
乙\\
丙

[sc]诗甲
诗乙[-]`;
	const rendered = renderChapterHtml(compileChapter(source));

	assert.match(rendered.bodyHtml, /<p[^>]*>甲<\/p>\n<p[^>]*>乙<br \/>丙<\/p>/);
	assert.match(rendered.bodyHtml, /诗甲<br \/>诗乙/);
});

test('转义 HTML，保留普通 Markdown 字符，并支持字面标记转义', () => {
	const source = `[T]<题&目>

**不是粗体** <script>alert("x")</script> \\[1] \\[-]`;
	const rendered = renderChapterHtml(compileChapter(source));

	assert.equal(compileChapter(source).title, '<题&目>');
	assert.match(rendered.bodyHtml, /&lt;题&amp;目&gt;/);
	assert.match(rendered.bodyHtml, /\*\*不是粗体\*\*/);
	assert.match(rendered.bodyHtml, /&lt;script&gt;alert\(&quot;x&quot;\)&lt;\/script&gt;/);
	assert.match(rendered.bodyHtml, /\[1] \[-]/);
	assert.doesNotMatch(rendered.bodyHtml, /chapter-note__anchor/);
});

test('内联尾注按出现顺序自动编号并生成气泡与章末尾注', () => {
	const source = `[T]注释测试

甲[wz]第一条说明[-]乙[wz]第二条说明[-]`;
	const compiled = compileChapter(source);
	const rendered = renderChapterHtml(compiled);

	assert.deepEqual(compiled.notes.map((note) => note.id), ['1', '2']);
	assert.equal(compiled.notes[1].text, '第二条说明');
	assert.match(rendered.bodyHtml, /aria-controls="chapter-[a-z0-9]+-note-popover-1"/);
	assert.match(rendered.bodyHtml, /aria-controls="chapter-[a-z0-9]+-note-popover-2"/);
	assert.ok(rendered.endnotesHtml.indexOf('第一条说明') < rendered.endnotesHtml.indexOf('第二条说明'));

	const reordered = compileChapter('[T]注释测试\n甲[wz]第二条说明[-]乙[wz]第一条说明[-]');
	assert.deepEqual(
		reordered.notes.map((note) => [note.id, note.text]),
		[['1', '第二条说明'], ['2', '第一条说明']],
	);
});

test('不同章节为相同注释编号生成不同的页面元素 ID', () => {
	const source = `[T]注释测试

正文[wz]说明[-]`;
	const first = renderChapterHtml(compileChapter(source, { sourceName: '01.md' })).bodyHtml;
	const second = renderChapterHtml(compileChapter(source, { sourceName: '02.md' })).bodyHtml;
	const firstId = /aria-controls="([^"]+)"/.exec(first)?.[1];
	const secondId = /aria-controls="([^"]+)"/.exec(second)?.[1];

	assert.ok(firstId);
	assert.ok(secondId);
	assert.notEqual(firstId, secondId);
});

test('报告未闭合标记和孤立结束标记的准确位置', () => {
	expectSyntaxError('[T]题\n[zp]未闭合', /\[zp] 未闭合/, 2, 1);
	expectSyntaxError('[T]题\n[B]未闭合', /\[B] 未闭合/, 2, 1);
	expectSyntaxError('[T]题\n[-]', /孤立的 \[-]/, 2, 1);
});

test('要求首个顶层标题存在且非空', () => {
	expectSyntaxError('只有正文', /至少一个顶层 \[T]/, 1, 1);
	expectSyntaxError('[T]\n正文', /标题不能为空/, 1, 1);
});

test('数字方括号是普通正文，尾注可出现在正文任意位置', () => {
	const source = '[T]题\n甲[7][wz]说明[-]乙\n丙';
	const compiled = compileChapter(source);
	const rendered = renderChapterHtml(compiled);

	assert.deepEqual(compiled.notes.map((note) => note.id), ['1']);
	assert.match(rendered.bodyHtml, /甲\[7\].*<sup>1<\/sup>.*乙/);
	assert.match(rendered.bodyHtml, />丙<\/p>/);
});

test('尾注支持嵌套批语、诗词、长赋等内容标记', () => {
	const source = `[T]题
正文[wz]说明[zp]脂批[B]重点[-][-][sc]诗一
诗二[-][fu]赋文[-][-]`;
	const compiled = compileChapter(source);
	const rendered = renderChapterHtml(compiled);

	assert.equal(compiled.notes[0].text, '说明脂批重点诗一 诗二赋文');
	assert.match(rendered.bodyHtml, /chapter-note__popover[^>]*>.*chapter-mark--zp/);
	assert.match(rendered.bodyHtml, /chapter-mark--bold[^>]*>重点<\/span>/);
	assert.match(rendered.bodyHtml, /诗一<br \/>诗二/);
	assert.match(rendered.endnotesHtml, /chapter-mark--sc/);
	assert.match(rendered.endnotesHtml, /chapter-mark--fu/);
});

test('非正文中的破折号出处自动换行靠右，普通正文保持原样', () => {
	const source = `[T]题
正文——这里仍是正文
[sc]诗句
——诗词出处[-]
[zp]批语——批语署名[-]
[mp]说明——第六十回[-]
正文[wz]引文
——尾注出处[-]`;
	const rendered = renderChapterHtml(compileChapter(source));

	assert.match(rendered.bodyHtml, /正文——这里仍是正文/);
	assert.match(rendered.bodyHtml, /<span class="chapter-attribution">诗词出处<\/span>/);
	assert.match(rendered.bodyHtml, /<span class="chapter-attribution">批语署名<\/span>/);
	assert.match(rendered.bodyHtml, /<span class="chapter-attribution">——第六十回<\/span>/);
	assert.match(rendered.bodyHtml, /<span class="chapter-attribution">尾注出处<\/span>/);
	assert.doesNotMatch(rendered.bodyHtml, /chapter-mark--mp[^>]*><span class="chapter-mp-indent"/);
	assert.doesNotMatch(rendered.bodyHtml, /——诗词出处|——批语署名|——尾注出处/);
	assert.match(rendered.endnotesHtml, /<span class="chapter-attribution">尾注出处<\/span>/);
});

test('尾注拒绝嵌套尾注、标题以及未闭合内容', () => {
	expectSyntaxError(
		'[T]题\n正文[wz]含有[wz]内层[-][-]',
		/不能再嵌套 \[wz]/,
		2,
		9,
	);
	expectSyntaxError('[T]题\n正文[wz][T]标题[-]', /不支持 \[T]/, 2, 7);
	expectSyntaxError('[T]题\n正文[wz][sc]诗句[-]', /尾注未闭合/, 2, 3);
	expectSyntaxError('[T]题\n正文[wz][-]', /内容不能为空/, 2, 3);
});

test('标题行中的嵌套标记必须先闭合', () => {
	expectSyntaxError('[T]标题[zp]批语\n正文', /内部的 \[zp] 尚未关闭/, 1, 6);
});

test('[img] 解析可选图注、中文文件名并输出安全的独立图片块', () => {
	const source = `[T]图片测试
图片前正文
[img]红楼 批语.png
脂批 <版本>
对照 & "说明"[-]
图片后正文`;
	const compiled = compileChapter(source, { sourceName: 'images.md' });
	const rendered = renderChapterHtml(compiled);

	assert.equal(compiled.images.length, 1);
	assert.deepEqual(
		{
			fileName: compiled.images[0].fileName,
			url: compiled.images[0].url,
			caption: compiled.images[0].caption,
		},
		{
			fileName: '红楼 批语.png',
			url: '/images/chapters/%E7%BA%A2%E6%A5%BC%20%E6%89%B9%E8%AF%AD.png',
			caption: '脂批 <版本> 对照 & "说明"',
		},
	);
	assert.match(rendered.bodyHtml, /<figure class="chapter-image" data-chapter-image>/);
	assert.match(rendered.bodyHtml, /data-chapter-image-open/);
	assert.match(rendered.bodyHtml, /loading="lazy" decoding="async"/);
	assert.match(rendered.bodyHtml, /alt="脂批 &lt;版本&gt; 对照 &amp; &quot;说明&quot;"/);
	assert.match(rendered.bodyHtml, /<figcaption[^>]*>脂批 &lt;版本&gt; 对照 &amp; &quot;说明&quot;<\/figcaption>/);
	assert.ok(rendered.bodyHtml.indexOf('图片前正文') < rendered.bodyHtml.indexOf('<figure'));
	assert.ok(rendered.bodyHtml.indexOf('</figure>') < rendered.bodyHtml.indexOf('图片后正文'));
});

test('[img] 无图注时使用空替代文本且不生成图注', () => {
	const compiled = compileChapter('[T]图片测试\n[img]插图.AVIF[-]');
	const rendered = renderChapterHtml(compiled);

	assert.equal(compiled.images[0].caption, undefined);
	assert.match(rendered.bodyHtml, /<img[^>]*alt=""[^>]*\/>/);
	assert.doesNotMatch(rendered.bodyHtml, /<figcaption/);
});

test('[img] 拒绝非法位置、嵌套标记、非法路径与不支持格式', () => {
	expectSyntaxError('[T]题\n正文[img]图.png[-]', /顶层独立段落/, 2, 3);
	expectSyntaxError('[T]题\n[zp][img]图.png[-][-]', /顶层独立段落/, 2, 5);
	expectSyntaxError('[T]题\n正文[wz]说明[img]图.png[-][-]', /顶层独立段落/, 2, 9);
	expectSyntaxError('[T]题\n[img]图.png\n[zp]图注[-][-]', /不能嵌套其他标记/, 3, 1);
	expectSyntaxError('[T]题\n[img]图.png', /图片标记未闭合/, 2, 1);
	expectSyntaxError('[T]题\n[img][-]', /文件名不能为空/, 2, 6);
	expectSyntaxError('[T]题\n[img]子目录\/图.png[-]', /单个图片文件名/, 2, 6);
	expectSyntaxError('[T]题\n[img]https:\/\/example.com\/图.png[-]', /单个图片文件名/, 2, 6);
	expectSyntaxError('[T]题\n[img]图.svg[-]', /仅支持/, 2, 6);
	expectSyntaxError('[T]题\n[img]图.png[-]正文', /顶层独立段落/, 2, 14);
});

test('构建校验接受存在的图片并报告缺失图片的源码位置', async (t) => {
	const publicDirectory = await mkdtemp(join(tmpdir(), 'honglou-chapter-images-'));
	t.after(async () => {
		await rm(publicDirectory, { recursive: true, force: true });
	});
	const imageDirectory = join(publicDirectory, 'images', 'chapters');
	await mkdir(imageDirectory, { recursive: true });
	await writeFile(join(imageDirectory, '已有图片.png'), new Uint8Array([0x89, 0x50, 0x4e, 0x47]));

	const existing = compileChapter('[T]题\n[img]已有图片.png[-]', { sourceName: 'existing.md' });
	await validateChapterImages(existing, { publicDirectory });

	const missing = compileChapter('[T]题\n[img]缺失图片.png[-]', { sourceName: 'missing.md' });
	await assert.rejects(
		validateChapterImages(missing, { publicDirectory }),
		(error: unknown) => {
			assert.ok(error instanceof ChapterSyntaxError);
			assert.match(error.message, /public\/images\/chapters\/缺失图片\.png/);
			assert.equal(error.sourceName, 'missing.md');
			assert.equal(error.position.line, 2);
			assert.equal(error.position.column, 1);
			return true;
		},
	);
});
