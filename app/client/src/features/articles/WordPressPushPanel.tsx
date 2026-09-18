import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError } from '../../shared/services/apiClient';
import {
  fetchArticlePushHistory,
  fetchConnections,
  fetchPushPreflight,
  pushArticle,
  refreshArticleLink,
} from '../wordpress/api';
import type { CmsConnection, CmsPushHistoryEntry, PushPreflight, PushResult } from '../../shared/types/cms';
import './WordPressPushPanel.css';

/**
 * PUSH TO WORDPRESS (Milestone 13, Parts 13–17).
 *
 *   CYNTH Draft -> Review -> Push to WordPress -> WordPress Draft -> Human Review -> Publication
 *
 * Three things this panel is careful about:
 *
 *   1. It never publishes. The button says Draft, the server sends draft, and
 *      the connector has no publish operation at all. Publication happens in
 *      WordPress, by a human.
 *   2. It is explicit about create vs update. An article already pushed shows
 *      "Update WordPress Draft" and names the post it will modify — clicking
 *      Push twice can never quietly produce two posts.
 *   3. It shows what will be sent before it is sent, so the mapping is never
 *      a surprise.
 *
 * WHICH SITE, CHOSEN PER PUSH. Every layer below this one has always taken a
 * connection id — the route, the service, the client function — but this panel
 * never passed one, so the server fell back to the default connection and the
 * only reachable site was whichever one happened to be flagged default. With a
 * local install and a production site both configured, that made production
 * unreachable from the UI. The picker below closes that gap; it appears only
 * when there is genuinely a choice to make.
 *
 * THE SITE IS NAMED BY ITS HOST, NOT ONLY BY ITS LABEL. Connection names are
 * written by hand and drift — this account has "EveryFiveDays(Local)" and
 * "EverFiveDays(Live)", one letter apart. A push to production must not depend
 * on reading a label carefully, so the host appears beside every name and in
 * the confirmation.
 */

interface WordPressPushPanelProps {
  articleId: number;
  /** Re-fetches the article after a push, so its stored link is reflected. */
  onPushed?: () => void;
}

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

/** The bare host of a site URL, for telling two similarly named sites apart. */
function hostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl).host;
  } catch {
    return baseUrl;
  }
}

/** WordPress's own status vocabulary, said in plain words. */
function describeRemoteStatus(status: string | null): string {
  if (!status) return 'Unknown';
  if (status === 'draft') return 'Draft';
  if (status === 'publish') return 'Published';
  if (status === 'pending') return 'Pending review';
  if (status === 'future') return 'Scheduled';
  if (status === 'private') return 'Private';
  if (status === 'deleted') return 'No longer on the site';
  return status;
}

