/**
 * The SEO document model.
 *
 * Turns a generated article body into an addressable structure — headings,
 * sections, paragraphs, lists, links, images — with character offsets, so
 * every finding can point at the passage it is about instead of describing
 * the article in general.
 *
 * Deliberately a small hand-written parser rather than a Markdown dependency,
 * matching the precedent set by cms/articleMarkup.ts. It reads exactly what
 * Cynth's generation prompt produces: ATX headings, paragraphs, bullet and
 * numbered lists, blockquotes, fenced code, inline links and images.
 *
 * This module is pure: it reads text and returns structure. It makes no
 * judgements, contacts nothing, and never modifies the article.
 */

export interface DocumentHeading {
  /** 1-6, as written. */
  level: number;
  text: string;
  /** Outermost-first path of ancestor headings, excluding this one. */
  path: string[];
  startOffset: number;
  endOffset: number;
  /** Index into SeoDocument.headings. */
  index: number;
}

export interface DocumentParagraph {
  text: string;
  startOffset: number;
  endOffset: number;
  /** Index into SeoDocument.paragraphs. */
  index: number;
  /** The heading this paragraph sits under, or null when it precedes any heading. */
  headingIndex: number | null;
  sentenceCount: number;
  wordCount: number;
  /** Whether this paragraph is inside a list item rather than free prose. */
  isListItem: boolean;
  /**
   * For a list item, whether the list was ordered. Null for free prose.
   *
   * Kept distinct because the difference is load-bearing: HowTo structured
   * data describes a sequence of steps, and a bullet list of product picks is
   * not one. Collapsing the two would let a listicle claim eligibility for
   * markup it does not qualify for.
   */
  listOrdered: boolean | null;
}

/** A heading and everything beneath it, up to the next heading of the same or higher level. */
export interface DocumentSection {
  index: number;
  /** Null for the lead-in text before the first heading. */
  headingIndex: number | null;
  heading: string | null;
  level: number | null;
  startOffset: number;
  endOffset: number;
  text: string;
  wordCount: number;
  paragraphIndexes: number[];
  hasList: boolean;
}

export interface DocumentLink {
  url: string;
  anchorText: string;
  startOffset: number;
  /** True for http(s) URLs pointing outside the article. */
  isExternal: boolean;
  /** True for root-relative or same-site links. */
  isInternal: boolean;
  host: string | null;
  /** Which paragraph it sits in, when it sits in one. */
  paragraphIndex: number | null;
}

export interface DocumentImage {
  /** The image source exactly as written. Cynth never invents one. */
  source: string;
  altText: string;
  startOffset: number;
  /** True when the alt text is empty or whitespace only. */
  missingAlt: boolean;
  /** The filename portion of the source, when the source has one. */
  filename: string | null;
  paragraphIndex: number | null;
}

export interface SeoDocument {
  /** The body exactly as analysed. Offsets are into this string. */
  body: string;
  headings: DocumentHeading[];
  paragraphs: DocumentParagraph[];
  sections: DocumentSection[];
  links: DocumentLink[];
  images: DocumentImage[];
  /** All prose with Markdown markers removed — what a reader actually reads. */
  plainText: string;
  words: string[];
  wordCount: number;
  sentences: string[];
  /** The opening prose of the article: everything before the first heading, else the first paragraphs. */
  introduction: { text: string; paragraphIndexes: number[] } | null;
  /** The closing prose, for the intent/conclusion checks. */
  conclusion: { text: string; paragraphIndexes: number[] } | null;
}

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;
const LINK_PATTERN = /(?<!!)\[([^\]]+)\]\(([^\s)]+)(?:\s+"[^"]*")?\)/g;

/** Strips inline Markdown so word counts and keyword matching see prose, not syntax. */
export function stripInlineMarkdown(text: string): string {
  return text
    .replace(IMAGE_PATTERN, '$1')
    .replace(LINK_PATTERN, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/~~([^~]+)~~/g, '$1')
    .trim();
}

/** Lowercased word tokens. Apostrophes are kept inside words so "reader's" stays one word. */
export function tokenize(text: string): string[] {
  const matched = text.toLowerCase().match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*/gu);
  return matched ?? [];
}

/**
 * Splits prose into sentences.
 *
 * Approximate by nature: abbreviations and decimals defeat any regex. It is
 * used for diagnostics (how long are the sentences) rather than for anything
 * that decides an outcome, and the thresholds it feeds are extreme enough
 * that an occasional mis-split cannot change a verdict.
 */
