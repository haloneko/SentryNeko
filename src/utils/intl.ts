/** Cached `Intl` formatters, keyed by language and options. */

const CACHE = new Map<string, Intl.DateTimeFormat>();

/**
 * A date formatter for `options` in `language`, built once and kept for the life of the window.
 *
 * Building a formatter is the expensive half of formatting a date; the views that draw a calendar or
 * a heatmap format the same shapes on every render, so the formatters are shared instead of rebuilt.
 */
export function dateFormatter(
  language: string,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = `${language}:${JSON.stringify(options)}`;
  let formatter = CACHE.get(key);

  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat(language, options);
    CACHE.set(key, formatter);
  }

  return formatter;
}
