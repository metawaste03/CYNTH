import { getDatabase } from '../../shared/database/index.js';
import type { ArticleTypeRow } from '../../shared/database/types.js';

export interface ArticleTypeDto {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
}

function mapArticleType(row: ArticleTypeRow): ArticleTypeDto {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
  };
}

/** Read-only: article_types is seeded reference data (Milestone 2), not user-editable here. */
export function listArticleTypes(): ArticleTypeDto[] {
  const db = getDatabase();
  const rows = db.prepare('SELECT * FROM article_types ORDER BY id ASC').all() as unknown as ArticleTypeRow[];
  return rows.map(mapArticleType);
}

export function getArticleTypeById(id: number): ArticleTypeDto | null {
  const db = getDatabase();
  const row = db.prepare('SELECT * FROM article_types WHERE id = ?').get(id) as unknown as ArticleTypeRow | undefined;
  if (!row) return null;
  return mapArticleType(row);
}
