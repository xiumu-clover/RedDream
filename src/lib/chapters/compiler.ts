export type MarkKind = 'zp' | 'mp' | 'zpsc' | 'sc' | 'fu' | 'bold' | 'title';

export interface SourcePosition {
	offset: number;
	line: number;
	column: number;
}

interface BaseNode {
	position: SourcePosition;
}

export interface TextNode extends BaseNode {
	type: 'text';
	value: string;
}

export interface HardBreakNode extends BaseNode {
	type: 'hard-break';
}

export interface MarkNode extends BaseNode {
	type: 'mark';
	kind: MarkKind;
	children: ChapterNode[];
}

export interface NoteReferenceNode extends BaseNode {
	type: 'note-reference';
	id: string;
}

export interface ImageNode extends BaseNode {
	type: 'image';
	fileName: string;
	url: string;
	caption?: string;
}

export type ChapterNode = TextNode | HardBreakNode | MarkNode | NoteReferenceNode | ImageNode;

export interface NoteDefinition {
	id: string;
	text: string;
	nodes: ChapterNode[];
	position: SourcePosition;
}

export interface CompiledChapter {
	sourceName: string;
	title: string;
	nodes: ChapterNode[];
	notes: NoteDefinition[];
	images: ImageNode[];
}

export interface RenderedChapter {
	bodyHtml: string;
	endnotesHtml: string;
}

export interface CompileChapterOptions {
	sourceName?: string;
}

export class ChapterSyntaxError extends Error {
	readonly sourceName: string;
	readonly position: SourcePosition;

	constructor(message: string, sourceName: string, position: SourcePosition) {
		super(`${sourceName}:${position.line}:${position.column} ${message}`);
		this.name = 'ChapterSyntaxError';
		this.sourceName = sourceName;
		this.position = position;
	}
}

interface ParserFrame {
	node: MarkNode;
	parent: ChapterNode[];
}

interface Token {
	type: 'close' | 'mark' | 'note-definition' | 'image';
	length: number;
	kind?: MarkKind;
}

const MARK_TOKENS = new Map<string, MarkKind>([
	['[zp]', 'zp'],
	['[mp]', 'mp'],
	['[zpsc]', 'zpsc'],
	['[sc]', 'sc'],
	['[fu]', 'fu'],
	['[B]', 'bold'],
	['[T]', 'title'],
]);

const LINE_PRESERVING_MARKS = new Set<MarkKind>(['mp', 'sc', 'zpsc', 'fu']);
const SELF_FORMATTING_LINE_MARKS = new Set<MarkKind>(['mp', 'sc', 'zpsc', 'fu']);
const SUPPORTED_IMAGE_EXTENSION = /\.(?:avif|gif|jpe?g|png|webp)$/iu;

function clonePosition(position: SourcePosition): SourcePosition {
	return { ...position };
}

function markLabel(kind: MarkKind): string {
	if (kind === 'title') return 'T';
	if (kind === 'bold') return 'B';
	return kind;
}

function advancePosition(position: SourcePosition, text: string): void {
	for (const character of text) {
		position.offset += 1;
		if (character === '\n') {
			position.line += 1;
			position.column = 1;
		} else {
			position.column += 1;
		}
	}
}

function readToken(source: string, index: number): Token | undefined {
	if (source[index] !== '[') return undefined;

	if (source.startsWith('[-]', index)) {
		return { type: 'close', length: 3 };
	}

	for (const [marker, kind] of MARK_TOKENS) {
		if (source.startsWith(marker, index)) {
			return { type: 'mark', kind, length: marker.length };
		}
	}

	if (source.startsWith('[wz]', index)) {
		return { type: 'note-definition', length: 4 };
	}

	if (source.startsWith('[img]', index)) {
		return { type: 'image', length: 5 };
	}

	return undefined;
}

function appendText(nodes: ChapterNode[], value: string, position: SourcePosition): void {
	if (!value) return;
	const previous = nodes.at(-1);
	if (previous?.type === 'text') {
		previous.value += value;
		return;
	}
	nodes.push({ type: 'text', value, position: clonePosition(position) });
}

