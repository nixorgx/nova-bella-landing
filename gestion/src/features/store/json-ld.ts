/**
 * Serializes a JSON-LD object for an inline <script type="application/ld+json">. This is the ONE place the app
 * uses dangerouslySetInnerHTML: the data comes from our own catalog, and every character that could close the
 * script element or start HTML (<, >, &) and the JS line separators are escaped, so it cannot break out.
 */
const HTML_ESCAPES: Readonly<Record<string, string>> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
};
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const PARAGRAPH_SEPARATOR = String.fromCharCode(0x2029);

export function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/[<>&]/g, (char) => HTML_ESCAPES[char])
    .split(LINE_SEPARATOR)
    .join("\\u2028")
    .split(PARAGRAPH_SEPARATOR)
    .join("\\u2029");
}
