import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import {
  createConnection,
  deleteConnection,
  fetchConnections,
  fetchConnectorMeta,
  fetchRecentPushHistory,
  fetchRemoteAuthors,
  setAuthorMapping,
  setConnectionStatus,
  setDefaultConnection,
  testConnection,
  updateConnection,
} from './api';
import type {
  CmsConnection,
  CmsConnectionTestResult,
  CmsConnectorMeta,
  CmsPushHistoryEntry,
  CmsRemoteAuthor,
} from '../../shared/types/cms';
import './WordPressSettings.css';

/**
 * WORDPRESS CONNECTION SETTINGS (Milestone 13, Parts 10–12).
 *
 * Configures where Cynth publishes and how it authenticates. Three rules
 * govern this screen:
 *
 *   1. The site URL is always configurable and never assumed. The same
 *      connection must work against the local EveryFiveDays install today and
 *      a live site later, so nothing here defaults to localhost or a port.
 *   2. A credential entered here is written once and never read back. The
 *      server stores it outside the database and returns only whether one is
 *      set — the field below therefore shows a placeholder, never a value.
 *   3. Test Connection publishes nothing. It performs two reads and reports
 *      which stage failed, because "site unreachable", "REST API disabled",
 *      "wrong password" and "account cannot post" have four different fixes.
 */

interface ConnectionDraft {
  name: string;
  connectorType: string;
  baseUrl: string;
  username: string;
  credential: string;
  description: string;
}

const EMPTY_DRAFT: ConnectionDraft = {
  name: '',
  connectorType: 'wordpress',
  baseUrl: '',
  username: '',
  credential: '',
  description: '',
};

/** How a test result's stage should read to a human, and what to do about it. */
const STAGE_GUIDANCE: Record<string, string> = {
  connection: 'Cynth could not reach the site at all. Check the Site URL, and that the site is running.',
  api: 'The site answered but its REST API did not. A security plugin or server rule may be blocking /wp-json.',
  authentication: 'The site is reachable, but the username or application password was rejected.',
  authorization: 'The credentials work, but that WordPress account is not allowed to create posts.',
  configuration: 'Something is missing in this connection’s settings.',
  ok: 'Cynth can reach the site, authenticate, and create drafts.',
};

