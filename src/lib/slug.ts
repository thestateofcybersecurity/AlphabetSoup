/** Canonical page slug for an acronym key: lowercase alphanumerics. */
export function slugForKey(key: string): string {
  return key.toLowerCase();
}

/**
 * Normalize a legacy page slug (e.g. "pci-dss", "iso-27001", "cipp-us")
 * to a candidate dataset key ("PCIDSS", "ISO27001", "CIPPUS").
 */
export function keyFromLegacySlug(slug: string): string {
  return slug.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Legacy slugs that no longer have an entry of their own but have a close
 * current equivalent worth redirecting to (instead of a search fallback).
 */
export const LEGACY_ALIASES: Record<string, string> = {
  sha: 'SHA256',
  wpa: 'WPA2',
  tkip: 'WPA2',
  ccmp: 'WPA3',
  iso: 'ISO27001',
  'iso 27002': 'ISO27001',
  'iso 27005': 'ISO27001',
  fido: 'FIDO2',
  'soc 3': 'SOC2',
  cipp: 'CIPPUS',
  'cipp-a': 'CIPPUS',
  'cipp-c': 'CIPPUS',
  'cipp-m': 'CIPM',
  ccna: 'CCNP',
  ccie: 'CCNP',
  c2: 'CNC',
  ir: 'DFIR',
  dr: 'DRP',
  psk: 'WPA2',
  ca: 'X509',
  pt: 'PTES',
};

/** Resolve a legacy slug to a current dataset key, or null. */
export function resolveLegacySlug(slug: string, keys: Set<string>): string | null {
  const direct = keyFromLegacySlug(slug);
  if (keys.has(direct)) return direct;
  const alias = LEGACY_ALIASES[slug.toLowerCase()];
  return alias && keys.has(alias) ? alias : null;
}
