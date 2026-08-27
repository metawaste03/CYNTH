/**
 * Renders a generated article body into the HTML a CMS expects.
 *
 * Cynth's models write Markdown-flavoured prose. WordPress stores HTML.
 * Pushing the raw text would produce a draft with visible `##` and `**` in
 * it, so the body is translated — but translated only, never embellished:
 * nothing is added that the author did not write, and anything this renderer
 * does not recognise survives as plain text rather than being dropped.
 *
 * Deliberately a small hand-written renderer rather than a Markdown
 * dependency (docs/04_DEVELOPMENT_RULES.md, "no unnecessary dependencies").
 * It covers what the generation prompt actually produces: headings,
 * paragraphs, lists, blockquotes, code, emphasis and links.
 *
 * SECURITY: the source is escaped before any markup is introduced, so text
 * that happens to contain angle brackets cannot inject HTML into a post.
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Sentinel used to park code spans while emphasis is applied.
 *
 * `<` cannot survive escapeHtml(), so this sequence cannot occur in the text
 * being processed and the restore step can never collide with prose. (An
 * earlier bare-number placeholder could have: "I have 3 cats" would have been
 * rewritten into a code span.)
 */
const CODE_SPAN_OPEN = '<<cynth-code:';
const CODE_SPAN_CLOSE = '>>';
const CODE_SPAN_PATTERN = /<<cynth-code:(\d+)>>/g;

/**
 * Inline formatting, applied to already-escaped text.
 *
 * Order matters: code spans are extracted first so emphasis markers inside
 * them are left alone, and bold is matched before italic so `**x**` does not
 * become nested emphasis.
 */
function renderInline(escaped: string): string {
  const codeSpans: string[] = [];

  let output = escaped.replace(/`([^`]+)`/g, (_match, code: string) => {
    codeSpans.push(`<code>${code}</code>`);
    return `${CODE_SPAN_OPEN}${codeSpans.length - 1}${CODE_SPAN_CLOSE}`;
  });

  output = output
    // [text](url) — only http(s) and root-relative targets are linkified, so
    // an article body can never introduce a javascript: URL into a post.
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|\/[^\s)]*)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
    .replace(/(^|[^_])_([^_]+)_(?!_)/g, '$1<em>$2</em>');

  return output.replace(CODE_SPAN_PATTERN, (_match, index: string) => codeSpans[Number(index)] ?? '');
}

interface ListState {
  ordered: boolean;
  items: string[];
}

/** Renders a generated article body to HTML. Returns an empty string for empty input — never a placeholder. */
export function articleBodyToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const blocks: string[] = [];

  let paragraph: string[] = [];
  let list: ListState | null = null;
  let quote: string[] = [];
  let codeFence: { language: string | null; lines: string[] } | null = null;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    blocks.push(`<p>${renderInline(escapeHtml(paragraph.join(' ')))}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!list) return;
    const tag = list.ordered ? 'ol' : 'ul';
    const items = list.items.map((item) => `<li>${renderInline(escapeHtml(item))}</li>`).join('\n');
    blocks.push(`<${tag}>\n${items}\n</${tag}>`);
    list = null;
  };

  const flushQuote = () => {
    if (!quote.length) return;
    blocks.push(`<blockquote><p>${renderInline(escapeHtml(quote.join(' ')))}</p></blockquote>`);
    quote = [];
  };

  const flushAll = () => {
    flushParagraph();
    flushList();
    flushQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/, '');

    // Fenced code: everything inside is verbatim, so it is handled before any
    // other rule could reinterpret it.
    const fence = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fence) {
      if (codeFence) {
        const body = escapeHtml(codeFence.lines.join('\n'));
        const cls = codeFence.language ? ` class="language-${escapeHtml(codeFence.language)}"` : '';
        blocks.push(`<pre><code${cls}>${body}</code></pre>`);
        codeFence = null;
      } else {
        flushAll();
        codeFence = { language: fence[1] || null, lines: [] };
      }
      continue;
    }
    if (codeFence) {
      codeFence.lines.push(rawLine);
      continue;
    }

    if (!line.trim()) {
      flushAll();
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      flushAll();
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInline(escapeHtml(heading[2].trim()))}</h${level}>`);
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushAll();
      blocks.push('<hr />');
      continue;
    }

    const quoted = line.match(/^\s*>\s?(.*)$/);
    if (quoted) {
      flushParagraph();
      flushList();
      quote.push(quoted[1]);
      continue;
    }
    flushQuote();

    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (bullet || numbered) {
      flushParagraph();
      const ordered = Boolean(numbered);
      if (list && list.ordered !== ordered) flushList();
      if (!list) list = { ordered, items: [] };
      list.items.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();

    paragraph.push(line.trim());
  }

  // An unterminated fence is still content the author wrote — emit it rather
  // than losing it.
  if (codeFence) blocks.push(`<pre><code>${escapeHtml(codeFence.lines.join('\n'))}</code></pre>`);
  flushAll();

  return blocks.join('\n\n');
}
