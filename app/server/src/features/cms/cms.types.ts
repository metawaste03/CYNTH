/**
 * Cynth's CMS-agnostic publishing contract (Milestone 13).
 *
 *   Cynth  ->  CMS Connector  ->  WordPress
 *
 * Everything upstream of a connector speaks only these types. WordPress is
 * the first connector implemented, not the shape of the abstraction: adding
 * Ghost, Craft, or a static-site generator means writing one connector that
 * translates these types into that system's API, and nothing else in Cynth
 * changes.
 *
 * Nothing in this file mentions WordPress, and nothing in it carries a
 * credential beyond the single call context that authenticates one request.
 */

/** Per-call endpoint and credentials. Never logged, never persisted, never returned to the client. */
export interface CmsCallContext {
  /** The site root, e.g. http://everyfivedays.local. Configured by the user; never hardcoded. */
  baseUrl: string;
  /** The account Cynth authenticates as, where the CMS uses one. */
  username: string | null;
  /** The secret value, read from the environment at call time. */
  secret: string;
}

/**
 * SEO metadata a future milestone will supply.
 *
 * Declared now, populated later. Every field is optional and Cynth currently
 * sends none of them: the SEO Engine owns these values, and inventing them
 * here would put fabricated metadata on real posts. The slot exists so the
 * connector does not have to be reopened when the SEO milestone lands — see
 * buildSeoMetadata() in cmsPublish.service.ts.
 */
export interface CmsSeoMetadata {
  seoTitle?: string | null;
  metaDescription?: string | null;
  canonicalUrl?: string | null;
  targetQuery?: string | null;
  /** Structured data (JSON-LD and similar), as the SEO engine produces it. */
  structuredData?: Record<string, unknown> | null;
  /** Links the SEO engine proposed and a human approved. Never inserted automatically. */
  internalLinks?: CmsLinkRecommendation[];
  externalLinks?: CmsLinkRecommendation[];
}

/**
 * One link a future SEO / backlink engine may propose.
 *
 * `approved` exists from the outset because the rule it encodes is not
 * negotiable later: a discovered link is a suggestion, and only a human turns
 * a suggestion into something that ships inside an article.
 */
export interface CmsLinkRecommendation {
  url: string;
  anchorText: string | null;
  rationale: string | null;
  approved: boolean;
}

/**
 * An image Cynth holds locally and wants the CMS to carry.
 *
 * A path plus its metadata rather than bytes: the file is already on disk in
 * Cynth's media library, and reading a multi-megabyte image into every payload
 * — including the ones the preview screen builds purely to show the user what
 * would be sent — would be waste. The connector reads it at the moment it
 * uploads, and only then.
 */
export interface CmsDraftImage {
  /** Absolute path to the file in Cynth's uploads directory. */
  filePath: string;
  /** Filename to present to the CMS. */
  filename: string;
  mimeType: string;
  /** Alt text as the editor wrote it. Null when none was written — never invented. */
  altText: string | null;
  title: string | null;
}

/** What Cynth hands a connector to create or update a draft. */
export interface CmsDraftPayload {
  title: string;
  /** The article body, already rendered to the markup the CMS expects. */
  content: string;
  /** Null when Cynth holds no authoritative excerpt — an excerpt is never invented. */
  excerpt: string | null;
  /** Cynth's own slug for the article. Null while the article has no title. */
  slug: string | null;
  /**
   * Always 'draft'. Present as a field so the contract is explicit about what
   * is being asked for, not so that a caller can ask for something else —
   * connectors reject any other value.
   */
  status: 'draft';
  /** The remote user posts are attributed to, when the user configured a mapping. Null means "whoever Cynth authenticates as". */
  remoteAuthorId: string | null;
  /**
   * The article's featured image, when the editor has chosen one. Null when
   * the article has none — the CMS then keeps whatever it already had, rather
   * than having its featured image cleared by an absent value.
   */
  featuredImage: CmsDraftImage | null;
  seo: CmsSeoMetadata | null;
  /**
   * Which SEO plugin the target site runs, from the connection.
   *
   * Selects a mapping in seoAdapter.ts. Null — or a value with no registered
   * mapping — means no plugin fields are sent, which is what every connection
   * did before a stack was chosen.
   */
  seoTarget: string | null;
  /**
   * The thematic area this article belongs to, as a NAME.
   *
   * A name rather than an id because Cynth does not know the site's term ids,
   * and rather than a slug because the two vocabularies were deliberately
   * aligned on names — Cynth's thematic areas were renamed to match the
   * categories EveryFiveDays publishes, and the slugs were not.
   *
   * A connector must resolve it against categories that ALREADY EXIST and
   * must never create one. A misspelling that silently creates "Sleeping
   * Gadget" beside "Sleeping Gadgets" is the failure this rule exists to
   * prevent; it has already happened once on the product side.
   *
   * Null when the article has no thematic area, in which case no category is
   * sent and the CMS keeps whatever it has.
   */
  categoryName: string | null;
}

