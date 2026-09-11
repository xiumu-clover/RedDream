import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const chapterSchema = z.object({
	title: z.string().optional(),
	order: z.number().int().nonnegative().optional(),
	description: z.string().optional(),
});

const hongloumengChapters = defineCollection({
	loader: glob({
		base: './content/chapters/hongloumeng',
		pattern: '**/*.md',
	}),
	schema: chapterSchema,
});

const guiyouChapters = defineCollection({
	loader: glob({
		base: './content/chapters/guiyou',
		pattern: '**/*.md',
	}),
	schema: chapterSchema,
});

const guiyouOriginalChapters = defineCollection({
	loader: glob({
		base: './content/chapters/guiyou-original',
		pattern: '**/*.md',
	}),
	schema: chapterSchema,
});

export const collections = {
	hongloumengChapters,
	guiyouChapters,
	guiyouOriginalChapters,
};
