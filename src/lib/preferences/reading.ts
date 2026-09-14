import { BOOK_IDS, type BookId } from '../books/catalog';

export interface BookReadingPreferences {
	showZp: boolean;
	showMp: boolean;
	showNotes: boolean;
	compact: boolean;
	continuous: boolean;
}

export type ReadingPreferences = Record<BookId, BookReadingPreferences>;

export const DEFAULT_READING_PREFERENCES: ReadingPreferences = {
	hongloumeng: {
		showZp: false,
		showMp: false,
		showNotes: true,
		compact: false,
		continuous: false,
	},
	guiyou: {
		showZp: true,
		showMp: true,
		showNotes: true,
		compact: false,
		continuous: false,
	},
	'guiyou-original': {
		showZp: true,
		showMp: true,
		showNotes: true,
		compact: false,
		continuous: false,
	},
};

const storageKey = 'honglou-reading-settings-v3';
const previousStorageKey = 'honglou-reading-settings-v2';
const legacyStorageKey = 'honglou-reading-settings-v1';

const cloneBookPreferences = (book: BookId): BookReadingPreferences => ({
	...DEFAULT_READING_PREFERENCES[book],
});

const buildPreferences = (
	saved: Partial<Record<BookId, unknown>> = {},
): ReadingPreferences => Object.fromEntries(
	BOOK_IDS.map((book) => [book, normalizeBookPreferences(saved[book], book)]),
) as ReadingPreferences;

export const getDefaultReadingPreferences = (book: BookId): BookReadingPreferences =>
	cloneBookPreferences(book);

const normalizeBookPreferences = (
	value: unknown,
	book: BookId,
): BookReadingPreferences => {
	const saved = value && typeof value === 'object'
		? value as Partial<BookReadingPreferences>
		: {};
	const defaults = DEFAULT_READING_PREFERENCES[book];

	return {
		showZp: typeof saved.showZp === 'boolean' ? saved.showZp : defaults.showZp,
		showMp: typeof saved.showMp === 'boolean' ? saved.showMp : defaults.showMp,
		showNotes: typeof saved.showNotes === 'boolean' ? saved.showNotes : defaults.showNotes,
		compact: typeof saved.compact === 'boolean' ? saved.compact : defaults.compact,
		continuous: typeof saved.continuous === 'boolean' ? saved.continuous : defaults.continuous,
	};
};

const migratePreviousPreferences = (): ReadingPreferences | undefined => {
	try {
		const raw = localStorage.getItem(previousStorageKey);
		if (!raw) return undefined;
		const saved = JSON.parse(raw) as Partial<Record<BookId, unknown>>;
		return buildPreferences(saved);
	} catch {
		return undefined;
	}
};

const migrateLegacyPreferences = (): ReadingPreferences | undefined => {
	try {
		const raw = localStorage.getItem(legacyStorageKey);
		if (!raw) return undefined;
		const saved = JSON.parse(raw) as Record<string, unknown>;
		const migrated: BookReadingPreferences = {
			showZp: saved['hide-zp'] !== true,
			showMp: saved['hide-mp'] !== true,
			showNotes: saved['hide-notes'] !== true,
			compact: saved.compact === true,
			continuous: saved.continuous === true,
		};
		return Object.fromEntries(
			BOOK_IDS.map((book) => [book, book === 'guiyou-original'
				? cloneBookPreferences(book)
				: { ...migrated }]),
		) as ReadingPreferences;
	} catch {
		return undefined;
	}
};

export function loadReadingPreferences(): ReadingPreferences {
	const defaults = buildPreferences();

	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return migratePreviousPreferences() ?? migrateLegacyPreferences() ?? defaults;
		const saved = JSON.parse(raw) as Partial<Record<BookId, unknown>>;
		return buildPreferences(saved);
	} catch {
		return migratePreviousPreferences() ?? migrateLegacyPreferences() ?? defaults;
	}
}

export function saveReadingPreferences(preferences: ReadingPreferences): boolean {
	try {
		localStorage.setItem(storageKey, JSON.stringify(preferences));
		return true;
	} catch {
		return false;
	}
}