/** A post as it exists in the CMS. Ids are text: Cynth must not assume every CMS numbers its posts. */
export interface CmsRemotePost {
  id: string;
  /** The CMS's own status vocabulary, unchanged — 'draft', 'publish', 'pending', … */
  status: string;
  title: string | null;
  /** Public permalink, where the CMS provides one. */
  url: string | null;
  /** Admin edit screen, where the connector can construct one. */
  editUrl: string | null;
  modifiedAt: string | null;
}

/**
 * Which stage a connection attempt reached.
 *
 * Deliberately distinct values: "the site is unreachable", "the site is fine
 * but the credentials are wrong", and "we authenticated but the API did not
 * behave" are three different problems with three different fixes, and
 * collapsing them into one "connection failed" wastes the user's time.
 */
export type CmsConnectionStage = 'connection' | 'api' | 'authentication' | 'authorization' | 'ok';

export interface CmsConnectionTestResult {
  ok: boolean;
  stage: CmsConnectionStage;
  message: string;
  /** What the CMS says it is called, when the test got far enough to ask. */
  siteName?: string | null;
  /** The account Cynth authenticated as. */
  authenticatedAs?: string | null;
  /** Whether that account may create drafts. Authenticating is not the same as being allowed to post. */
  canCreateDrafts?: boolean | null;
}

/**
 * One CMS integration.
 *
 * Note what is absent: there is no publish() and no setStatus(). Publication
 * is a human act performed in the CMS itself (docs/00_PROJECT_VISION.md), so
 * Cynth's connector interface offers no way to perform it — the safety rule
 * is enforced by the shape of the contract, not by remembering to avoid a
 * method.
 */
export interface CmsConnector {
  /** Matches cms_connections.connector_type. */
  readonly connectorType: string;
  /** Human-readable name for the UI. */
  readonly label: string;
  /** The authentication methods this connector understands, for the settings form. */
  readonly authMethods: readonly string[];

  /** Verifies reachability, authentication and API behaviour. Creates and changes nothing. */
  testConnection(context: CmsCallContext): Promise<CmsConnectionTestResult>;

  /** Creates a new draft. Always a draft. */
  createDraft(payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost>;

  /** Updates an existing draft in place. Never changes its published state. */
  updateDraft(externalId: string, payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost>;

  /**
   * Replaces the body of a post that is already PUBLISHED.
   *
   * Separate from `updateDraft`, and separate on purpose: the two carry
   * different risks and need different payloads.
   *
   * Implementations must send NO `status`. `updateDraft` sets `status: draft`
   * unconditionally, which on a live post would not update it but UNPUBLISH
   * it — the article would drop off the site mid-request while the caller saw
   * a success. Leaving the field out means the CMS keeps whatever the post
   * already is, so a published post stays published and a scheduled one stays
   * scheduled.
   *
   * Implementations must also send NO `slug`. The slug is the live URL: every
   * inbound link, every share and every indexed result points at it, and
   * quietly moving it is not part of "fix a paragraph".
   */
  updatePublished(externalId: string, payload: CmsDraftPayload, context: CmsCallContext): Promise<CmsRemotePost>;

  /**
   * Writes ONLY the SEO metadata fields onto an existing post.
   *
   * Separate from `updateDraft` because it is allowed where that is not: a
   * published post's CONTENT is out of Cynth's hands, but its search-result
   * metadata is not content, and refusing to fix a meta description on a
   * published article would make the whole feature useless on exactly the
   * articles that matter.
   *
   * Implementations must send the mapped SEO fields and nothing else — no
   * title, body, excerpt, slug or status — so this can never alter what a
   * reader sees on the page, or its published state.
   *
   * Returns null when the target has no SEO mapping, so the caller can say so
   * rather than report a success that wrote nothing.
   */
  updateSeoMetadata(
    externalId: string,
    seo: CmsSeoMetadata,
    seoTarget: string | null,
    context: CmsCallContext,
  ): Promise<CmsRemotePost | null>;

  /**
   * Uploads an image and sets it as an existing post's featured image.
   *
   * Separate from `updateDraft` for the same reason `updateSeoMetadata` is,
   * and it was found the same way: an article was published, its featured
   * image was chosen afterwards, and nothing could send it. `updateDraft`
   * writes `status: draft` on every call — the invariant the connector is
   * built around — so using it here would have unpublished a live article to
   * give it a picture.
   *
   * A featured image is not the article's content: it does not change a word
   * of what a reader reads. Implementations must send the media upload and the
   * `featured_media` pointer and nothing else — no title, body, excerpt, slug
   * or status.
   *
   * Returns null when the CMS accepted the upload but would not attach it, so
   * the caller can say what happened rather than report a success.
   */
  updateFeaturedImage(
    externalId: string,
    image: CmsDraftImage,
    context: CmsCallContext,
  ): Promise<CmsRemotePost | null>;

  /** Reads a post's current state. Null when the CMS no longer has it. */
  getPost(externalId: string, context: CmsCallContext): Promise<CmsRemotePost | null>;

  /** The remote users posts can be attributed to, for the author mapping. Optional — not every CMS exposes one. */
  listAuthors?(context: CmsCallContext): Promise<CmsRemoteAuthor[]>;
}

export interface CmsRemoteAuthor {
  id: string;
  name: string;
  slug: string | null;
}
