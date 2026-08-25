import type { DatabaseSync } from 'node:sqlite';

/** The 10 article types requested for Milestone 2, each with a short description. */
export const ARTICLE_TYPE_SEEDS: { name: string; description: string }[] = [
  {
    name: 'Product Review',
    description: 'An in-depth assessment of a single product, covering its strengths, weaknesses, and who it suits.',
  },
  {
    name: 'Educational Article',
    description: 'Explains a topic, concept, or process to help readers understand it, without focusing on a specific product.',
  },
  {
    name: 'Buying Guide',
    description: 'Helps readers choose between options in a category by walking through what to look for and why.',
  },
  {
    name: 'Comparison',
    description: 'Places two or more products or approaches side by side to highlight differences and trade-offs.',
  },
  {
    name: 'Roundup',
    description: 'Curates a list of recommended products or resources within a category.',
  },
  {
    name: 'Opinion',
    description: "Shares the author's editorial point of view on a topic, trend, or product.",
  },
  {
    name: 'Beginner Guide',
    description: 'An introductory walkthrough aimed at readers who are new to a topic.',
  },
  {
    name: 'FAQ',
    description: 'Answers common reader questions on a topic in a structured question-and-answer format.',
  },
  {
    name: 'Case Study',
    description: 'Walks through a real or illustrative example in detail to show an outcome or process in practice.',
  },
  {
    name: 'How-To',
    description: 'Provides step-by-step instructions for completing a specific task.',
  },
];

export interface SeedResult {
  seeded: boolean;
  count: number;
}

/**
 * Seeds article_types only if the table is empty. INSERT OR IGNORE against the
 * UNIQUE(name) constraint is a second safety net, so calling this on every
 * app startup can never produce duplicate rows.
 */
export function seedArticleTypes(db: DatabaseSync): SeedResult {
  const before = db.prepare('SELECT COUNT(*) AS count FROM article_types').get() as { count: number };

  if (before.count > 0) {
    return { seeded: false, count: before.count };
  }

  const insert = db.prepare('INSERT OR IGNORE INTO article_types (name, description) VALUES (?, ?)');
  for (const type of ARTICLE_TYPE_SEEDS) {
    insert.run(type.name, type.description);
  }

  const after = db.prepare('SELECT COUNT(*) AS count FROM article_types').get() as { count: number };
  return { seeded: true, count: after.count };
}
