import aiRaw from './data/ai-frameworks.json';
import type { AiData } from './lib/frameworks';
import { AI_FRAMEWORKS } from './lib/frameworks';
import type { FrameworkRecord } from './lib/framework-search';
import { initFrameworkPage } from './ui/framework-page';

const ai = aiRaw as AiData;
const byCode = Object.fromEntries(ai.map((entry) => [entry.code, entry]));

const records: FrameworkRecord[] = ai.map((entry) => ({
  id: entry.code,
  group: entry.frameworkCode,
  heading: entry.official,
  metaphor: entry.metaphor,
  translation: entry.translation,
  keywords: `${entry.framework} ${entry.category} ${entry.title}`,
}));

initFrameworkPage({
  records,
  section: 'ai',
  groups: AI_FRAMEWORKS.map(([code, label]) => ({ value: code, label })),
  kicker: (record) => {
    const entry = byCode[record.id];
    // The AI RMF uses a long official statement as its title; fall back to the
    // short category label (the function name) so the kicker stays scannable.
    const label = entry.title.length <= 40 ? entry.title : entry.category;
    return `${entry.framework} · ${label}`;
  },
  countNoun: 'translations',
});
