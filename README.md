# Cybersecurity Alphabet Soup

A plain-English cybersecurity reference at [cybersecurityalphabetsoup.com](https://cybersecurityalphabetsoup.com):

- **Acronym dictionary**: 545 acronyms, each with its expansion, a short explanation of what it is and why it matters, a category and difficulty, and authoritative sources.
- **NIST CSF 2.0 in plain English** (`/frameworks/nist-csf/`): all 106 subcategories translated with household metaphors.
- **CIS Controls v8 in plain English** (`/frameworks/cis/`): all 153 safeguards, same treatment.
- **Practice quizzes** (`/quiz/`): 681 questions across 9 decks, from Security+ and CISSP multiple-choice rounds to fundamentals flashcards, with missed-question review.
- **Ransomware readiness assessment** (`/assess/`): 48 yes/no questions across ten goals and three maturity tiers, scored instantly in the browser with gap guidance linked to the CIS translations.

The acronym dataset is shared with [Cyberdle](https://github.com/thestateofcybersecurity/cyberdle), the daily acronym guessing game.

## How it works

- **Homepage** ([index.html](index.html) + [src/main.ts](src/main.ts)): instant ranked search, category pills, difficulty filter, A-Z browsing, and a date-seeded "Soup of the Day".
- **Static definition pages**: `npm run build` runs Vite, then [scripts/generate-pages.ts](scripts/generate-pages.ts) renders one SEO-friendly page per acronym into `dist/definitions/<slug>.html` (canonical URL, Open Graph tags, JSON-LD DefinedTerm, related terms), plus redirects for every legacy URL from the old hand-written site, a sitemap, and robots.txt.
- **Framework pages**: `frameworks/nist-csf/` and `frameworks/cis/` are additional Vite entries with ranked search, function/control filter pills, and a deterministic Soup of the Day. The generator also renders one static page per subcategory and safeguard.
- **Data** ([src/data/acronyms.json](src/data/acronyms.json), [src/data/nist-csf.json](src/data/nist-csf.json), [src/data/cis.json](src/data/cis.json)): all fact-checked. `npm run validate:data` enforces the schemas, including exact CSF (106) and CIS (153) completeness; `npm run check:links` verifies every acronym source URL (also runs weekly in CI).

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
