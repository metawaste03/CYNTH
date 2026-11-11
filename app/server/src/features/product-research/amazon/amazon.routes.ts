import { Router } from 'express';
import { AMAZON_MARKETPLACES } from './amazonUrl.js';
import { CREDENTIAL_VERSIONS, getAmazonConfig, updateAmazonConfig } from './amazonConfig.js';
import { clearTokenCache, CreatorsApiError, GET_ITEMS_RESOURCES, testConnection } from './creatorsApi.client.js';

/**
 * Amazon Creators API configuration — HTTP surface.
 *
 * The credential values enter through PUT and are never returned by anything:
 * the only fact any response here states about them is `hasCredentials`,
 * matching how AI provider keys and CMS credentials already behave.
 */
export const amazonRouter = Router();

amazonRouter.get('/config', (_req, res) => {
  res.json({
    config: getAmazonConfig(),
    // Published rather than hardcoded in the client, so adding a marketplace
    // stays a server-side change.
    marketplaces: AMAZON_MARKETPLACES.map((entry) => ({
      value: entry.marketplace,
      label: `${entry.marketplace} (${entry.countryCode})`,
      region: entry.region,
    })),
    credentialVersions: CREDENTIAL_VERSIONS.map((entry) => ({
      value: entry.version,
      label: `${entry.version} — ${entry.label}`,
    })),
    /** What Cynth asks Amazon for. Shown so the integration's reach is inspectable. */
    resources: GET_ITEMS_RESOURCES,
  });
});

amazonRouter.put('/config', (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>;

  const readSecretEdit = (value: unknown): string | undefined =>
    value === undefined ? undefined : typeof value === 'string' ? value : undefined;

  const { errors, config } = updateAmazonConfig({
    partnerTag: typeof body.partnerTag === 'string' ? body.partnerTag : undefined,
    marketplace: typeof body.marketplace === 'string' ? body.marketplace : undefined,
    credentialVersion: typeof body.credentialVersion === 'string' ? body.credentialVersion : undefined,
    clientId: readSecretEdit(body.clientId),
    clientSecret: readSecretEdit(body.clientSecret),
  });

  if (errors.length) return res.status(400).json({ errors });

  // Rotated credentials must not keep using a token minted from the old ones.
  clearTokenCache();
  res.json({ config });
});

/**
 * Proves the configuration works, against the real API.
 *
 * The same idea as the model Test button from Milestone 15: the smallest live
 * call that exercises auth, the partner tag and the endpoint together, with
 * the response discarded. Nothing is created and no product is written.
 */
amazonRouter.post('/test', async (req, res) => {
  const asin = typeof req.body?.asin === 'string' && req.body.asin.trim() ? req.body.asin.trim() : undefined;

  try {
    const result = await testConnection(asin);
    res.json({
      ok: true,
      itemCount: result.itemCount,
      // Amazon can answer successfully and still report a per-item problem —
      // an unknown ASIN, most often. Surfaced rather than swallowed.
      errors: result.errors,
      message: result.itemCount
        ? 'The Amazon Creators API answered and returned the test item.'
        : 'The Amazon Creators API authenticated, but returned no item for the test ASIN. Try a different ASIN from your marketplace.',
    });
  } catch (error) {
    if (error instanceof CreatorsApiError) {
      return res.status(400).json({
        ok: false,
        errors: [error.message],
        code: error.code,
        remedy: error.remedy,
      });
    }
    res.status(500).json({ ok: false, errors: [error instanceof Error ? error.message : 'Unexpected error.'] });
  }
});
