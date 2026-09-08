import { useEffect, useState } from 'react';
import { ApiError } from '../../shared/services/apiClient';
import type { WebCapabilities, WebSource } from '../../shared/types/seo';
import { createWebSource, deleteWebSource, fetchWebCapabilities, fetchWebSources, updateWebSource } from './api';

/**
 * WEB SOURCES — the permission list for a future capability.
 *
 * This panel manages which websites Cynth would be allowed to investigate.
 * It is honest about the fact that, in this version, nothing reads them:
 * Cynth has no crawler, and the capabilities endpoint says so in as many
 * words rather than leaving the user to assume otherwise.
 *
 * Both permissions default to OFF on a new source. Adding a domain to a list
 * is not consent to read it.
 */

const PURPOSE_LABELS: Record<string, string> = {
  research: 'Research',
  authority: 'Authority / citation',
  competitor: 'Competitor',
  backlink_target: 'Backlink target',
  own_site: 'Own site',
  other: 'Other',
};

export function WebSourcesPanel() {
  const [capabilities, setCapabilities] = useState<WebCapabilities | null>(null);
  const [sources, setSources] = useState<WebSource[]>([]);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  const [name, setName] = useState('');
  const [domain, setDomain] = useState('');
  const [purpose, setPurpose] = useState('research');

  function load() {
    void fetchWebSources().then(setSources).catch(() => setSources([]));
  }

  useEffect(() => {
    void fetchWebCapabilities().then(setCapabilities).catch(() => setCapabilities(null));
    load();
  }, []);

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setIsBusy(true);
    setErrors(null);
    try {
      // Permissions are deliberately not offered on the create form: a source
      // is added first, then permission is granted as a separate, deliberate
      // act on the row itself.
      await createWebSource({ name, domain, purpose, isActive: true });
      setName('');
      setDomain('');
      load();
    } catch (error) {
      setErrors(error instanceof ApiError ? error.errors : ['Could not add the source.']);
    } finally {
      setIsBusy(false);
    }
  }

  async function togglePermission(source: WebSource, key: 'crawlPermitted' | 'searchPermitted', value: boolean) {
    setIsBusy(true);
    try {
      await updateWebSource(source.id, {
        name: source.name,
        domain: source.domain,
        description: source.description,
        purpose: source.purpose,
        isActive: source.isActive,
        crawlPermitted: key === 'crawlPermitted' ? value : source.crawlPermitted,
        searchPermitted: key === 'searchPermitted' ? value : source.searchPermitted,
        respectRobots: source.respectRobots,
        rateLimitPerMinute: source.rateLimitPerMinute,
        notes: source.notes,
      });
      load();
    } finally {
      setIsBusy(false);
    }
  }

  async function remove(source: WebSource) {
    setIsBusy(true);
    try {
      await deleteWebSource(source.id);
      load();
    } finally {
      setIsBusy(false);
    }
  }

  return (
    <section className="seo-settings">
      <h3>
        Web sources
        {capabilities && !capabilities.canRetrieve && (
          <span className="deferred-badge">Deferred to Phase 2</span>
        )}
      </h3>
      <p className="seo-form__hint">
        Websites you authorise Cynth to investigate for research, citations and backlink opportunities.
      </p>

      {/* WEB CRAWL IS NOT OPERATIONAL, and this says so before anything else
          on the panel. The screen below is a permission list, which is a real
          thing — but a screen that exists is not a feature that works, and
          the difference has to be stated rather than inferred from the
          absence of a Crawl button. */}
      {capabilities && (
        <p className={`seo-panel__note${capabilities.canRetrieve ? '' : ' seo-panel__note--deferred'}`}>
          <strong>{capabilities.canRetrieve ? 'A web retriever is configured.' : 'Cynth has no web retriever.'}</strong>{' '}
          {capabilities.note}
          {!capabilities.canRetrieve && (
            <>
              {' '}
              Verified at Milestone 15: the retriever registry is empty, no endpoint fetches a URL, and nothing has
              ever been retrieved. Web crawling, web intelligence and backlink discovery are Phase 2.
            </>
          )}
        </p>
      )}

      {errors && (
        <div className="form-error" role="alert">
          {errors.map((error) => (
            <p key={error}>{error}</p>
          ))}
        </div>
      )}

      <form className="seo-form__row" onSubmit={add} style={{ marginTop: 'var(--space-4)' }}>
        <div className="seo-form__field">
          <label htmlFor="web-source-name">Name</label>
          <input
            id="web-source-name"
            type="text"
            value={name}
            required
            onChange={(e) => setName(e.target.value)}
            placeholder="What this site is"
          />
        </div>
        <div className="seo-form__field">
          <label htmlFor="web-source-domain">Domain</label>
          <input
            id="web-source-domain"
            type="text"
            value={domain}
            required
            onChange={(e) => setDomain(e.target.value)}
            placeholder="example.org"
          />
        </div>
        <div className="seo-form__field">
          <label htmlFor="web-source-purpose">Purpose</label>
          <select id="web-source-purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)}>
            {(capabilities?.purposes ?? Object.keys(PURPOSE_LABELS)).map((value) => (
              <option key={value} value={value}>
                {PURPOSE_LABELS[value] ?? value}
              </option>
            ))}
          </select>
        </div>
        <div className="seo-form__field" style={{ alignSelf: 'end' }}>
          <button type="submit" className="button button--primary" disabled={isBusy}>
            Add source
          </button>
        </div>
      </form>

      {sources.length === 0 ? (
        <p className="seo-empty">No web sources configured. Cynth investigates nothing until you add one.</p>
      ) : (
        <ul className="seo-sources__list">
          {sources.map((source) => (
            <li key={source.id} className="seo-sources__item">
              <div>
                <strong>{source.name}</strong>
                <div className="seo-review__muted">
                  {source.domain}
                  {source.purpose && ` · ${PURPOSE_LABELS[source.purpose] ?? source.purpose}`}
                  {source.respectRobots && ' · respects robots.txt'}
                </div>
              </div>

              <div className="seo-sources__perms">
                <label>
                  <input
                    type="checkbox"
                    checked={source.crawlPermitted}
                    disabled={isBusy}
                    onChange={(e) => void togglePermission(source, 'crawlPermitted', e.target.checked)}
                  />{' '}
                  May crawl
                </label>
                <label>
                  <input
                    type="checkbox"
                    checked={source.searchPermitted}
                    disabled={isBusy}
                    onChange={(e) => void togglePermission(source, 'searchPermitted', e.target.checked)}
                  />{' '}
                  May search
                </label>
                <button type="button" className="button button--ghost" disabled={isBusy} onClick={() => void remove(source)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