function flattenText(nodes: ChapterNode[]): string {
	let output = '';
	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				output += node.value;
				break;
			case 'hard-break':
				output += ' ';
				break;
			case 'note-reference':
				output += node.id;
				break;
			case 'image':
				output += node.caption ?? '';
				break;
			case 'mark':
				output += flattenText(node.children);
				break;
		}
	}
	return output.replace(/\s+/g, ' ').trim();
}

function hasProseLineBreak(nodes: ChapterNode[]): boolean {
	return nodes.some((node) => {
		if (node.type === 'text') return node.value.includes('\n');
		if (node.type === 'hard-break') return true;
		if (node.type !== 'mark' || SELF_FORMATTING_LINE_MARKS.has(node.kind)) return false;
		return hasProseLineBreak(node.children);
	});
}

function imageUrl(fileName: string): string {
	return `/images/chapters/${encodeURIComponent(fileName)}`;
}

function validateImageFileName(
	fileName: string,
	fail: (message: string, at?: SourcePosition) => never,
	position: SourcePosition,
): void {
	if (!fileName) {
		fail('[img] 图片文件名不能为空。', position);
	}
	if (
		fileName.includes('/')
		|| fileName.includes('\\')
		|| fileName.includes('..')
		|| fileName.includes('?')
		|| fileName.includes('#')
		|| fileName.includes(':')
		|| /[\u0000-\u001f<>"|*]/u.test(fileName)
	) {
		fail('[img] 只能填写 public/images/chapters/ 中的单个图片文件名。', position);
	}
	if (!SUPPORTED_IMAGE_EXTENSION.test(fileName)) {
		fail('[img] 仅支持 png、jpg、jpeg、webp、gif 或 avif 图片。', position);
	}
}

export function compileChapter(
	source: string,
	options: CompileChapterOptions = {},
): CompiledChapter {
	const sourceName = options.sourceName ?? '<chapter>';
	const normalizedSource = source.replace(/\r\n?/g, '\n');
	const root: ChapterNode[] = [];
	const stack: ParserFrame[] = [];
	const notes: NoteDefinition[] = [];
	const images: ImageNode[] = [];
	const position: SourcePosition = { offset: 0, line: 1, column: 1 };
	let currentNodes = root;
	let index = 0;

	const fail = (message: string, at: SourcePosition = position): never => {
		throw new ChapterSyntaxError(message, sourceName, clonePosition(at));
	};

	while (index < normalizedSource.length) {
		const currentPosition = clonePosition(position);

		if (normalizedSource.startsWith('\\[', index)) {
			appendText(currentNodes, '[', currentPosition);
			advancePosition(position, '\\[');
			index += 2;
			continue;
		}

		if (normalizedSource.startsWith('\\\\', index)) {
			appendText(currentNodes, '\\', currentPosition);
			advancePosition(position, '\\\\');
			index += 2;
			continue;
		}

		if (normalizedSource.startsWith('\\\n', index)) {
			currentNodes.push({ type: 'hard-break', position: currentPosition });
			advancePosition(position, '\\\n');
			index += 2;
			continue;
		}

		const token = readToken(normalizedSource, index);
		if (token?.type === 'image') {
			const imagePosition = clonePosition(position);
			const lineStart = normalizedSource.lastIndexOf('\n', index - 1) + 1;
			if (stack.length > 0 || normalizedSource.slice(lineStart, index).trim().length > 0) {
				fail('[img] 图片必须作为顶层独立段落使用。', imagePosition);
			}

			const opening = normalizedSource.slice(index, index + token.length);
			advancePosition(position, opening);
			index += token.length;
			const contentPosition = clonePosition(position);
			let content = '';
			let imageClosed = false;

			while (index < normalizedSource.length) {
				const contentCharacterPosition = clonePosition(position);
				if (normalizedSource.startsWith('[-]', index)) {
					advancePosition(position, '[-]');
					index += 3;
					imageClosed = true;
					break;
				}
				if (normalizedSource.startsWith('\\[', index)) {
					content += '[';
					advancePosition(position, '\\[');
					index += 2;
					continue;
				}
				if (normalizedSource.startsWith('\\\\', index)) {
					content += '\\';
					advancePosition(position, '\\\\');
					index += 2;
					continue;
				}
				if (normalizedSource.startsWith('\\\n', index)) {
					content += '\n';
					advancePosition(position, '\\\n');
					index += 2;
					continue;
				}

				const innerToken = readToken(normalizedSource, index);
				if (innerToken) {
					fail('[img] 图片文件名和图注中不能嵌套其他标记。', contentCharacterPosition);
				}

				const character = normalizedSource[index];
				content += character;
				advancePosition(position, character);
				index += 1;
			}

			if (!imageClosed) {
				fail('[img] 图片标记未闭合。', imagePosition);
			}

			const lineEnd = normalizedSource.indexOf('\n', index);
			const afterImage = normalizedSource.slice(index, lineEnd < 0 ? normalizedSource.length : lineEnd);
			const unexpectedIndex = afterImage.search(/[^\t ]/u);
			if (unexpectedIndex >= 0) {
				const unexpectedPosition = clonePosition(position);
				advancePosition(unexpectedPosition, afterImage.slice(0, unexpectedIndex));
				fail('[img] 图片必须作为顶层独立段落使用。', unexpectedPosition);
			}

			const [fileNameLine = '', ...captionLines] = content.split('\n');
			const fileName = fileNameLine.trim();
			validateImageFileName(fileName, fail, contentPosition);
			const caption = captionLines.join(' ').replace(/[\t ]+/g, ' ').trim();
			const node: ImageNode = {
				type: 'image',
				fileName,
				url: imageUrl(fileName),
				...(caption ? { caption } : {}),
				position: imagePosition,
			};
			root.push(node);
			images.push(node);
			continue;
		}

		if (token?.type === 'note-definition') {
			const definitionPosition = clonePosition(position);
			const id = String(notes.length + 1);
			currentNodes.push({
				type: 'note-reference',
				id,
				position: definitionPosition,
			});

			const opening = normalizedSource.slice(index, index + token.length);
			advancePosition(position, opening);
			index += token.length;
			const noteNodes: ChapterNode[] = [];
			const noteStack: ParserFrame[] = [];
			let currentNoteNodes = noteNodes;
			let noteClosed = false;

			while (index < normalizedSource.length) {
				const definitionCharacterPosition = clonePosition(position);
				if (normalizedSource.startsWith('\\[', index)) {
					appendText(currentNoteNodes, '[', definitionCharacterPosition);
					advancePosition(position, '\\[');
					index += 2;
					continue;
				}
				if (normalizedSource.startsWith('\\\\', index)) {
					appendText(currentNoteNodes, '\\', definitionCharacterPosition);
					advancePosition(position, '\\\\');
					index += 2;
					continue;
				}
				if (normalizedSource.startsWith('\\\n', index)) {
					currentNoteNodes.push({ type: 'hard-break', position: definitionCharacterPosition });
					advancePosition(position, '\\\n');
					index += 2;
					continue;
				}

				const innerToken = readToken(normalizedSource, index);
				if (innerToken?.type === 'close') {
					if (noteStack.length > 0) {
						const frame = noteStack.pop()!;
						currentNoteNodes = frame.parent;
						advancePosition(position, '[-]');
						index += innerToken.length;
						continue;
					}
					advancePosition(position, '[-]');
					index += innerToken.length;
					noteClosed = true;
					break;
				}
				if (innerToken?.type === 'note-definition') {
					fail('[wz] 尾注内不能再嵌套 [wz]。', definitionCharacterPosition);
				}
				if (innerToken?.type === 'image') {
					fail('[img] 图片必须作为顶层独立段落使用。', definitionCharacterPosition);
				}
				if (innerToken?.type === 'mark') {
					if (innerToken.kind === 'title') {
						fail('[wz] 尾注内不支持 [T] 标题标记。', definitionCharacterPosition);
					}
					const node: MarkNode = {
						type: 'mark',
						kind: innerToken.kind!,
						children: [],
						position: definitionCharacterPosition,
					};
					currentNoteNodes.push(node);
					noteStack.push({ node, parent: currentNoteNodes });
					currentNoteNodes = node.children;
					const marker = normalizedSource.slice(index, index + innerToken.length);
					advancePosition(position, marker);
					index += innerToken.length;
					continue;
				}

				const character = normalizedSource[index];
				appendText(currentNoteNodes, character, definitionCharacterPosition);
				advancePosition(position, character);
				index += 1;
			}

			if (noteStack.length > 0) {
				const frame = noteStack.at(-1)!;
				fail(
					`[wz] 尾注内部的 [${markLabel(frame.node.kind)}] 未闭合。`,
					frame.node.position,
				);
			}
			if (!noteClosed) {
				fail('[wz] 尾注未闭合。', definitionPosition);
			}
			const noteText = flattenText(noteNodes);
			if (!noteText) {
				fail('[wz] 尾注内容不能为空。', definitionPosition);
			}
			notes.push({
				id,
				text: noteText,
				nodes: noteNodes,
				position: definitionPosition,
			});
			continue;
		}

		if (token?.type === 'close') {
			if (stack.length === 0) {
				fail('发现孤立的 [-]，没有可关闭的标记。');
			}
			const frame = stack.pop()!;
			currentNodes = frame.parent;
			advancePosition(position, '[-]');
			index += token.length;
			continue;
		}

		if (token?.type === 'mark') {
			const node: MarkNode = {
				type: 'mark',
				kind: token.kind!,
				children: [],
				position: currentPosition,
			};
			currentNodes.push(node);
			stack.push({ node, parent: currentNodes });
			currentNodes = node.children;
			const marker = normalizedSource.slice(index, index + token.length);
			advancePosition(position, marker);
			index += token.length;
			continue;
		}

		const character = normalizedSource[index];
		if (character === '\n') {
			const titleFrameIndex = stack.findLastIndex((frame) => frame.node.kind === 'title');
			if (titleFrameIndex >= 0) {
				if (titleFrameIndex !== stack.length - 1) {
					const nested = stack.at(-1)!.node;
					fail(
						`[T] 在行末结束前，内部的 [${markLabel(nested.kind)}] 尚未关闭。`,
						nested.position,
					);
				}
				const titleFrame = stack.pop()!;
				currentNodes = titleFrame.parent;
			}
		}

		appendText(currentNodes, character, currentPosition);
		advancePosition(position, character);
		index += 1;
	}

	while (stack.at(-1)?.node.kind === 'title') {
		const titleFrame = stack.pop()!;
		currentNodes = titleFrame.parent;
	}

	if (stack.length > 0) {
		const frame = stack.at(-1)!;
		fail(
			`标记 [${markLabel(frame.node.kind)}] 未闭合。`,
			frame.node.position,
		);
	}

	const firstTitle = root.find(
		(node): node is MarkNode => node.type === 'mark' && node.kind === 'title',
	);
	if (!firstTitle) {
		fail('章节必须包含至少一个顶层 [T] 标题。', { offset: 0, line: 1, column: 1 });
	}
	const title = flattenText(firstTitle.children);
	if (!title) {
		fail('首个顶层 [T] 标题不能为空。', firstTitle.position);
	}

	return {
		sourceName,
		title,
		nodes: root,
		notes,
		images,
	};
}

function escapeHtml(value: string): string {
	return value
		.replaceAll('&', '&amp;')
		.replaceAll('<', '&lt;')
		.replaceAll('>', '&gt;')
		.replaceAll('"', '&quot;')
		.replaceAll("'", '&#39;');
}

function renderPlainText(
	value: string,
	preserveLines: boolean,
	indentMpLines: boolean,
): string {
	if (preserveLines) {
		const breakHtml = indentMpLines
			? '<br /><span class="chapter-mp-indent" aria-hidden="true"></span>'
			: '<br />';
		return escapeHtml(value)
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n[ \t]+/g, '\n')
			.replaceAll('\n', breakHtml);
	}
	return escapeHtml(value.replace(/[ \t\n]+/g, ' '));
}

