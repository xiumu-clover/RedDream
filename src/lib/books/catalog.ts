export const BOOKS = {
	hongloumeng: {
		id: 'hongloumeng',
		title: '红楼梦',
		homeNumber: '壹',
		range: '前八十回',
		rangeDetail: '第一至八十回',
		description: '从甄士隐梦幻识通灵，读至懦弱迎春肠回九曲。',
		homeDescription: '由甄士隐梦幻识通灵，读至懦弱迎春肠回九曲。脂批与书批默认隐藏，可在阅读设置中分别开启。',
		settingsBadge: '批语默认隐藏',
		href: '/hongloumeng/',
		continuousHref: '/hongloumeng/all/',
		startOrder: 0,
		endOrder: 80,
		hasAudio: true,
	},
	'guiyou-original': {
		id: 'guiyou-original',
		title: '癸酉本',
		homeNumber: '贰',
		range: '后二十八回 · 拆分版',
		rangeDetail: '第八十一至一百零八回',
		description: '直接阅读癸酉本拆分版本的二十八回续书。',
		homeDescription: '直接读取癸酉本拆分版本，保留其中的正文与原有批语文字，便于和润色版对照阅读。',
		settingsBadge: '原稿直接读取',
		href: '/guiyou-original/',
		continuousHref: '/guiyou-original/all/',
		startOrder: 81,
		endOrder: 108,
		hasAudio: false,
	},
	guiyou: {
		id: 'guiyou',
		title: '癸酉本润色版',
		homeNumber: '叁',
		range: '后二十八回 · 润色版',
		rangeDetail: '第八十一至一百零八回',
		description: '阅读整理、润色后的第八十一至一百零八回。',
		homeDescription: '从惜昵近公子做良媒续读至幻中幻境展演情榜。此册为整理润色后的版本，批语默认显示。',
		settingsBadge: '批语默认开启',
		href: '/guiyou/',
		continuousHref: '/guiyou/all/',
		startOrder: 81,
		endOrder: 108,
		hasAudio: true,
	},
} as const;

export type BookId = keyof typeof BOOKS;

export const BOOK_IDS = Object.keys(BOOKS) as BookId[];

export function isBookId(value: string | undefined): value is BookId {
	return typeof value === 'string' && BOOK_IDS.includes(value as BookId);
}

export function getChapterBook(order: number | undefined): 'hongloumeng' | 'guiyou' {
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
