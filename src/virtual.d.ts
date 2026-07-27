/**
 * The acronym index is produced by the `acronym-index` plugin in vite.config.ts
 * rather than existing on disk, so its type has to be declared here.
 */
declare module 'virtual:acronym-index' {
  import type { AcronymIndex } from './lib/types';

  const index: AcronymIndex;
  export default index;
}