export function splitSentences(text: string): string[] {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];

  const parts: string[] = [];
  let current = '';

  for (let i = 0; i < normalized.length; i += 1) {
    const char = normalized[i];
    current += char;

    if (char === '.' || char === '!' || char === '?') {
      const next = normalized[i + 1];
      const previousWord = current.trim().split(/\s+/).pop() ?? '';
      // "Dr." / "e.g." / "3.5" are not sentence ends.
      const isAbbreviation = /^(?:[A-Z][a-z]{0,3}|[a-z]\.[a-z]|\d+)\.$/.test(previousWord);
      if (!isAbbreviation && (next === undefined || next === ' ')) {
        parts.push(current.trim());
        current = '';
      }
    }
  }

  if (current.trim()) parts.push(current.trim());
  return parts.filter(Boolean);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Parses a generated article body into the SEO document model.
 *
 * Offsets are into the body string exactly as passed in, so a finding's
 * locator can be used to highlight the passage without re-parsing.
 */
export function parseSeoDocument(rawBody: string): SeoDocument {
  const body = rawBody.replace(/\r\n/g, '\n');
  const headings: DocumentHeading[] = [];
  const paragraphs: DocumentParagraph[] = [];
  const links: DocumentLink[] = [];
  const images: DocumentImage[] = [];

  // Ancestor stack, so each heading knows its path without a second pass.
  const openPath: { level: number; text: string }[] = [];

  let offset = 0;
  let inCodeFence = false;
  let paragraphLines: { text: string; start: number }[] = [];
  let currentHeadingIndex: number | null = null;
  let pendingListItem = false;
  let pendingListOrdered: boolean | null = null;

  const flushParagraph = () => {
    if (!paragraphLines.length) return;
    const text = paragraphLines.map((line) => line.text).join(' ').trim();
    const start = paragraphLines[0].start;
    const last = paragraphLines[paragraphLines.length - 1];
    const end = last.start + last.text.length;
    paragraphLines = [];

    if (!text) {
      pendingListItem = false;
      pendingListOrdered = null;
      return;
    }

    const plain = stripInlineMarkdown(text);
    paragraphs.push({
      text,
      startOffset: start,
      endOffset: end,
      index: paragraphs.length,
      headingIndex: currentHeadingIndex,
      sentenceCount: splitSentences(plain).length,
      wordCount: tokenize(plain).length,
      isListItem: pendingListItem,
      listOrdered: pendingListItem ? pendingListOrdered : null,
    });
    pendingListItem = false;
    pendingListOrdered = null;
  };

  for (const line of body.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;

    const fence = /^\s*```/.test(line);
    if (fence) {
      flushParagraph();
      inCodeFence = !inCodeFence;
      continue;
    }
    if (inCodeFence) continue;

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      const text = stripInlineMarkdown(heading[2].trim());

      while (openPath.length && openPath[openPath.length - 1].level >= level) openPath.pop();

      headings.push({
        level,
        text,
        path: openPath.map((entry) => entry.text),
        startOffset: lineStart,
        endOffset: lineStart + line.length,
        index: headings.length,
      });
      currentHeadingIndex = headings.length - 1;
      openPath.push({ level, text });
      continue;
    }

    // Each list item is its own paragraph: a finding about one bullet should
    // not point at the whole list.
    const listItem = /^\s*(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (listItem) {
      flushParagraph();
      pendingListItem = true;
      pendingListOrdered = /^\s*\d+[.)]\s/.test(line);
      paragraphLines.push({ text: listItem[1], start: lineStart + line.indexOf(listItem[1]) });
      flushParagraph();
      continue;
    }

    const quote = /^\s*>\s?(.*)$/.exec(line);
    if (quote) {
      paragraphLines.push({ text: quote[1], start: lineStart + line.indexOf(quote[1]) });
      continue;
    }

    if (/^\s*(?:---+|\*\*\*+|___+)\s*$/.test(line)) {
      flushParagraph();
      continue;
    }

    paragraphLines.push({ text: line.trim(), start: lineStart });
  }
  flushParagraph();

  /** Which paragraph an absolute offset falls inside, when it falls inside one. */
  const paragraphAt = (position: number): number | null => {
    const found = paragraphs.find((p) => position >= p.startOffset && position <= p.endOffset);
    return found ? found.index : null;
  };

  // Images before links, since an image is a link with a leading '!'.
  IMAGE_PATTERN.lastIndex = 0;
  for (let match = IMAGE_PATTERN.exec(body); match !== null; match = IMAGE_PATTERN.exec(body)) {
    const source = match[2];
    const filenameMatch = /([^/\\?#]+)(?:[?#].*)?$/.exec(source);
    images.push({
      source,
      altText: match[1].trim(),
      startOffset: match.index,
      missingAlt: match[1].trim().length === 0,
      filename: filenameMatch ? filenameMatch[1] : null,
      paragraphIndex: paragraphAt(match.index),
    });
  }

  LINK_PATTERN.lastIndex = 0;
  for (let match = LINK_PATTERN.exec(body); match !== null; match = LINK_PATTERN.exec(body)) {
    const url = match[2];
    const isAbsolute = /^https?:\/\//i.test(url);
    links.push({
      url,
      anchorText: match[1].trim(),
      startOffset: match.index,
      isExternal: isAbsolute,
      isInternal: !isAbsolute,
      host: isAbsolute ? hostOf(url) : null,
      paragraphIndex: paragraphAt(match.index),
    });
  }

  /* -------------------------------------------------------------- sections */

  const sections: DocumentSection[] = [];
  const pushSection = (headingIndex: number | null, start: number, end: number) => {
    const text = body.slice(start, end);
    const paragraphIndexes = paragraphs
      .filter((p) => p.startOffset >= start && p.startOffset < end)
      .map((p) => p.index);
    const heading = headingIndex === null ? null : headings[headingIndex];

    sections.push({
      index: sections.length,
      headingIndex,
      heading: heading ? heading.text : null,
      level: heading ? heading.level : null,
      startOffset: start,
      endOffset: end,
      text,
      wordCount: tokenize(stripInlineMarkdown(text)).length,
      paragraphIndexes,
      hasList: paragraphIndexes.some((index) => paragraphs[index].isListItem),
    });
  };

  if (headings.length === 0) {
    if (body.trim()) pushSection(null, 0, body.length);
  } else {
    if (headings[0].startOffset > 0 && body.slice(0, headings[0].startOffset).trim()) {
      pushSection(null, 0, headings[0].startOffset);
    }
    headings.forEach((heading, index) => {
      const next = headings[index + 1];
      pushSection(heading.index, heading.startOffset, next ? next.startOffset : body.length);
    });
  }

  /* ------------------------------------------------------------ aggregates */

  const plainText = paragraphs.map((p) => stripInlineMarkdown(p.text)).join('\n\n');
  const words = tokenize(plainText);
  const sentences = splitSentences(plainText);

  /**
   * The introduction is the prose before the first heading; when the article
   * opens with a heading (the common shape), it is the paragraphs under that
   * first heading. Never invented — an article with no prose has none.
   */
  const introParagraphs = (() => {
    const beforeFirstHeading = paragraphs.filter(
      (p) => headings.length > 0 && p.startOffset < headings[0].startOffset && !p.isListItem,
    );
    if (beforeFirstHeading.length) return beforeFirstHeading.slice(0, 3);
    return paragraphs.filter((p) => !p.isListItem).slice(0, 3);
  })();

  const conclusionParagraphs = paragraphs.filter((p) => !p.isListItem).slice(-2);

  return {
    body,
    headings,
    paragraphs,
    sections,
    links,
    images,
    plainText,
    words,
    wordCount: words.length,
    sentences,
    introduction: introParagraphs.length
      ? {
          text: introParagraphs.map((p) => stripInlineMarkdown(p.text)).join('\n\n'),
          paragraphIndexes: introParagraphs.map((p) => p.index),
        }
      : null,
    conclusion: conclusionParagraphs.length
      ? {
          text: conclusionParagraphs.map((p) => stripInlineMarkdown(p.text)).join('\n\n'),
          paragraphIndexes: conclusionParagraphs.map((p) => p.index),
        }
      : null,
  };
}

/**
 * Counts exact-phrase occurrences of a term, matching on word boundaries so
 * "pack" does not match "package". Case-insensitive; punctuation between
 * words is tolerated so "budget hiking backpack" matches "budget, hiking
 * backpack" too.
 */
export function countPhraseOccurrences(text: string, phrase: string): number {
  const terms = tokenize(phrase);
  if (!terms.length) return 0;

  const haystack = tokenize(text);
  if (haystack.length < terms.length) return 0;

  let count = 0;
  for (let i = 0; i <= haystack.length - terms.length; i += 1) {
    let matched = true;
    for (let j = 0; j < terms.length; j += 1) {
      if (haystack[i + j] !== terms[j]) {
        matched = false;
        break;
      }
    }
    if (matched) count += 1;
  }
  return count;
}

/** Whether a phrase appears at all in a piece of text. */
export function containsPhrase(text: string | null | undefined, phrase: string): boolean {
  if (!text) return false;
  return countPhraseOccurrences(text, phrase) > 0;
}

/** A short verbatim quote for a finding's locator, so the user can find the passage by eye. */
export function excerptOf(text: string, maxLength = 160): string {
  const flat = stripInlineMarkdown(text).replace(/\s+/g, ' ').trim();
  return flat.length > maxLength ? `${flat.slice(0, maxLength)}…` : flat;
}
