import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError } from '../../shared/services/apiClient';
import {
  chooseSearchConsoleSite,
  deleteSearchQuery,
  disconnectSearchConsole,
  fetchSearchConsoleSites,
  fetchSearchConsoleStatus,
  fetchSearchDemand,
  fileSearchQuery,
  importSearchQueries,
  saveSearchConsoleKey,
  syncSearchConsole,
} from './api';
import type { SearchConsoleStatus, SearchDemand, SearchQueryRow } from './api';
import '../coverage/CoveragePage.css';
import './SearchDemandPage.css';

/**
 * SEARCH QUERIES — what people typed into Google to find the site.
 *
 * Two jobs:
 *   1. Bring in a Search Console export. Cynth files each search under the
 *      thematic area it belongs to.
 *   2. Show, per area, which searches no article answers yet. Those are what
 *      topic research is asked to write for.
 */

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.errors.join(' ') : fallback);

const PERIODS = ['Last 7 days', 'Last 28 days', 'Last 3 months', 'Last 6 months'];

function QueryTable({
  rows,
  themes,
  busy,
  onFile,
  onRemove,
}: {
  rows: SearchQueryRow[];
  themes: { id: number; name: string }[];
  busy: number | null;
  onFile: (row: SearchQueryRow, themeId: number | null) => void;
  onRemove: (row: SearchQueryRow) => void;
}) {
  return (
    <div className="demand-scroll">
      <table className="demand-table">
        <thead>
          <tr>
            <th scope="col">Search</th>
            <th scope="col" className="demand-num">Impressions</th>
            <th scope="col" className="demand-num">Clicks</th>
            <th scope="col" className="demand-num">Position</th>
            <th scope="col">Answered by</th>
            <th scope="col">Area</th>
            <th scope="col" aria-label="Remove" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.query}</td>
              <td className="demand-num">{row.impressions}</td>
              <td className="demand-num">{row.clicks}</td>
              <td className="demand-num">{row.position === null ? '—' : Math.round(row.position)}</td>
              <td>
                {row.articleId ? (
                  <Link to={`/articles/${row.articleId}`}>{row.articleTitle ?? 'An existing article'}</Link>
                ) : (
                  <span className="demand-open">No article matched</span>
                )}
              </td>
              <td>
                <select
                  aria-label={`Area for ${row.query}`}
                  value={row.themeId ?? ''}
                  disabled={busy === row.id}
                  onChange={(event) => onFile(row, event.target.value ? Number(event.target.value) : null)}
                >
                  <option value="">Not filed</option>
                  {themes.map((theme) => (
                    <option key={theme.id} value={theme.id}>{theme.name}</option>
                  ))}
                </select>
              </td>
              <td>
                <button type="button" className="demand-remove" disabled={busy === row.id} onClick={() => onRemove(row)}>
                  Remove
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The direct connection to Google. Three states: no key yet (setup steps), a
 * key but more than one property to choose from, and connected.
 */
function SearchConsolePanel({ onSynced }: { onSynced: () => Promise<void> }) {
  const [status, setStatus] = useState<SearchConsoleStatus | null>(null);
  const [sites, setSites] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [working, setWorking] = useState<'key' | 'sync' | 'site' | 'disconnect' | null>(null);
  const keyInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchSearchConsoleStatus()
      .then(async ({ status: loaded }) => {
        setStatus(loaded);
        if (loaded.connected && !loaded.siteUrl) {
          setSites((await fetchSearchConsoleSites().catch(() => ({ sites: [] }))).sites);
        }
      })
      .catch((err) => setError(errorText(err, 'Could not load the Search Console connection.')));
  }, []);

  async function run(kind: 'key' | 'sync' | 'site' | 'disconnect', action: () => Promise<void>, fallback: string) {
    setWorking(kind);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
      void fetchSearchConsoleStatus().then((result) => setStatus(result.status)).catch(() => undefined);
    } finally {
      setWorking(null);
    }
  }

  const addKey = () =>
    run(
      'key',
      async () => {
        const file = keyInput.current?.files?.[0];
        if (!file) throw new ApiError(400, ['Choose the key file Google downloaded first.']);
        const result = await saveSearchConsoleKey(await file.text());
        if (keyInput.current) keyInput.current.value = '';
        setStatus(result.status);
        setSites(result.sites);
        if (result.warning) setError(result.warning);
        else if (!result.sites.length) {
          setNotice('Key saved. Now add the address below as a user in Search Console, then choose Sync now.');
        } else setNotice('Key saved.');
      },
      'The key file could not be saved.',
    );

  const sync = () =>
    run(
      'sync',
      async () => {
        const result = await syncSearchConsole();
        setStatus(result.status);
        setNotice(
          `Read ${result.summary.rows} searches for ${result.startDate} to ${result.endDate}: ` +
            `${result.summary.added} new, ${result.summary.updated} updated, ${result.summary.unfiled} left for you to file.`,
        );
        await onSynced();
      },
      'The sync failed.',
    );

  const chooseSite = (siteUrl: string) =>
    run('site', async () => setStatus((await chooseSearchConsoleSite(siteUrl)).status), 'Could not save the property.');

  const disconnect = () =>
    run(
      'disconnect',
      async () => {
        setStatus((await disconnectSearchConsole()).status);
        setSites([]);
        setNotice('Disconnected. The key was deleted from this computer. Searches already read are kept.');
      },
      'Could not disconnect.',
    );

  return (
    <section className="coverage-area" aria-labelledby="demand-console-heading">
      <header className="coverage-area__header">
        <h2 id="demand-console-heading">Google Search Console connection</h2>
        <span className="coverage-area__count">
          {status === null ? '' : status.connected ? (status.siteUrl ? `Connected · ${status.siteUrl}` : 'Key added') : 'Not connected'}
        </span>
      </header>

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="coverage-notice" role="status">{notice}</p>}

      {status?.connected ? (
        <>
          <p className="coverage-note">
            Cynth signs in to Google as <strong>{status.clientEmail}</strong>, read-only, and reads the last 28 days once a day.
            That address must be a user of the property in Search Console (Settings, then Users and permissions).
          </p>
          {!status.siteUrl && sites.length > 1 && (
            <div className="demand-import">
              <label>
                Property to read
                <select defaultValue="" disabled={working !== null} onChange={(event) => event.target.value && void chooseSite(event.target.value)}>
                  <option value="" disabled>Choose a property</option>
                  {sites.map((site) => (
                    <option key={site}>{site}</option>
                  ))}
                </select>
              </label>
            </div>
          )}
          {status.lastSyncAt && (
            <p className={status.lastSyncOk === false ? 'form-error' : 'coverage-note'}>
              Last sync {status.lastSyncAt.slice(0, 16).replace('T', ' ')} UTC: {status.lastSyncMessage}
            </p>
          )}
          <div className="demand-import">
            <button type="button" className="button button--primary" disabled={working !== null} onClick={() => void sync()}>
              {working === 'sync' ? 'Reading from Google…' : 'Sync now'}
            </button>
            <button type="button" className="button" disabled={working !== null} onClick={() => void disconnect()}>
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="coverage-note">
            Connect once and Cynth reads your searches from Google every day, with no file to export. It needs a Google
            service account: a read-only robot login that you create and can delete at any time.
          </p>
          <ol className="demand-steps">
            <li>Open console.cloud.google.com and create a project (any name).</li>
            <li>In APIs and Services, open Library, find Google Search Console API and choose Enable.</li>
            <li>In IAM and Admin, open Service Accounts and create one (any name, no roles needed).</li>
            <li>Open that service account, choose Keys, Add key, Create new key, JSON. A .json file downloads.</li>
            <li>Choose that file below. Cynth will show the robot login's email address.</li>
            <li>In Search Console, open Settings, then Users and permissions, and add that address with Restricted permission.</li>
          </ol>
          <div className="demand-import">
            <label>
              Google key file (.json)
              <input ref={keyInput} type="file" accept=".json,application/json" />
            </label>
            <button type="button" className="button button--primary" disabled={working !== null} onClick={() => void addKey()}>
              {working === 'key' ? 'Saving…' : 'Connect'}
            </button>
          </div>
          <p className="coverage-note">The key stays on this computer, in the Cynth secrets file. It is never shown again or sent anywhere but Google.</p>
        </>
      )}
    </section>
  );
}

