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
  /** Reserved for the SEO milestone. Always null today. */
  seo: CmsSeoMetadata | null;
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