export function WordPressPushPanel({ articleId, onPushed }: WordPressPushPanelProps) {
  const [preflight, setPreflight] = useState<PushPreflight | null>(null);
  const [connections, setConnections] = useState<CmsConnection[]>([]);
  // null means "whatever the server considers default" — the behaviour before
  // this picker existed, and still what a single-connection install gets.
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [history, setHistory] = useState<CmsPushHistoryEntry[]>([]);
  const [showMapping, setShowMapping] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [isPushing, setIsPushing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [result, setResult] = useState<PushResult | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const loadHistory = useCallback(() => {
    fetchArticlePushHistory(articleId)
      .then(setHistory)
      .catch(() => setHistory([]));
  }, [articleId]);

  const load = useCallback(() => {
    setIsLoading(true);
    fetchPushPreflight(articleId, selectedId)
      .then((loaded) => {
        setPreflight(loaded);
        setLoadError(null);
        // Adopt whichever connection the server resolved, so the select shows
        // the site the preflight actually describes rather than an empty
        // value. Without this the first render says "default" while the panel
        // below is already describing a specific site.
        setSelectedId((current) => current ?? loaded.connection?.id ?? null);
      })
      .catch((err) =>
        setLoadError(err instanceof ApiError ? err.errors.join(' ') : 'Could not check the WordPress connection.'),
      )
      .finally(() => setIsLoading(false));
  }, [articleId, selectedId]);

  useEffect(() => {
    load();
    loadHistory();
  }, [load, loadHistory]);

  // Only connections that could actually receive a push are offered. An
  // inactive one, or one with no stored credential, can only preflight into a
  // refusal — and this account has a credential-less duplicate whose name
  // differs from the working one by a pair of brackets, which is precisely the
  // option someone would pick by mistake and then have to debug.
  useEffect(() => {
    fetchConnections()
      .then((all) => setConnections(all.filter((c) => c.isActive && c.hasCredential)))
      .catch(() => setConnections([]));
  }, []);

  async function handlePush() {
    if (!preflight?.action || isPushing) return;

    // DUPLICATE PROTECTION, confirmed in words before anything leaves Cynth.
    // The host is named as well as the label, because the decision being
    // confirmed is really "local or production" and the labels are not
    // reliable enough to carry that on their own.
    const site = preflight.connection
      ? `${preflight.connection.name} (${hostOf(preflight.connection.baseUrl)})`
      : 'the configured site';

    const confirmation =
      preflight.action === 'create'
        ? `Create a new draft post on ${site}? It will be a draft — nothing is published.`
        : `Update the existing draft post ${preflight.link?.externalId} on ${site}? Its current content there will be replaced by this article.`;

    if (!window.confirm(confirmation)) return;

    setIsPushing(true);
    setErrors(null);
    setErrorCode(null);

    try {
      // The id the preflight actually resolved, not the select's value: those
      // are the same except on a first render, and sending the article
      // somewhere other than the site just described would be the worst
      // possible mismatch.
      const pushed = await pushArticle(articleId, preflight.action, preflight.connection?.id ?? selectedId);
      setResult(pushed);
      load();
      onPushed?.();
    } catch (err) {
      if (err instanceof ApiError) {
        setErrors(err.errors);
        setErrorCode(err.code);
      } else {
        setErrors(['The push failed. Please try again.']);
      }
      // Whatever went wrong, the preflight may now be out of date — an
      // "already pushed" refusal in particular means a link exists that this
      // panel did not know about.
      load();
    } finally {
      setIsPushing(false);
      loadHistory();
    }
  }

  async function handleRefresh() {
    if (!preflight?.connection || !preflight.link) return;
    setIsRefreshing(true);
    setErrors(null);
    try {
      await refreshArticleLink(articleId, preflight.connection.id);
      load();
    } catch (err) {
      setErrors(err instanceof ApiError ? err.errors : ['Could not re-read the WordPress post.']);
    } finally {
      setIsRefreshing(false);
      loadHistory();
    }
  }

  if (isLoading && !preflight) return <p>Checking the WordPress connection…</p>;

  if (loadError) {
    return (
      <p className="form-error" role="alert">
        {loadError}
      </p>
    );
  }

  if (!preflight) return null;

  const { connection, link, action, mapping } = preflight;
  const isUpdate = action === 'update';

  return (
    <section className="wp-push">
      <h3>WordPress</h3>

      {!connection ? (
        <div className="wp-push__unconfigured">
          <p>No WordPress connection is configured yet.</p>
          <p>
            <Link to="/settings/wordpress">Set up a WordPress connection →</Link>
          </p>
        </div>
      ) : (
        <>
          {/* Shown only when there is a choice to make. One connection needs
              no dropdown, and adding one would imply a decision that is not
              actually available. */}
          {connections.length > 1 && (
            <div className="wp-push__target">
              <label htmlFor={`wp-push-target-${articleId}`}>Send to</label>
              <select
                id={`wp-push-target-${articleId}`}
                value={selectedId ?? connection.id}
                disabled={isPushing || isLoading}
                onChange={(e) => {
                  // Clearing the result matters: leaving a success notice from
                  // the previous site visible while the panel now describes a
                  // different one is how someone concludes they pushed live
                  // when they pushed local.
                  setResult(null);
                  setErrors(null);
                  setErrorCode(null);
                  setSelectedId(Number(e.target.value));
                }}
              >
                {connections.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} — {hostOf(c.baseUrl)}
                    {c.isDefault ? ' (default)' : ''}
                  </option>
                ))}
              </select>
            </div>
          )}

          <p className="wp-push__hint">
            Sends this article to <strong>{connection.name}</strong>{' '}
            <span className="wp-push__host">({hostOf(connection.baseUrl)})</span> as a WordPress{' '}
            <strong>draft</strong>. Cynth never publishes — you review and publish in WordPress.
          </p>

          {/* THE RELATIONSHIP. When a post already exists, everything about
              it is stated: which post, what status, when it was first sent. */}
          {link ? (
            <dl className="wp-push__link">
              <div>
                <dt>WordPress post</dt>
                <dd>
                  {link.externalUrl ? (
                    <a href={link.externalUrl} target="_blank" rel="noreferrer">
                      #{link.externalId}
                    </a>
                  ) : (
                    `#${link.externalId}`
                  )}
                </dd>
              </div>
              <div>
                <dt>Status there</dt>
                <dd>
                  <span className={`wp-push__status is-${link.externalStatus ?? 'unknown'}`}>
                    {describeRemoteStatus(link.externalStatus)}
                  </span>
                </dd>
              </div>
              <div>
                <dt>Site</dt>
                <dd className="wp-push__site">{link.siteUrl ?? connection.baseUrl}</dd>
              </div>
              <div>
                <dt>First pushed</dt>
                <dd>{formatTimestamp(link.firstPushedAt)}</dd>
              </div>
              <div>
                <dt>Last pushed</dt>
                <dd>{formatTimestamp(link.lastPushedAt)}</dd>
              </div>
              <div>
                <dt>Last checked</dt>
                <dd>{formatTimestamp(link.lastSyncedAt)}</dd>
              </div>
            </dl>
          ) : (
            <p className="wp-push__not-pushed">This article has not been sent to WordPress yet.</p>
          )}

          {/* THE SEO GATE, stated on the push panel itself. The gate is
              evaluated whether or not it is enforced, so the reader always
              knows where the article stands before pressing anything. */}
          {preflight.seoGate && (
            <p className="wp-push__hint">
              <strong>
                {preflight.seoGate.ready ? 'SEO gate: passed.' : 'SEO gate: not passed.'}
              </strong>{' '}
              {preflight.seoGate.ready
                ? preflight.seoGate.warnings.length > 0
                  ? `${preflight.seoGate.warnings.length} warning(s) to review — none of them blocking.`
                  : 'Nothing is outstanding.'
                : preflight.seoGate.blockingReasons.join(' ')}
              {!preflight.seoGate.enforced && ' Enforcement is switched off, so this does not block the push.'}
            </p>
          )}

          {!preflight.ready && preflight.issues.length > 0 && (
            <div className="form-error" role="alert">
              <p>This article can’t be sent yet:</p>
              <ul>
                {preflight.issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
              {preflight.configurationErrorCode && (
                <p>
                  <Link to="/settings/wordpress">Open WordPress settings</Link>
                </p>
              )}
            </div>
          )}

          {/* WHAT WILL BE SENT. Shown on request rather than always, but never
              hidden: no field reaches WordPress that cannot be read here first. */}
          {mapping && (
            <div className="wp-push__mapping">
              <button type="button" className="button" onClick={() => setShowMapping((open) => !open)}>
                {showMapping ? 'Hide' : 'Show'} what will be sent
              </button>

              {showMapping && (
                <dl className="wp-push__mapping-fields">
                  <div>
                    <dt>Title</dt>
                    <dd>{mapping.title}</dd>
                  </div>
                  <div>
                    <dt>Slug</dt>
                    <dd>{mapping.slug ?? <em>None — WordPress will derive one from the title</em>}</dd>
                  </div>
                  <div>
                    <dt>Status</dt>
                    <dd>Draft</dd>
                  </div>
                  <div>
                    <dt>Author</dt>
                    <dd>{mapping.remoteAuthorName ?? 'The authenticating WordPress account'}</dd>
                  </div>
                  <div>
                    <dt>Excerpt</dt>
                    <dd>
                      <em>Not sent — Cynth has no excerpt for this article, and will not invent one.</em>
                    </dd>
                  </div>
                  <div>
                    <dt>Content</dt>
                    <dd>{mapping.contentLength.toLocaleString()} characters of HTML</dd>
                  </div>
                  <div className="wp-push__mapping-preview">
                    <dt>Content preview</dt>
                    <dd>
                      <pre>{mapping.content.slice(0, 600)}{mapping.content.length > 600 ? '\n…' : ''}</pre>
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          )}

          <div className="wp-push__actions">
            {/* The button states the action. There is no single ambiguous
                "Push" that might mean either thing. */}
            <button
              type="button"
              className="button button--primary"
              onClick={() => void handlePush()}
              disabled={!preflight.ready || isPushing}
            >
              {isPushing
                ? isUpdate
                  ? 'Updating…'
                  : 'Sending…'
                : isUpdate
                  ? 'Update WordPress Draft'
                  : 'Push to WordPress as Draft'}
            </button>

            {link && (
              <button type="button" className="button" onClick={() => void handleRefresh()} disabled={isRefreshing}>
                {isRefreshing ? 'Checking…' : 'Check WordPress'}
              </button>
            )}

            {link?.externalEditUrl && (
              <a className="button" href={link.externalEditUrl} target="_blank" rel="noreferrer">
                Open in WordPress
              </a>
            )}
          </div>

          {isUpdate && preflight.ready && (
            <p className="wp-push__warning" role="note">
              This will replace the content of post #{link?.externalId} on {connection.name}. It will not create
              another post, and it will not publish anything.
            </p>
          )}

          {result && (
            <p className="wp-push__result" role="status">
              {result.message}
              {result.post.editUrl && (
                <>
                  {' '}
                  <a href={result.post.editUrl} target="_blank" rel="noreferrer">
                    Open it in WordPress →
                  </a>
                </>
              )}
            </p>
          )}

          {errors && (
            <div className="form-error" role="alert">
              <p>WordPress push failed:</p>
              <ul>
                {errors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
              {(errorCode === 'connection_not_configured' ||
                errorCode === 'missing_credentials' ||
                errorCode === 'connection_inactive') && (
                <p>
                  <Link to="/settings/wordpress">Open WordPress settings</Link>
                </p>
              )}
            </div>
          )}

          {history.length > 0 && (
            <div className="wp-push__history">
              <button type="button" className="button" onClick={() => setShowHistory((open) => !open)}>
                {showHistory ? 'Hide' : 'Show'} WordPress History ({history.length})
              </button>

              {showHistory && (
                <ul className="wp-push__history-list">
                  {history.map((entry) => (
                    <li key={entry.id} className={`wp-push__history-item is-${entry.status}`}>
                      <span className="wp-push__history-when">{formatTimestamp(entry.createdAt)}</span>
                      <span className="wp-push__history-what">
                        {entry.operation === 'create'
                          ? 'First push'
                          : entry.operation === 'update'
                            ? 'Update'
                            : entry.operation === 'refresh'
                              ? 'Status check'
                              : 'Connection test'}
                        {' · '}
                        {entry.status === 'success' ? 'Success' : 'Failed'}
                        {entry.connectionName ? ` · ${entry.connectionName}` : ''}
                        {entry.externalId ? ` · post #${entry.externalId}` : ''}
                      </span>
                      {entry.errorMessage && <span className="wp-push__history-error">{entry.errorMessage}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}