export function SearchDemandPage() {
  const [data, setData] = useState<SearchDemand | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [period, setPeriod] = useState(PERIODS[1]);
  const [importing, setImporting] = useState(false);
  const [busy, setBusy] = useState<number | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await fetchSearchDemand());
    } catch (err) {
      setError(errorText(err, 'Could not load the search queries.'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runImport() {
    const file = fileInput.current?.files?.[0];
    if (!file) {
      setError('Choose the Queries.csv file first.');
      return;
    }
    setImporting(true);
    setError(null);
    setNotice(null);
    try {
      const { summary } = await importSearchQueries(await file.text(), period);
      setNotice(
        `Read ${summary.rows} searches: ${summary.added} new, ${summary.updated} updated. ` +
          `${summary.filed} filed under an area, ${summary.unfiled} left for you to file.`,
      );
      if (fileInput.current) fileInput.current.value = '';
      await load();
    } catch (err) {
      setError(errorText(err, 'The file could not be imported.'));
    } finally {
      setImporting(false);
    }
  }

  async function file(row: SearchQueryRow, themeId: number | null) {
    setBusy(row.id);
    setError(null);
    try {
      await fileSearchQuery(row.id, themeId);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not file that search.'));
    } finally {
      setBusy(null);
    }
  }

  async function remove(row: SearchQueryRow) {
    setBusy(row.id);
    setError(null);
    try {
      await deleteSearchQuery(row.id);
      await load();
    } catch (err) {
      setError(errorText(err, 'Could not remove that search.'));
    } finally {
      setBusy(null);
    }
  }

  const themes = data?.themes.map((theme) => ({ id: theme.id, name: theme.name })) ?? [];

  return (
    <div className="page coverage-page">
      <PageHeader
        title="Search queries"
        description="What people typed into Google to find the site. Topic research reads these, so each new article answers a real search."
      />

      {error && <p className="form-error" role="alert">{error}</p>}
      {notice && <p className="coverage-notice" role="status">{notice}</p>}

      <SearchConsolePanel onSynced={load} />

      <section className="coverage-area" aria-labelledby="demand-import-heading">
        <header className="coverage-area__header">
          <h2 id="demand-import-heading">Or bring in a Search Console export by hand</h2>
          <span className="coverage-area__count">
            {data?.lastImportedAt ? `Last import ${data.lastImportedAt.slice(0, 10)} · ${data.total} searches` : 'Nothing imported yet'}
          </span>
        </header>
        <ol className="demand-steps">
          <li>In Google Search Console, open Performance, then Search results.</li>
          <li>Set the date range, then choose Export and Download CSV.</li>
          <li>Unzip the download and choose the file named Queries.csv here.</li>
        </ol>
        <div className="demand-import">
          <label>
            Queries.csv
            <input ref={fileInput} type="file" accept=".csv,text/csv" />
          </label>
          <label>
            Date range you exported
            <select value={period} onChange={(event) => setPeriod(event.target.value)}>
              {PERIODS.map((option) => (
                <option key={option}>{option}</option>
              ))}
            </select>
          </label>
          <button type="button" className="button button--primary" onClick={() => void runImport()} disabled={importing}>
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
        <p className="coverage-note">Importing the same date range again replaces its figures. It never adds them up.</p>
      </section>

      {data === null ? (
        <p>Loading…</p>
      ) : (
        <>
          {data.unfiled.length > 0 && (
            <section className="coverage-area" aria-labelledby="demand-unfiled-heading">
              <header className="coverage-area__header">
                <h2 id="demand-unfiled-heading">Not filed under an area</h2>
                <span className="coverage-area__count">{data.unfiled.length}</span>
              </header>
              <p className="coverage-note">
                Cynth could not tell which area these belong to. Topic research only sees a search once it is filed.
              </p>
              <QueryTable
                rows={data.unfiled}
                themes={themes}
                busy={busy}
                onFile={(row, id) => void file(row, id)}
                onRemove={(row) => void remove(row)}
              />
            </section>
          )}

          {data.themes.map((theme) => {
            const open = theme.queries.filter((row) => row.articleId === null).length;
            return (
              <section key={theme.id} className="coverage-area" aria-labelledby={`demand-theme-${theme.id}`}>
                <header className="coverage-area__header">
                  <h2 id={`demand-theme-${theme.id}`}>{theme.name}</h2>
                  <span className="coverage-area__count">
                    {theme.queries.length} search{theme.queries.length === 1 ? '' : 'es'} · {open} matched to no article
                  </span>
                </header>
                {theme.queries.length ? (
                  <QueryTable
                    rows={theme.queries}
                    themes={themes}
                    busy={busy}
                    onFile={(row, id) => void file(row, id)}
                    onRemove={(row) => void remove(row)}
                  />
                ) : (
                  <p className="coverage-note">
                    No searches recorded for this area yet. Topic research will name the question each article answers and mark its
                    demand as inferred.
                  </p>
                )}
              </section>
            );
          })}
        </>
      )}
    </div>
  );
}
