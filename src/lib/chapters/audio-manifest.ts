import { readFile } from 'node:fs/promises';

export interface PublishedAudioManifest {
	version: 2;
	chapters: Record<string, unknown>;
}

const emptyManifest = (): PublishedAudioManifest => ({ version: 2, chapters: {} });

/** Audio is optional: a missing or broken manifest must not block chapter builds. */
export async function loadPublishedAudioManifest(
	source: string | URL = new URL('../../../public/audio/manifest.json', import.meta.url),
	warn: (message: string) => void = console.warn,
): Promise<PublishedAudioManifest> {
	try {
		const parsed: unknown = JSON.parse(await readFile(source, 'utf8'));
		if (
			typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)
			|| !('version' in parsed) || parsed.version !== 2
			|| !('chapters' in parsed) || typeof parsed.chapters !== 'object'
			|| parsed.chapters === null || Array.isArray(parsed.chapters)
		) {
			throw new Error('音频清单必须包含 version: 2 和 chapters 对象');
		}
		return parsed as PublishedAudioManifest;
	} catch (error) {
		warn(`跳过音频播放器：无法读取音频清单（${error instanceof Error ? error.message : String(error)}）。正文构建继续。`);
		return emptyManifest();
	}
}
