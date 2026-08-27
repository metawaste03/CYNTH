/**
 * Mirrors the server's CMS feature (Milestone 13).
 *
 * Nothing here ever carries a credential — the server never sends one.
 * `hasCredential` is the only fact about a stored secret that reaches the
 * browser.
 */

export interface CmsConnection {
  id: number;
  name: string;
  connectorType: string;
  description: string | null;
  baseUrl: string;
  authMethod: string;
  username: string | null;
  /** The env var NAME holding the credential. Not a secret. */
  credentialEnvVar: string | null;
  hasCredential: boolean;
  defaultRemoteAuthorId: string | null;
  defaultRemoteAuthorName: string | null;
  isActive: boolean;
  isDefault: boolean;
  lastStatus: string | null;
  lastStage: string | null;
  lastMessage: string | null;
  lastCheckedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CmsConnectionInput {
  name: string;
  connectorType: string;
  description?: string;
  baseUrl: string;
  authMethod?: string;
  username?: string;
  /** Omit to leave the stored credential untouched; '' clears it; any other value sets or rotates it. */
  credential?: string;
}

export interface CmsConnectorMeta {
  connectorType: string;
  label: string;
  authMethods: string[];
}

/**
 * Which stage a connection attempt reached.
 *
 * Kept distinct on purpose: "cannot reach the site", "the REST API will not
 * answer", "the credentials are wrong" and "the account cannot post" have
 * four different fixes.
 */
export type CmsConnectionStage =
  | 'connection'
  | 'api'
  | 'authentication'
  | 'authorization'
  | 'configuration'
  | 'ok'
  | string;

export interface CmsConnectionTestResult {
  ok: boolean;
  stage: CmsConnectionStage;
  message: string;
  siteName: string | null;
  authenticatedAs: string | null;
  canCreateDrafts: boolean | null;
  connection: CmsConnection | null;
}

export interface CmsRemoteAuthor {
  id: string;
  name: string;
  slug: string | null;
}

/** Where a Cynth Article currently lives in a CMS. */
export interface ArticleCmsLink {
  id: number;
  articleId: number;
  connectionId: number;
  externalId: string;
  externalStatus: string | null;
  externalUrl: string | null;
  externalEditUrl: string | null;
  siteUrl: string | null;
  firstPushedAt: string | null;
  lastPushedAt: string | null;
  lastSyncedAt: string | null;
}

export type PushMode = 'create' | 'update';

/** Exactly what will be sent to the CMS, shown before anything is sent. */
export interface ArticleMappingPreview {
  title: string;
  content: string;
  excerpt: string | null;
  slug: string | null;
  status: 'draft';
  remoteAuthorId: string | null;
  remoteAuthorName: string | null;
  contentLength: number;
}

export interface PushPreflight {
  articleId: number;
  connection: {
    id: number;
    name: string;
    baseUrl: string;
    connectorType: string;
    hasCredential: boolean;
  } | null;
  link: ArticleCmsLink | null;
  /** What pressing the button will do. Stated explicitly so the action is never ambiguous. */
  action: PushMode | null;
  mapping: ArticleMappingPreview | null;
  ready: boolean;
  issues: string[];
  configurationErrorCode: string | null;
  links: ArticleCmsLink[];
}

export interface CmsRemotePost {
  id: string;
  status: string;
  title: string | null;
  url: string | null;
  editUrl: string | null;
  modifiedAt: string | null;
}

export interface PushResult {
  operation: PushMode;
  post: CmsRemotePost;
  link: ArticleCmsLink;
  connectionName: string;
  message: string;
}

export interface CmsPushHistoryEntry {
  id: number;
  articleId: number | null;
  connectionId: number | null;
  connectionName: string | null;
  siteUrl: string | null;
  operation: string;
  status: string;
  externalId: string | null;
  externalStatus: string | null;
  errorCode: string | null;
  errorMessage: string | null;
  durationMs: number | null;
  createdAt: string;
}
