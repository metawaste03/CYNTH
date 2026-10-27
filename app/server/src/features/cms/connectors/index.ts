import type { CmsConnector } from '../cms.types.js';
import { wordpressConnector } from './wordpressConnector.js';

/**
 * The CMS connector registry.
 *
 * Adding a CMS means writing one connector and adding it to this list — the
 * publish service, the routes, and the UI stay untouched, exactly as the AI
 * provider adapter registry works (../../generation/providers/index.ts).
 *
 * Keyed by cms_connections.connector_type.
 */
const CONNECTORS: CmsConnector[] = [wordpressConnector];

const CONNECTORS_BY_TYPE = new Map(CONNECTORS.map((connector) => [connector.connectorType, connector]));

export function getConnector(connectorType: string): CmsConnector | null {
  return CONNECTORS_BY_TYPE.get(connectorType.trim().toLowerCase()) ?? null;
}

/** What the settings UI offers when creating a connection. */
export function supportedConnectors(): { connectorType: string; label: string; authMethods: readonly string[] }[] {
  return CONNECTORS.map((connector) => ({
    connectorType: connector.connectorType,
    label: connector.label,
    authMethods: connector.authMethods,
  }));
}