function renderText(
	value: string,
	preserveLines: boolean,
	formatAttributions: boolean,
	indentMpLines: boolean,
): string {
	if (!formatAttributions || !value.includes('——')) {
		return renderPlainText(value, preserveLines, indentMpLines);
	}

	const attributionPattern = /(?:\n[ \t]*|[ \t]*)——[ \t]*([^\n]*)(?:\n|$)?/gu;
	let output = '';
	let lastIndex = 0;
	for (const match of value.matchAll(attributionPattern)) {
		const matchIndex = match.index ?? 0;
		output += renderPlainText(value.slice(lastIndex, matchIndex), preserveLines, indentMpLines);
		const attribution = match[1].trim();
		if (attribution) {
			const visibleAttribution = attribution.startsWith('第')
				? `——${attribution}`
				: attribution;
			output += `<span class="chapter-attribution">${escapeHtml(visibleAttribution)}</span>`;
		}
		lastIndex = matchIndex + match[0].length;
	}
	output += renderPlainText(value.slice(lastIndex), preserveLines, indentMpLines);
	return output;
}

function createChapterDomIdPrefix(sourceName: string): string {
	let hash = 0;
	for (const character of sourceName) {
		hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
	}
	return `chapter-${hash.toString(36)}`;
}

function renderNoteReference(
	note: NoteDefinition,
	notes: Map<string, NoteDefinition>,
	idPrefix: string,
): string {
	const id = escapeHtml(note.id);
	const content = renderNodes(note.nodes, notes, idPrefix, false, true);
	const popoverId = `${idPrefix}-note-popover-${id}`;
	return `<span class="chapter-note" data-chapter-note><button class="chapter-note__anchor" type="button" aria-label="查看注释 ${id}" aria-controls="${popoverId}" aria-expanded="false"><sup>${id}</sup></button><span class="chapter-note__popover" id="${popoverId}" role="tooltip" hidden>${content}</span></span>`;
}