function formatTimestamp(value: string | null): string {
  if (!value) return 'Never';
  const parsed = new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}Z`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

export function WordPressSettings() {
  const [connections, setConnections] = useState<CmsConnection[]>([]);
  const [connectors, setConnectors] = useState<CmsConnectorMeta[]>([]);
  const [history, setHistory] = useState<CmsPushHistoryEntry[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const [isAdding, setIsAdding] = useState(false);
  const [draft, setDraft] = useState<ConnectionDraft>(EMPTY_DRAFT);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formErrors, setFormErrors] = useState<string[]>([]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const [testResults, setTestResults] = useState<Record<number, CmsConnectionTestResult>>({});
  const [remoteAuthors, setRemoteAuthors] = useState<Record<number, CmsRemoteAuthor[]>>({});

  const load = useCallback(() => {
    setIsLoading(true);
    Promise.all([fetchConnections(), fetchRecentPushHistory(10)])
      .then(([loadedConnections, loadedHistory]) => {
        setConnections(loadedConnections);
        setHistory(loadedHistory);
        setError(null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not load WordPress settings.'),
      )
      .finally(() => setIsLoading(false));
  }, []);

  useEffect(() => {
    load();
    fetchConnectorMeta()
      .then(setConnectors)
      .catch(() => setConnectors([{ connectorType: 'wordpress', label: 'WordPress', authMethods: ['application_password'] }]));
  }, [load]);

  function startEdit(connection: CmsConnection) {
    setEditingId(connection.id);
    setIsAdding(false);
    setFormErrors([]);
    setDraft({
      name: connection.name,
      connectorType: connection.connectorType,
      baseUrl: connection.baseUrl,
      username: connection.username ?? '',
      // Deliberately blank: the stored credential is never sent to the
      // browser, so there is nothing to prefill. Leaving it blank on save
      // means "leave the stored one alone".
      credential: '',
      description: connection.description ?? '',
    });
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setFormErrors([]);

    const input = {
      name: draft.name,
      connectorType: draft.connectorType,
      baseUrl: draft.baseUrl,
      username: draft.username || undefined,
      description: draft.description || undefined,
      // An empty field means "leave the stored credential alone" — on edit
      // because there is nothing to prefill it with, and on create because no
      // credential was supplied yet. Omitting it is how the server is told to
      // make no change.
      credential: draft.credential || undefined,
    };

    try {
      if (editingId === null) {
        const created = await createConnection(input);
        setFlash(`${created.name} was added. Use Test Connection to check it before pushing anything.`);
      } else {
        const updated = await updateConnection(editingId, input);
        setFlash(`${updated.name} was updated.`);
      }
      setDraft(EMPTY_DRAFT);
      setIsAdding(false);
      setEditingId(null);
      load();
    } catch (err) {
      setFormErrors(err instanceof ApiError ? err.errors : ['Could not save this connection.']);
    }
  }

  async function handleTest(connection: CmsConnection) {
    setBusyId(connection.id);
    try {
      const result = await testConnection(connection.id);
      setTestResults((prev) => ({ ...prev, [connection.id]: result }));
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not test that connection.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleLoadAuthors(connection: CmsConnection) {
    setBusyId(connection.id);
    try {
      const authors = await fetchRemoteAuthors(connection.id);
      setRemoteAuthors((prev) => ({ ...prev, [connection.id]: authors }));
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not read the site’s user list.');
    } finally {
      setBusyId(null);
    }
  }

  async function handleAuthorChange(connection: CmsConnection, authorId: string) {
    const author = remoteAuthors[connection.id]?.find((candidate) => candidate.id === authorId) ?? null;
    try {
      await setAuthorMapping(connection.id, author ? author.id : null, author ? author.name : null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.errors.join(' ') : 'Could not save the author mapping.');
    }
  }

  async function handleDelete(connection: CmsConnection) {
    if (
      !window.confirm(
        `Remove the connection to ${connection.name}? Cynth will forget its stored credential and which posts it created there. Nothing on the WordPress site is deleted.`,
      )
    ) {
      return;
    }
    await deleteConnection(connection.id);
    setFlash(`${connection.name} was removed. Nothing on the site was changed.`);
    load();
  }

  if (isLoading && connections.length === 0) {
    return (
      <div className="page">
        <p>Loading WordPress settings…</p>
      </div>
    );
  }

  return (
    <div className="page wordpress-settings">
      <PageHeader
        title="WordPress"
        description="Connect a WordPress site so approved drafts can be sent to it. Cynth never publishes — it creates drafts for you to review and publish there."
      />

      <p className="wordpress-settings__back">
        <Link to="/settings">← Back to Settings</Link>
      </p>

      {flash && (
        <div className="flash-banner" role="status">
          {flash}
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      <div className="wordpress-settings__toolbar">
        <h2>Connections</h2>
        <button
          type="button"
          className="button button--primary"
          onClick={() => {
            setIsAdding((open) => !open);
            setEditingId(null);
            setDraft(EMPTY_DRAFT);
            setFormErrors([]);
          }}
        >
          {isAdding ? 'Cancel' : 'Add Connection'}
        </button>
      </div>

      {(isAdding || editingId !== null) && (
        <form className="wordpress-form" onSubmit={handleSubmit}>
          {formErrors.length > 0 && (
            <div className="form-error" role="alert">
              <ul>
                {formErrors.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          )}

          <label>
            Connection Name
            <input
              value={draft.name}
              onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
              placeholder="e.g. EveryFiveDays (local)"
            />
          </label>

          <label>
            CMS
            <select
              value={draft.connectorType}
              onChange={(event) => setDraft((d) => ({ ...d, connectorType: event.target.value }))}
            >
              {connectors.map((connector) => (
                <option key={connector.connectorType} value={connector.connectorType}>
                  {connector.label}
                </option>
              ))}
            </select>
          </label>

          <label>
            Site URL
            <input
              value={draft.baseUrl}
              onChange={(event) => setDraft((d) => ({ ...d, baseUrl: event.target.value }))}
              placeholder="http://everyfivedays.local"
            />
            <small>
              The site root only — Cynth adds <code>/wp-json</code> itself. The same connection works for a local site
              now and a live one later.
            </small>
          </label>

          <label>
            WordPress Username
            <input
              value={draft.username}
              onChange={(event) => setDraft((d) => ({ ...d, username: event.target.value }))}
              autoComplete="off"
            />
          </label>

          <label>
            Application Password
            <input
              type="password"
              value={draft.credential}
              onChange={(event) => setDraft((d) => ({ ...d, credential: event.target.value }))}
              placeholder={editingId === null ? 'xxxx xxxx xxxx xxxx xxxx xxxx' : 'Leave blank to keep the stored one'}
              autoComplete="new-password"
            />
            <small>
              Create one in WordPress under <strong>Users → Profile → Application Passwords</strong>. It is stored
              outside Cynth’s database and is never sent back to this page. Do not use your account password.
            </small>
          </label>

          <label>
            Description
            <input
              value={draft.description}
              onChange={(event) => setDraft((d) => ({ ...d, description: event.target.value }))}
            />
          </label>

          <div className="wordpress-form__actions">
            <button type="submit" className="button button--primary">
              {editingId === null ? 'Add Connection' : 'Save Changes'}
            </button>
            <button
              type="button"
              className="button"
              onClick={() => {
                setIsAdding(false);
                setEditingId(null);
                setDraft(EMPTY_DRAFT);
                setFormErrors([]);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {connections.length === 0 && !isAdding ? (
        <p className="wordpress-settings__empty">
          No WordPress connection yet. Add one to send approved drafts to your site.
        </p>
      ) : (
        <ul className="wordpress-settings__list">
          {connections.map((connection) => {
            const result = testResults[connection.id];
            const authors = remoteAuthors[connection.id];
            const stage = result?.stage ?? connection.lastStage ?? null;

            return (
              <li key={connection.id} className="wordpress-connection">
                <div className="wordpress-connection__header">
                  <div>
                    <h3>{connection.name}</h3>
                    <p className="wordpress-connection__url">{connection.baseUrl}</p>
                  </div>
                  <div className="wordpress-connection__badges">
                    <span className={`status-badge ${connection.isActive ? 'is-active' : 'is-inactive'}`}>
                      {connection.isActive ? 'Active' : 'Inactive'}
                    </span>
                    {connection.isDefault && <span className="status-badge is-active">Default</span>}
                    <span className={`status-badge ${connection.hasCredential ? 'is-active' : 'is-inactive'}`}>
                      {connection.hasCredential ? 'Credentials set' : 'No credentials'}
                    </span>
                  </div>
                </div>

                <dl className="wordpress-connection__facts">
                  <div>
                    <dt>CMS</dt>
                    <dd>{connectors.find((c) => c.connectorType === connection.connectorType)?.label ?? connection.connectorType}</dd>
                  </div>
                  <div>
                    <dt>Username</dt>
                    <dd>{connection.username ?? 'Not set'}</dd>
                  </div>
                  <div>
                    <dt>Authentication</dt>
                    <dd>Application password</dd>
                  </div>
                  <div>
                    <dt>Posts attributed to</dt>
                    <dd>{connection.defaultRemoteAuthorName ?? 'The authenticating account'}</dd>
                  </div>
                  <div>
                    <dt>Last checked</dt>
                    <dd>{formatTimestamp(connection.lastCheckedAt)}</dd>
                  </div>
                  <div>
                    <dt>Last result</dt>
                    <dd>
                      {connection.lastStatus === 'ok'
                        ? 'Connected'
                        : connection.lastStatus === 'failed'
                          ? 'Failed'
                          : 'Not tested yet'}
                    </dd>
                  </div>
                </dl>

                {/* The test result names WHICH stage failed, so the fix is
                    obvious rather than a guess. */}
                {(result || connection.lastMessage) && (
                  <div
                    className={`wordpress-connection__test is-${result ? (result.ok ? 'ok' : 'failed') : connection.lastStatus ?? 'unknown'}`}
                    role="status"
                  >
                    <p className="wordpress-connection__test-message">{result?.message ?? connection.lastMessage}</p>
                    {stage && STAGE_GUIDANCE[stage] && (
                      <p className="wordpress-connection__test-guidance">{STAGE_GUIDANCE[stage]}</p>
                    )}
                  </div>
                )}

                <div className="wordpress-connection__actions">
                  <button
                    type="button"
                    className="button button--primary"
                    onClick={() => void handleTest(connection)}
                    disabled={busyId === connection.id}
                  >
                    {busyId === connection.id ? 'Testing…' : 'Test Connection'}
                  </button>
                  <button
                    type="button"
                    className="button"
                    onClick={() => void setConnectionStatus(connection.id, !connection.isActive).then(load)}
                  >
                    {connection.isActive ? 'Deactivate' : 'Activate'}
                  </button>
                  {!connection.isDefault && (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void setDefaultConnection(connection.id).then(load)}
                    >
                      Set as Default
                    </button>
                  )}
                  <button type="button" className="button" onClick={() => startEdit(connection)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button button--danger"
                    onClick={() => void handleDelete(connection)}
                  >
                    Remove
                  </button>
                </div>

                {/* Author mapping. Chosen from the site's real users rather
                    than typed as a number, so it cannot be wrong by guess. */}
                <div className="wordpress-connection__authors">
                  {authors ? (
                    <label>
                      Attribute posts to
                      <select
                        value={connection.defaultRemoteAuthorId ?? ''}
                        onChange={(event) => void handleAuthorChange(connection, event.target.value)}
                      >
                        <option value="">The authenticating account</option>
                        {authors.map((author) => (
                          <option key={author.id} value={author.id}>
                            {author.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <button
                      type="button"
                      className="button"
                      onClick={() => void handleLoadAuthors(connection)}
                      disabled={busyId === connection.id || !connection.hasCredential}
                    >
                      Load WordPress Authors
                    </button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {history.length > 0 && (
        <section className="wordpress-settings__history">
          <h2>Recent Synchronisation</h2>
          <p className="wordpress-settings__hint">
            Every push, update, refresh and connection test. No credentials are recorded.
          </p>
          <ul>
            {history.map((entry) => (
              <li key={entry.id} className={`wordpress-history is-${entry.status}`}>
                <span className="wordpress-history__when">{formatTimestamp(entry.createdAt)}</span>
                <span className="wordpress-history__what">
                  {entry.operation} · {entry.status === 'success' ? 'Success' : 'Failed'}
                  {entry.connectionName ? ` · ${entry.connectionName}` : ''}
                  {entry.externalId ? ` · post ${entry.externalId}` : ''}
                  {entry.externalStatus ? ` (${entry.externalStatus})` : ''}
                </span>
                {entry.errorMessage && <span className="wordpress-history__error">{entry.errorMessage}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
