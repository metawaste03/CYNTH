import { getSetting } from '../../shared/settings/settings.repository.js';

/**
 * WHERE THE READERS ARE, AND WHAT MONEY THEY SPEND.
 *
 * Found in the copy: one article priced a whole buyer's guide in pounds —
 * "£300–£600", 68 times including the headline — for a publication whose
 * readers are in the United States. Nothing had told the writer otherwise.
 * The brief carried an audience description, a theme and a topic, and the
 * topic happened to be written with a pound sign, so the model followed it
 * all the way through and nothing downstream questioned it.
 *
 * A currency is not a style preference. A reader in Ohio reading "£400" has
 * to convert it before the advice means anything, and an affiliate link that
 * lands on a US retailer priced in dollars makes the article look careless.
 *
 * STORED, NOT HARDCODED. The market is a setting, so the day this publication
 * writes for another one, nobody has to find this file.
 */

export const PUBLICATION_MARKET_KEY = 'publication.market';
export const PUBLICATION_CURRENCY_KEY = 'publication.currency';

const DEFAULT_MARKET = 'the United States';
const DEFAULT_CURRENCY = 'US dollars ($)';

export interface PublicationMarket {
  market: string;
  currency: string;
}

export function getPublicationMarket(): PublicationMarket {
  return {
    market: getSetting(PUBLICATION_MARKET_KEY)?.trim() || DEFAULT_MARKET,
    currency: getSetting(PUBLICATION_CURRENCY_KEY)?.trim() || DEFAULT_CURRENCY,
  };
}

/**
 * The line handed to every stage that writes prose.
 *
 * Stated as a positive instruction with the one exception spelled out, rather
 * than as a prohibition — "do not use pounds" invites the model to think about
 * pounds, and says nothing about euros.
 */
export function describePublicationMarket(): string {
  const { market, currency } = getPublicationMarket();

  return [
    `Readers are in ${market}. All prices and budgets are in ${currency}, including in the title and in any figure quoted from a source.`,
    `Where a product is sold only outside ${market}, give the price in its own currency AND say which country it is sold in — never convert silently.`,
  ].join(' ');
}
