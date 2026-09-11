## Development

When starting the dev server, use background mode:

```
astro dev --background
```

Manage the background server with `astro dev stop`, `astro dev status`, and `astro dev logs`.

## Project structure

- Keep hand-edited chapter sources in `content/chapters/` and chapter images in `public/images/chapters/`.
- Group Astro components under `src/components/{books,chapters,layout,settings}/` and business logic under `src/lib/{books,chapters,preferences}/`.
- Load website chapters through `src/lib/chapters/collection.ts`; do not duplicate collection loading, compilation, validation, or sorting in page files.
- Keep non-site research assets under the separate private repository mounted at `research/`; the website repository must not track or build from it. Keep maintenance tools under the matching `scripts/` subdirectory.
- Keep tests grouped by the same domain names used by the source and scripts.
- Do not add new top-level working or temporary directories. Put unfinished research notes in `research/drafts/`.

## Documentation

Full documentation: https://docs.astro.build

Consult these guides before working on related tasks:

- [Adding pages, dynamic routes, or middleware](https://docs.astro.build/en/guides/routing/)
- [Working with Astro components](https://docs.astro.build/en/basics/astro-components/)
- [Using React, Vue, Svelte, or other framework components](https://docs.astro.build/en/guides/framework-components/)
- [Adding or managing content](https://docs.astro.build/en/guides/content-collections/)
- [Adding styles or using Tailwind](https://docs.astro.build/en/guides/styling/)
- [Supporting multiple languages](https://docs.astro.build/en/guides/internationalization/)
