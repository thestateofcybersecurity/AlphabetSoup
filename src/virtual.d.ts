/**
 * The acronym index is produced by the `acronym-index` plugin in vite.config.ts
 * rather than existing on disk, so its type has to be declared here.
 */
declare module 'virtual:acronym-index' {
  import type { AcronymIndex } from './lib/types';

  const index: AcronymIndex;
  export default index;
}

/**
 * Question counts per assessment id, computed from the same sources and by the
 * same builders the app uses, so the picker can print them without loading any
 * dataset. Also produced in vite.config.ts.
 */
declare module 'virtual:assessment-counts' {
  const counts: Record<string, number>;
  export default counts;
}
