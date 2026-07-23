# Cybersecurity Alphabet Soup

A plain-English cybersecurity reference at [cybersecurityalphabetsoup.com](https://cybersecurityalphabetsoup.com):

- **Acronym dictionary**: 545 acronyms, each with its expansion, a short explanation of what it is and why it matters, a category and difficulty, and authoritative sources. Entries cross-link to related and commonly-confused terms (SSL and TLS, 2FA and MFA, SIEM and SOAR), and a mistyped search offers a "did you mean" suggestion.
- **NIST CSF 2.0 in plain English** (`/frameworks/nist-csf/`): all 106 subcategories translated with household metaphors.
- **CIS Controls v8 in plain English** (`/frameworks/cis/`): all 153 safeguards, same treatment, each tagged with its Implementation Group (IG1/IG2/IG3), filterable by IG, and searchable by control name. Both framework browsers let you mark items reviewed and show a coverage bar.
- **Practice quizzes** (`/quiz/`): 1,230 questions across 18 decks (Security+, CISSP, CEH, CHFI, CySA+, GSEC, SSCP, LPT, CISM, CISA, CRISC, CCSP, CCSK, OSCP, PenTest+, CASP+/SecurityX, PNPT, plus a fundamentals flip deck), with per-answer rationales, persistent progress, keyboard answering, an optional timed exam mode (pick 10/20/all questions, 72% to pass), spaced-repetition review of missed questions (a Leitner schedule with due dates), and session resume after a reload.
- **Self-assessments** (`/assess/`): three modules, all scored instantly in the browser with nothing uploaded. Ransomware readiness (48 practices, modeled on the CISA Ransomware Readiness Assessment), the CISA Cross-Sector Cybersecurity Performance Goals (34 goals, v2.0), and CIS IG1 essentials (56 safeguards). Each practice answers Yes / Other control / N/A / No (N/A drops out of the score), carries plain-English "why it matters" and "first step" guidance with authoritative CISA, NIST, and CIS links, and supports private notes and a mark-for-review flag. Results include a coverage radar, answer distribution, cumulative maturity-tier attainment, ranked areas for improvement, score history, JSON export/import, and a roadmap-gap handoff. The landing shows a cross-assessment posture overview: each assessment's current score, band, trend, and a re-assessment reminder when a check is over 90 days old.
- **Cross-framework mapping**: every CSF subcategory links its related CIS safeguards and vice versa (unofficial, adversarially verified), on both the interactive pages and the generated static pages.
- **Roadmap planner** (`/roadmap/`): start from a curated, comprehensive **security program** (16 consolidated goals across four phases, each with an objective, 2 to 4 measurable KPIs, mapped standards (NIST CSF, CIS, CISA CPG, 800-53, ISO 27001), and milestone tasks), or from NIST CSF 2.0 (22 categories), CIS Controls v8 (18 controls, scoped by implementation group), a vCISO engagement template (89 tasks with hour estimates), or the gaps from any of the three assessments, into a quarter-by-quarter plan. The CIS and CSF sources carry the same per-item objective, KPIs, and standard cross-links. Mark each KPI met, partial, or unmet, and the plan rolls that attainment up into a one-line program maturity level (falling back to task status where a source has no KPIs). Drag tasks between quarters, assign an owner, target date, and notes per task, map quarters to real calendar dates from a program start month, filter by group or hide completed work, and track progress on a dashboard (completion bar, status breakdown, per-quarter load). Program-goal milestones are checkable and roll up on each card and the dashboard. Program goals carry rough effort estimates that drive a per-quarter capacity timeline (hours per quarter, mapped to calendar dates, with the heaviest quarter flagged). Export to CSV or JSON (re-importable), and print.

- **AI Use Case Risk Tiering** (`/tools/ai-risk/`): answer eight anchored questions about a proposed AI use case (data sensitivity, audience, autonomy, human oversight, output consequence, model provenance, system access, training use) and get an instant Low / Medium / High risk tier with the rationale, the review path it should follow (pre-approved, lightweight review, or formal governance gate), cumulative required controls linked to the site's NIST AI RMF and OWASP LLM Top 10 plain-English translations, and a ready-to-paste policy snippet. Gating answers (regulated data, autonomous action, production write access, rights-affecting outcomes, shadow AI) force the tier up regardless of the total score, and the rationale says why. Assessed use cases save to a local register with JSON export; scoring is deterministic and everything stays in the browser.

Sister properties are linked from the site nav: [Cyberdle](https://thestateofcybersecurity.github.io/cyberdle/) (the daily acronym guessing game, which shares this repo's acronym dataset) and [MITRE ATT&CK Adventure](https://mitre.cybersecurityalphabetsoup.com/).

Everything runs client-side: there is no backend and no account. Progress (quiz history, assessment answers, roadmap plans) lives only in the visitor's browser via `localStorage`, and nothing is uploaded.

## How it works

- **Homepage** ([index.html](index.html) + [src/main.ts](src/main.ts)): instant ranked search, category pills, A-Z browsing, a date-seeded "Soup of the Day", and paged results ("Show more"). Queries that match a framework control or a quiz deck also surface cross-section hits.
- **Generated pages**: `npm run build` runs Vite, then [scripts/generate-pages.ts](scripts/generate-pages.ts) renders SEO-friendly static pages: one per acronym (`dist/definitions/<slug>.html`), one per CSF subcategory, and one per CIS safeguard (804 total), each with canonical URL, Open Graph tags, JSON-LD, and cross-links. Every acronym also gets a per-term 1200x630 social image (rendered at build with satori and resvg) so shared links unfurl with the term and its expansion. It also emits redirects for every legacy URL from the old hand-written site, `sitemap.xml`, and `robots.txt`.
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
