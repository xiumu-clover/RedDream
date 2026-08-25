import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const chapters = defineCollection({
	loader: glob({
		base: './content/chapters',
		pattern: '**/*.md',
	}),
	schema: z.object({
		title: z.string().optional(),
		order: z.number().int().nonnegative().optional(),
		description: z.string().optional(),
	}),
});

export const collections = { chapters };
