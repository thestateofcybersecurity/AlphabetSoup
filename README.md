# Cybersecurity Alphabet Soup

A plain-English cybersecurity reference at [cybersecurityalphabetsoup.com](https://cybersecurityalphabetsoup.com):

- **Acronym dictionary**: 545 acronyms, each with its expansion, a short explanation of what it is and why it matters, a category and difficulty, and authoritative sources.
- **NIST CSF 2.0 in plain English** (`/frameworks/nist-csf/`): all 106 subcategories translated with household metaphors.
- **CIS Controls v8 in plain English** (`/frameworks/cis/`): all 153 safeguards, same treatment.
- **Practice quizzes** (`/quiz/`): 1,230 questions across 18 decks (Security+, CISSP, CEH, CHFI, CySA+, GSEC, SSCP, LPT, CISM, CISA, CRISC, CCSP, CCSK, OSCP, PenTest+, CASP+/SecurityX, PNPT, plus a fundamentals flip deck), with per-answer rationales, persistent progress, and missed-question review.
- **Self-assessments** (`/assess/`): three modules, all scored instantly in the browser with nothing uploaded. Ransomware readiness (48 practices, modeled on the CISA Ransomware Readiness Assessment), the CISA Cross-Sector Cybersecurity Performance Goals (34 goals, v2.0), and CIS IG1 essentials (56 safeguards). Each practice answers Yes / Other control / N/A / No (N/A drops out of the score), carries plain-English "why it matters" and "first step" guidance with authoritative CISA, NIST, and CIS links, and supports private notes and a mark-for-review flag. Results include a coverage radar, answer distribution, cumulative maturity-tier attainment, ranked areas for improvement, score history, JSON export/import, and a roadmap-gap handoff.
- **Cross-framework mapping**: every CSF subcategory links its related CIS safeguards and vice versa (unofficial, adversarially verified), on both the interactive pages and the generated static pages.
- **Roadmap planner** (`/roadmap/`): turn NIST CSF 2.0 (22 categories), CIS Controls v8 (18 controls, scoped by implementation group), a vCISO engagement template (89 tasks with hour estimates), or your own assessment gaps into a quarter-by-quarter plan with status tracking, CSV export, and print.

Sister properties are linked from the site nav: [Cyberdle](https://thestateofcybersecurity.github.io/cyberdle/) (the daily acronym guessing game, which shares this repo's acronym dataset) and [MITRE ATT&CK Adventure](https://mitre.cybersecurityalphabetsoup.com/).

Everything runs client-side: there is no backend and no account. Progress (quiz history, assessment answers, roadmap plans) lives only in the visitor's browser via `localStorage`, and nothing is uploaded.

## How it works

- **Homepage** ([index.html](index.html) + [src/main.ts](src/main.ts)): instant ranked search, category pills, A-Z browsing, a date-seeded "Soup of the Day", and paged results ("Show more"). Queries that match a framework control or a quiz deck also surface cross-section hits.
- **Generated pages**: `npm run build` runs Vite, then [scripts/generate-pages.ts](scripts/generate-pages.ts) renders SEO-friendly static pages: one per acronym (`dist/definitions/<slug>.html`), one per CSF subcategory, and one per CIS safeguard (804 total), each with canonical URL, Open Graph tags, JSON-LD, and cross-links. It also emits redirects for every legacy URL from the old hand-written site, `sitemap.xml`, and `robots.txt`.
- **Framework, quiz, assess, and roadmap pages**: each is an additional Vite entry sharing `style.css` with its own accent theme.
- **Data** ([src/data/](src/data/)): `acronyms.json`, `nist-csf.json`, `cis.json`, the `csf-cis-map.json` crosswalk, and the `quiz/` decks, all fact-checked. `npm run validate:data` enforces the schemas, including exact CSF (106) and CIS (153) completeness and the mapping's integrity; `npm run check:links` verifies every acronym source URL (also runs weekly in CI).

## Development

```bash
npm install
npm run dev            # local dev server (interactive pages; generated pages are built by npm run build)
npm test               # Vitest unit tests (search, slugs/redirects, frameworks, quiz, assessment, roadmap)
npm run validate:data  # dataset schema + completeness + mapping validation
npm run check:links    # verify every acronym source URL resolves
npm run build          # typecheck + Vite build + generate 804 static pages into dist/
npm run test:e2e       # Playwright end-to-end tests (run npm run build first)
npm run shots          # capture every page (light/dark, desktop/mobile) to ./shots for visual review
```

## Deployment

Pushes to `main` run validation, tests, the full build, and E2E, then deploy `dist/` to GitHub Pages via `.github/workflows/deploy.yml`. One-time setup: set Pages > Source to "GitHub Actions" in the repository settings (the custom domain setting is preserved).