function renderImage(node: ImageNode): string {
	const url = escapeHtml(node.url);
	const alt = escapeHtml(node.caption ?? '');
	const accessibleName = escapeHtml(`放大图片：${node.caption ?? node.fileName}`);
	const caption = node.caption
		? `<figcaption class="chapter-image__caption">${escapeHtml(node.caption)}</figcaption>`
		: '';
	return `<figure class="chapter-image" data-chapter-image><button class="chapter-image__open" type="button" data-chapter-image-open aria-label="${accessibleName}"><img src="${url}" alt="${alt}" loading="lazy" decoding="async" /></button>${caption}</figure>`;
}

function renderNodes(
	nodes: ChapterNode[],
	notes: Map<string, NoteDefinition>,
	idPrefix: string,
	preserveLines = false,
	formatAttributions = false,
	indentMpLines = false,
): string {
	let output = '';
	for (const node of nodes) {
			switch (node.type) {
			case 'text':
				output += renderText(node.value, preserveLines, formatAttributions, indentMpLines);
				break;
			case 'hard-break':
				output += indentMpLines
					? '<br /><span class="chapter-mp-indent" aria-hidden="true"></span>'
					: '<br />';
				break;
			case 'note-reference':
				output += renderNoteReference(notes.get(node.id)!, notes, idPrefix);
				break;
			case 'image':
				output += renderImage(node);
				break;
			case 'mark': {
				const markerName = node.kind === 'title' ? 'title-inline' : node.kind;
				const isMultilineMp = node.kind === 'mp' && hasProseLineBreak(node.children);
				const childIndentMpLines = isMultilineMp
					|| (indentMpLines && !SELF_FORMATTING_LINE_MARKS.has(node.kind));
				let markerContent = renderNodes(
					node.children,
					notes,
					idPrefix,
					preserveLines || LINE_PRESERVING_MARKS.has(node.kind),
					formatAttributions || node.kind !== 'title',
					childIndentMpLines,
				);
				if (isMultilineMp) {
					markerContent = `<span class="chapter-mp-indent" aria-hidden="true"></span>${markerContent}`;
				}
				output += `<span class="chapter-mark chapter-mark--${markerName}">${markerContent}</span>`;
				break;
			}
		}
	}
	return output;
}

