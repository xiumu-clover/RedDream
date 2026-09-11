const OMITTED_MARKS = new Set(['zp', 'mp', 'zpsc']);
const LITERAL_MARKER_PATTERN = /\[(?:zp|mp|zpsc|sc|fu|b|t|wz\d*|img|-)\]/giu;
const UNMARKED_EDITORIAL_COMMENT_PATTERN = /【[^】]*】/gu;

/**
 * Remove the YAML frontmatter used by Astro content entries.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripFrontmatter(source) {
	const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/gu, '\n');
	if (!/^---[ \t]*\n/u.test(normalized)) return normalized;

	const frontmatter = /^---[ \t]*\n[\s\S]*?\n(?:---|\.\.\.)[ \t]*(?:\n|$)/u.exec(normalized);
	if (!frontmatter) {
		throw new Error('章节 frontmatter 未闭合，请检查开头和结尾的 ---。');
	}

	return normalized.slice(frontmatter[0].length);
}

/**
 * Older drafts sometimes used [wz1], [wz2] and similar note markers.
 * Normalize them to the current [wz] syntax before compiling the chapter.
 *
 * @param {string} source
 * @returns {string}
 */
export function normalizeLegacyNoteMarkers(source) {
	return source.replace(/\[wz\d+\]/giu, '[wz]');
}

function collectSpeechText(nodes) {
	let output = '';

	for (const node of nodes) {
		switch (node.type) {
			case 'text':
				output += node.value;
				break;
			case 'hard-break':
				output += '\n';
				break;
			case 'note-reference':
			case 'image':
				break;
			case 'mark':
				if (!OMITTED_MARKS.has(node.kind)) {
					output += collectSpeechText(node.children);
				}
				break;
			default:
				throw new Error(`无法处理未知的章节节点：${String(node.type)}`);
		}
	}

	return output;
}

/**
 * Convert the project's compiled chapter AST into narration text.
 * Titles, prose, normal verse/poetry, fu and bold text are kept.
 * Zhipi, book comments, zhipi verse, endnotes and images are omitted.
 *
 * @param {import('../../src/lib/chapters/compiler.ts').CompiledChapter} chapter
 * @returns {string}
 */
export function chapterToSpeechText(chapter) {
	return collectSpeechText(chapter.nodes)
		.replace(UNMARKED_EDITORIAL_COMMENT_PATTERN, '')
		.replace(LITERAL_MARKER_PATTERN, '')
		.replace(/[ \t]+\n/gu, '\n')
		.replace(/\n[ \t]+/gu, '\n')
		.replace(/[ \t]{2,}/gu, ' ')
		.replace(/\n{3,}/gu, '\n\n')
		.trim();
}
