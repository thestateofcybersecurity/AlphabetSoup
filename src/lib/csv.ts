/**
 * CSV cell hygiene shared by every exporter.
 *
 * Spreadsheets treat a cell that starts with = + - @ (and, in some versions,
 * a tab or carriage return) as a formula, so a free-text field such as an
 * owner or a note that begins with one of them executes when the export is
 * opened in Excel or LibreOffice. Prefixing a single quote makes the cell
 * literal text; the quote is visible in the formula bar only. This follows
 * the OWASP CSV injection guidance.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/** Neutralize a leading formula trigger. Quoting is still the caller's job. */
export function neutralizeFormula(value: string): string {
  return FORMULA_LEAD.test(value) ? `'${value}` : value;
}

/**
 * One CSV cell: formula triggers neutralized, then quoted when the value
 * holds a quote, a comma, or a line break (CR as well as LF, since some
 * readers end a row on either). Every exporter that writes a value a user
 * typed, or could have restored from a backup, goes through this.
 */
export function csvCell(raw: string): string {
  const value = neutralizeFormula(raw);
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
