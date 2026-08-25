import type { BookId } from './books';

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
};

const storageKey = 'honglou-reading-settings-v2';
const legacyStorageKey = 'honglou-reading-settings-v1';

const cloneBookPreferences = (book: BookId): BookReadingPreferences => ({
	...DEFAULT_READING_PREFERENCES[book],
});

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
		return {
			hongloumeng: { ...migrated },
			guiyou: { ...migrated },
		};
	} catch {
		return undefined;
	}
};

export function loadReadingPreferences(): ReadingPreferences {
	const defaults: ReadingPreferences = {
		hongloumeng: cloneBookPreferences('hongloumeng'),
		guiyou: cloneBookPreferences('guiyou'),
	};

	try {
		const raw = localStorage.getItem(storageKey);
		if (!raw) return migrateLegacyPreferences() ?? defaults;
		const saved = JSON.parse(raw) as Partial<Record<BookId, unknown>>;
		return {
			hongloumeng: normalizeBookPreferences(saved.hongloumeng, 'hongloumeng'),
			guiyou: normalizeBookPreferences(saved.guiyou, 'guiyou'),
		};
	} catch {
		return migrateLegacyPreferences() ?? defaults;
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
