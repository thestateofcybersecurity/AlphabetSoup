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
