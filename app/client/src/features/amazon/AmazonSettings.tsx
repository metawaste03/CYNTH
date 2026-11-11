import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ApiError, api } from '../../shared/services/apiClient';
import '../content/Content.css';

/**
 * Amazon Creators API configuration.
 *
 * The two credential fields are write-only, exactly like the AI provider key
 * and the WordPress application password: the server never returns them, so
 * they render empty with a note saying whether one is stored. Leaving them
 * blank on save keeps whatever is already there.
 */

interface AmazonConfig {
  partnerTag: string | null;
  marketplace: string;
  credentialVersion: string;
  hasCredentials: boolean;
  isConfigured: boolean;
}

interface ConfigResponse {
  config: AmazonConfig;
  marketplaces: { value: string; label: string; region: string }[];
  credentialVersions: { value: string; label: string }[];
  resources: string[];
}

interface TestResult {
  ok: boolean;
  itemCount?: number;
  message?: string;
  errors?: { code: string; message: string }[];
}

export function AmazonSettings() {
  const [data, setData] = useState<ConfigResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [remedy, setRemedy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const [partnerTag, setPartnerTag] = useState('');
  const [marketplace, setMarketplace] = useState('www.amazon.com');
  const [credentialVersion, setCredentialVersion] = useState('3.1');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [testAsin, setTestAsin] = useState('');

  function load() {
    setIsLoading(true);
    api
      .get<ConfigResponse>('/amazon/config')
      .then((response) => {
        setData(response);
        setPartnerTag(response.config.partnerTag ?? '');
        setMarketplace(response.config.marketplace);
        setCredentialVersion(response.config.credentialVersion);
        setError(null);
      })
      .catch((err) => setError(err instanceof ApiError ? err.errors.join(' ') : 'Failed to load the configuration.'))
      .finally(() => setIsLoading(false));
  }

  useEffect(load, []);

  function fail(err: unknown, fallback: string) {
    setError(err instanceof ApiError ? err.errors.join(' ') : fallback);
    setRemedy(err instanceof ApiError && typeof err.details?.remedy === 'string' ? err.details.remedy : null);
    setNotice(null);
  }

  async function handleSave(event: FormEvent) {
    event.preventDefault();
    setBusy('save');
    try {
      // Only send a credential field when the user actually typed one, so
      // saving other settings never clears a stored secret.
      await api.put<{ config: AmazonConfig }>('/amazon/config', {
        partnerTag,
        marketplace,
        credentialVersion,
        ...(clientId ? { clientId } : {}),
        ...(clientSecret ? { clientSecret } : {}),
      });
      setClientId('');
      setClientSecret('');
      setTestResult(null);
      load();
      setNotice('Saved.');
      setError(null);
      setRemedy(null);
    } catch (err) {
      fail(err, 'Could not save the configuration.');
    } finally {
      setBusy(null);
    }
  }

  async function handleTest() {
    setBusy('test');
    setTestResult(null);
    try {
      const result = await api.post<TestResult>('/amazon/test', testAsin.trim() ? { asin: testAsin.trim() } : {});
      setTestResult(result);
      setError(null);
      setRemedy(null);
      setNotice(null);
    } catch (err) {
      setTestResult({ ok: false });
      fail(err, 'The connection test failed.');
    } finally {
      setBusy(null);
    }
  }

  async function handleClearCredentials() {
    if (!window.confirm('Remove the stored Creators API credentials? Amazon product lookups will stop working.')) return;

    setBusy('clear');
    try {
      await api.put<{ config: AmazonConfig }>('/amazon/config', { clientId: '', clientSecret: '' });
      setTestResult(null);
      load();
      setNotice('Credentials removed.');
    } catch (err) {
      fail(err, 'Could not remove the credentials.');
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader
        title="Amazon Creators API"
        description="Amazon's official product-data service, and the only way Cynth obtains Amazon product information."
      />

      <p className="content-scope">
        <Link to="/settings">← Settings</Link>
      </p>

      {error && (
        <p className="form-error" role="alert">
          {error}
          {remedy && <span className="product-research__remedy">{remedy}</span>}
        </p>
      )}
      {notice && <p className="form-notice">{notice}</p>}

      <section className="content-section">
        <h2>Status</h2>
        <p className="content-hint">
          {data?.config.isConfigured ? (
            <>
              Configured. Amazon product URLs are looked up through the Creators API. Cynth does not read Amazon
              product pages — they publish no usable product data.
            </>
          ) : data?.config.hasCredentials ? (
            <>Credentials are stored, but an Associates partner tag is still needed before the API can be called.</>
          ) : (
            <>
              Not configured. Amazon product URLs will be refused with an explanation rather than falling back to
              reading the page.
            </>
          )}
        </p>
      </section>

      <form className="content-section" onSubmit={handleSave}>
        <h2>Credentials</h2>
        <p className="content-hint">
          Generate these in Amazon Associates Central under Tools → Creators API. Access requires at least 10
          qualifying sales in the last 30 days, and Amazon revokes it if that lapses. The two values are stored in
          Cynth's local secrets file, never in the database, and are never sent back to this screen.
        </p>

        <label className="wizard-field">
          Credential ID
          <input
            value={clientId}
            onChange={(e) => setClientId(e.target.value)}
            placeholder={data?.config.hasCredentials ? 'Stored — type a new value to replace it' : 'Required'}
            autoComplete="off"
          />
        </label>

        <label className="wizard-field">
          Credential Secret
          <input
            type="password"
            value={clientSecret}
            onChange={(e) => setClientSecret(e.target.value)}
            placeholder={data?.config.hasCredentials ? 'Stored — type a new value to replace it' : 'Required'}
            autoComplete="off"
          />
        </label>

        <label className="wizard-field">
          Credential Version
          <select value={credentialVersion} onChange={(e) => setCredentialVersion(e.target.value)}>
            {data?.credentialVersions.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p className="content-hint">
          Shown next to the credentials in Associates Central. It selects which Amazon region issues the access
          token, so a mismatch here is the usual cause of an authentication failure.
        </p>

        <h2>Associates</h2>

        <label className="wizard-field">
          Partner Tag
          <input
            value={partnerTag}
            onChange={(e) => setPartnerTag(e.target.value)}
            placeholder="e.g. everyfivedays-20"
          />
        </label>
        <p className="content-hint">
          Your Associates tracking ID. Required by the API. This is not a secret — it appears in every affiliate link
          on your site — and it is never used to build a link: the affiliate URL you supply per product is always
          used exactly as you gave it.
        </p>

        <label className="wizard-field">
          Default Marketplace
          <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
            {data?.marketplaces.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>
        <p className="content-hint">
          Used when a product URL does not name a marketplace of its own. A URL from a specific Amazon site is looked
          up on that site.
        </p>

        <div className="content-form__actions">
          <button type="submit" className="button button--primary" disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save'}
          </button>
          {data?.config.hasCredentials && (
            <button
              type="button"
              className="button button--danger"
              disabled={busy === 'clear'}
              onClick={handleClearCredentials}
            >
              Remove Credentials
            </button>
          )}
        </div>
      </form>

      <section className="content-section">
        <h2>Test Connection</h2>
        <p className="content-hint">
          Makes one real request to Amazon and discards the result. It proves the credentials, the partner tag and
          the endpoint work together. Nothing is created and no product is written.
        </p>

        <label className="wizard-field">
          Test ASIN <span className="product-research__muted">(optional)</span>
          <input value={testAsin} onChange={(e) => setTestAsin(e.target.value)} placeholder="Defaults to a known ASIN" />
        </label>

        <div className="content-form__actions">
          <button
            type="button"
            className="button"
            disabled={busy === 'test' || !data?.config.isConfigured}
            onClick={handleTest}
          >
            {busy === 'test' ? 'Testing…' : 'Test Connection'}
          </button>
        </div>

        {testResult?.ok && (
          <p className="form-notice">
            {testResult.message}
            {testResult.errors?.length ? ` Amazon also reported: ${testResult.errors.map((e) => `${e.code}: ${e.message}`).join('; ')}` : ''}
          </p>
        )}
      </section>

      <section className="content-section">
        <h2>What Cynth Requests</h2>
        <p className="content-hint">
          The exact resources asked for on every product lookup. Prices are deliberately not among them — Cynth never
          publishes a price, because it goes stale immediately.
        </p>
        <ul className="content-list">
          {data?.resources.map((resource) => (
            <li key={resource}>
              <code>{resource}</code>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
