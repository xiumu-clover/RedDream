import type { CollectionEntry } from 'astro:content';
import { getCollection } from 'astro:content';
import { BOOK_IDS, type BookId } from '../books/catalog';
import type { CompiledChapter } from './compiler';
import { compileChapter } from './compiler';
import { validateChapterImages } from './images';

type ChapterEntry = CollectionEntry<'hongloumengChapters'>
	| CollectionEntry<'guiyouChapters'>
	| CollectionEntry<'guiyouOriginalChapters'>;

export interface PreparedChapter {
	id: string;
	sourceId: string;
	order?: number;
	description?: string;
	sourceName: string;
	chapter: CompiledChapter;
	book: BookId;
}

export interface LoadChaptersOptions {
	book?: BookId;
}

const compareChapters = (left: PreparedChapter, right: PreparedChapter): number => {
	const bookDifference = BOOK_IDS.indexOf(left.book) - BOOK_IDS.indexOf(right.book);
	const leftOrder = left.order ?? Number.MAX_SAFE_INTEGER;
	const rightOrder = right.order ?? Number.MAX_SAFE_INTEGER;
	return bookDifference
		|| leftOrder - rightOrder
		|| left.chapter.title.localeCompare(right.chapter.title, 'zh-CN', { numeric: true });
};

interface PrepareEntryOptions {
	book: BookId;
	sourceRoot: string;
	routePrefix?: string;
}

async function prepareEntry(
	entry: ChapterEntry,
	options: PrepareEntryOptions,
): Promise<PreparedChapter> {
	const sourceName = `${options.sourceRoot}/${entry.id}.md`;
	const chapter = compileChapter(entry.body ?? '', { sourceName });
	await validateChapterImages(chapter);

	return {
		id: options.routePrefix ? `${options.routePrefix}-${entry.id}` : entry.id,
		sourceId: entry.id,
		order: entry.data.order,
		description: entry.data.description,
		sourceName,
		chapter,
		book: options.book,
	};
}

export async function loadCompiledChapters(
	options: LoadChaptersOptions = {},
): Promise<PreparedChapter[]> {
	const [hongloumengEntries, guiyouEntries, guiyouOriginalEntries] = await Promise.all([
		getCollection('hongloumengChapters'),
		getCollection('guiyouChapters'),
		getCollection('guiyouOriginalChapters'),
	]);

	const selectedBook = options.book;
	const chapters = await Promise.all([
		...(!selectedBook || selectedBook === 'hongloumeng' ? hongloumengEntries : [])
			.map((entry) => prepareEntry(entry, {
				book: 'hongloumeng',
				sourceRoot: 'content/chapters/hongloumeng',
			})),
		...(!selectedBook || selectedBook === 'guiyou' ? guiyouEntries : [])
			.map((entry) => prepareEntry(entry, {
				book: 'guiyou',
				sourceRoot: 'content/chapters/guiyou',
			})),
		...(!selectedBook || selectedBook === 'guiyou-original' ? guiyouOriginalEntries : [])
			.map((entry) => prepareEntry(entry, {
				book: 'guiyou-original',
				sourceRoot: 'content/chapters/guiyou-original',
				routePrefix: 'guiyou-original',
			})),
	]);

	return chapters.sort(compareChapters);
}
