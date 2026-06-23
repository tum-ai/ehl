/**
 * Split admin-entered free text into paragraphs for safe rendering.
 *
 * Admins type a plain-text message block (acceptance email custom note, broadcast
 * body). We split on blank lines into paragraphs and render each as a React text
 * child / `whitespace-pre-line` element, never as HTML. React escapes text content
 * by default, so this is XSS-safe: there is no markdown parser and no
 * dangerouslySetInnerHTML anywhere in this path.
 *
 * - Splits on one or more blank lines (a run of newlines with optional whitespace).
 * - Trims each paragraph and drops empties, so leading/trailing blank lines and
 *   stray whitespace never produce empty <Text> elements.
 * - Single newlines inside a paragraph are preserved verbatim (the renderer uses
 *   `whitespace-pre-line`), so a soft line break stays a line break.
 */
export function splitParagraphs(text: string): string[] {
  if (!text) return [];
  return text
    .replace(/\r\n/g, "\n")
    .split(/\n[ \t]*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}
