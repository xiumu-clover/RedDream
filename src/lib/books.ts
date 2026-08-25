export const BOOKS = {
	hongloumeng: {
		id: 'hongloumeng',
		title: '红楼梦',
		range: '前八十回',
		rangeDetail: '第一至八十回',
		description: '从甄士隐梦幻识通灵，读至懦弱迎春肠回九曲。',
		href: '/hongloumeng/',
		continuousHref: '/hongloumeng/all/',
		startOrder: 0,
		endOrder: 80,
	},
	guiyou: {
		id: 'guiyou',
		title: '癸酉本',
		range: '后二十八回',
		rangeDetail: '第八十一至一百零八回',
		description: '从惜昵近公子做良媒，续读至幻中幻境展演情榜。',
		href: '/guiyou/',
		continuousHref: '/guiyou/all/',
		startOrder: 81,
		endOrder: 108,
	},
} as const;

export type BookId = keyof typeof BOOKS;

export const BOOK_IDS = Object.keys(BOOKS) as BookId[];

export function isBookId(value: string | undefined): value is BookId {
	return value === 'hongloumeng' || value === 'guiyou';
}

export function getChapterBook(order: number | undefined): BookId {
	return (order ?? 0) >= BOOKS.guiyou.startOrder ? 'guiyou' : 'hongloumeng';
}

export function belongsToBook(order: number | undefined, book: BookId): boolean {
	const normalizedOrder = order ?? 0;
	const definition = BOOKS[book];
	return normalizedOrder >= definition.startOrder && normalizedOrder <= definition.endOrder;
}

export function formatChapterOrder(order: number | undefined): string {
	if (order === 0) return '序';
	return String(order ?? '').padStart(2, '0');
}