function splitTopLevelBlocks(nodes: ChapterNode[]): ChapterNode[][] {
	const blocks: ChapterNode[][] = [];
	let current: ChapterNode[] = [];

	const pushBlock = (): void => {
		const hasContent = current.some(
			(node) => node.type !== 'text' || node.value.trim().length > 0,
		);
		if (hasContent) blocks.push(current);
		current = [];
	};

	for (const node of nodes) {
		if (node.type === 'image') {
			pushBlock();
			blocks.push([node]);
			continue;
		}
		if (node.type !== 'text') {
			if (
				node.type === 'mark' &&
				(node.kind === 'title' || node.kind === 'sc' || node.kind === 'zpsc' || node.kind === 'fu')
			) {
				pushBlock();
				blocks.push([node]);
				continue;
			}
			current.push(node);
			continue;
		}

		const pieces = node.value.split(/(\n[ \t]*)/);
		for (const piece of pieces) {
			if (!piece) continue;
			if (/^\n[ \t]*$/u.test(piece)) {
				pushBlock();
			} else {
				appendText(current, piece, node.position);
			}
		}
	}
	pushBlock();
	return blocks;
}

function unwrapSingleMark(block: ChapterNode[]): MarkNode | undefined {
	const meaningful = block.filter(
		(node) => node.type !== 'text' || node.value.trim().length > 0,
	);
	if (meaningful.length === 1 && meaningful[0].type === 'mark') {
		return meaningful[0];
	}
	return undefined;
}

