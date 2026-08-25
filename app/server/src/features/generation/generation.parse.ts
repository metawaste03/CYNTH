/**
 * Splits a generated article into a title and a body.
 *
 * The Prompt Builder is Cynth's single source of truth for the prompt and it
 * does not dictate an output format, so this reads what the model actually
 * produced rather than assuming a contract. It is deliberately conservative:
 * a title is only recognised when the text clearly opens with one, and
 * otherwise the whole response is kept as the body and the draft's working
 * title stands in for display. Nothing is ever discarded.
 */

export interface ParsedArticle {
  /** The title the model wrote, or null when it didn't clearly write one. */
  title: string | null;
  /** The article body. Equals the full response when no title was found. */
  body: string;
}

const MAX_TITLE_LENGTH = 140;

/** Strips Markdown emphasis and a leading "Title:" label a model may add. */
function cleanTitle(line: string): string {
  return line
    .replace(/^\s*(?:title|working title)\s*:\s*/i, '')
    .replace(/^\*\*(.+)\*\*$/, '$1')
    .replace(/^_(.+)_$/, '$1')
    .replace(/^"(.+)"$/, '$1')
    .trim();
}

function isPlausibleTitle(text: string): boolean {
  return text.length > 0 && text.length <= MAX_TITLE_LENGTH && !/[.!?:;]$/.test(text) && !text.includes('\n');
}

export function parseGeneratedArticle(text: string): ParsedArticle {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return { title: null, body: '' };

  const lines = normalized.split('\n');
  const firstLine = lines[0].trim();
  const rest = () => lines.slice(1).join('\n').replace(/^\n+/, '').trim();

  // A level-1 Markdown heading is unambiguous — take it.
  const heading = /^#\s+(.+)$/.exec(firstLine);
  if (heading) {
    const title = cleanTitle(heading[1]);
    if (title) return { title, body: rest() };
  }

  // An explicitly labelled title line is equally unambiguous.
  if (/^\s*(?:title|working title)\s*:/i.test(firstLine)) {
    const title = cleanTitle(firstLine);
    if (title) return { title, body: rest() };
  }

  // Otherwise: a short, unpunctuated opening line followed by a blank line
  // reads as a title. Anything else is treated as the start of the body.
  const secondLineIsBlank = lines.length > 1 && lines[1].trim() === '';
  if (secondLineIsBlank) {
    const candidate = cleanTitle(firstLine);
    if (isPlausibleTitle(candidate)) return { title: candidate, body: rest() };
  }

  return { title: null, body: normalized };
}
