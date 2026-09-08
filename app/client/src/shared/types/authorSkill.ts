/**
 * Author skills (Milestone 16): the long-form authoring documents that define
 * an author's voice, and reach the model verbatim.
 */

/** 'author' applies to one author; 'shared' applies to every author. */
export type AuthorSkillScope = 'author' | 'shared';

export interface AuthorSkill {
  id: number;
  /** Null when unassigned, and always null for a shared skill. */
  authorId: number | null;
  scope: AuthorSkillScope;
  name: string;
  slug: string;
  /** The markdown, exactly as stored. */
  body: string;
  sourceFilename: string | null;
  position: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** List rows carry the document's size rather than the document. */
export interface AuthorSkillSummary extends Omit<AuthorSkill, 'body'> {
  characterCount: number;
  wordCount: number;
  authorName: string | null;
  /** The thematic areas the assigned author covers. */
  themes: { id: number; name: string }[];
}

export interface AuthorSkillInput {
  name: string;
  body: string;
  scope?: AuthorSkillScope;
  authorId?: number | null;
  sourceFilename?: string | null;
  position?: number;
  isActive?: boolean;
}

/** A markdown file sitting in the Author folder, and what Cynth has done with it. */
export interface LibraryFile {
  filename: string;
  title: string;
  characterCount: number;
  modifiedAt: string;
  importedSkillId: number | null;
  importedSkillName: string | null;
  changedSinceImport: boolean;
}

export interface LibraryListing {
  directory: string;
  exists: boolean;
  files: LibraryFile[];
}

export interface LibraryImportEntry {
  filename: string;
  outcome: 'imported' | 'updated' | 'skipped';
  skillId: number | null;
  authorName: string | null;
  authorCreated: boolean;
  themeName: string | null;
  themeLinked: boolean;
  scope: AuthorSkillScope;
  isActive: boolean;
  note: string | null;
}

export interface LibraryImportReport {
  entries: LibraryImportEntry[];
  authorsCreated: number;
  skillsImported: number;
  skillsUpdated: number;
  themesLinked: number;
  needsDecision: number;
  skipped: number;
}