function unwrapSingleImage(block: ChapterNode[]): ImageNode | undefined {
	const meaningful = block.filter(
		(node) => node.type !== 'text' || node.value.trim().length > 0,
	);
	if (meaningful.length === 1 && meaningful[0].type === 'image') {
		return meaningful[0];
	}
	return undefined;
}

export function renderChapterHtml(compiled: CompiledChapter): RenderedChapter {
	const notes = new Map(compiled.notes.map((note) => [note.id, note]));
	const idPrefix = createChapterDomIdPrefix(compiled.sourceName);
	const blocks = splitTopLevelBlocks(compiled.nodes);
	let titleCount = 0;
	const bodyHtml = blocks
		.map((block) => {
			const image = unwrapSingleImage(block);
			if (image) return renderImage(image);
			const mark = unwrapSingleMark(block);
			if (mark?.kind === 'title') {
				titleCount += 1;
				const level = titleCount === 1 ? 'h1' : 'h2';
				return `<${level} class="chapter-title chapter-title--level-${titleCount === 1 ? 'primary' : 'secondary'}">${renderNodes(mark.children, notes, idPrefix)}</${level}>`;
			}
			if (mark?.kind === 'sc' || mark?.kind === 'zpsc') {
				return `<div class="chapter-verse chapter-verse--${mark.kind}">${renderNodes(mark.children, notes, idPrefix, true, true)}</div>`;
			}
			if (mark?.kind === 'fu') {
				return `<div class="chapter-fu">${renderNodes(mark.children, notes, idPrefix, true, true)}</div>`;
			}
			const blockClass = mark?.kind === 'zp' || mark?.kind === 'mp'
				? ` chapter-paragraph--${mark.kind}`
				: '';
			return `<p class="chapter-paragraph${blockClass}">${renderNodes(block, notes, idPrefix)}</p>`;
		})
		.join('\n');

	const endnotesHtml = compiled.notes.length === 0
		? ''
		: `<section class="chapter-endnotes" aria-label="本章注释"><h2>注释</h2><ol>${compiled.notes
			.map(
				(note) => `<li><span class="chapter-endnotes__number">${escapeHtml(note.id)}</span><span>${renderNodes(note.nodes, notes, idPrefix, false, true)}</span></li>`,
			)
			.join('')}</ol></section>`;

	return { bodyHtml, endnotesHtml };
}
