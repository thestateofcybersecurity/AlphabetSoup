# Cybersecurity Alphabet Soup

A plain-English dictionary of 545 cybersecurity acronyms at [cybersecurityalphabetsoup.com](https://cybersecurityalphabetsoup.com). Every entry has its expansion, a short explanation of what it is and why it matters, a category and difficulty, and authoritative sources.

The dataset is shared with [Cyberdle](https://github.com/thestateofcybersecurity/cyberdle), the daily acronym guessing game.

## How it works

- **Homepage** ([index.html](index.html) + [src/main.ts](src/main.ts)): instant ranked search, category pills, difficulty filter, A-Z browsing, and a date-seeded "Soup of the Day".
- **Static definition pages**: `npm run build` runs Vite, then [scripts/generate-pages.ts](scripts/generate-pages.ts) renders one SEO-friendly page per acronym into `dist/definitions/<slug>.html` (canonical URL, Open Graph tags, JSON-LD DefinedTerm, related terms), plus redirects for every legacy URL from the old hand-written site, a sitemap, and robots.txt.
- **Data** ([src/data/acronyms.json](src/data/acronyms.json)): the shared, fact-checked dataset. `npm run validate:data` enforces the schema; `npm run check:links` verifies every source URL (also runs weekly in CI).

## Development

```bash
npm install
npm run dev        # local dev server (homepage only; definition pages are generated at build)
npm test           # unit tests (search ranking, slugs/redirects, soup of the day, dataset)
npm run build      # typecheck + Vite build + generate 545 static pages into dist/
npm run test:e2e   # Playwright end-to-end tests (run npm run build first)
```

## Deployment

Pushes to `main` run validation, tests, the full build, and E2E, then deploy `dist/` to GitHub Pages via `.github/workflows/deploy.yml`. One-time setup: set Pages > Source to "GitHub Actions" in the repository settings (the custom domain setting is preserved).
