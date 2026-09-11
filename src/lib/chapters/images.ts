import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { CompiledChapter } from './compiler.ts';
import { ChapterSyntaxError } from './compiler.ts';

export interface ValidateChapterImagesOptions {
	publicDirectory?: string;
}

export async function validateChapterImages(
	chapter: CompiledChapter,
	options: ValidateChapterImagesOptions = {},
): Promise<void> {
	const publicDirectory = options.publicDirectory ?? resolve(process.cwd(), 'public');
	const imageDirectory = resolve(publicDirectory, 'images', 'chapters');

	await Promise.all(chapter.images.map(async (image) => {
		const filePath = resolve(imageDirectory, image.fileName);
		let isFile = false;
		try {
			isFile = (await stat(filePath)).isFile();
		} catch {
			// 下面用包含源码位置的统一错误报告缺失或不可读取的文件。
		}

		if (!isFile) {
			throw new ChapterSyntaxError(
				`图片文件不存在：public/images/chapters/${image.fileName}。`,
				chapter.sourceName,
				image.position,
			);
		}
	}));
}
