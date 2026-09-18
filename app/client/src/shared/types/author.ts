export interface WritingSample {
  id: number;
  title: string;
  notes: string | null;
  fullText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Author {
  id: number;
  name: string;
  category: string | null;
  shortBiography: string | null;
  philosophy: string | null;
  writingStyle: string | null;
  tone: string | null;
  targetAudience: string | null;
  preferredExpressions: string | null;
  prohibitedExpressions: string | null;
  writingNotes: string | null;
  /** Author persona (Milestone 11) — reaches the model as generation guidance. */
  expertise: string | null;
  perspective: string | null;
  editorialPrinciples: string | null;
  boundaries: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthorDetail extends Author {
  writingSamples: WritingSample[];
}

export interface WritingSampleInput {
  title: string;
  notes?: string;
  fullText: string;
}

export interface AuthorInput {
  name: string;
  category?: string;
  shortBiography?: string;
  philosophy?: string;
  writingStyle?: string;
  tone?: string;
  targetAudience?: string;
  preferredExpressions?: string;
  prohibitedExpressions?: string;
  writingNotes?: string;
  expertise?: string;
  perspective?: string;
  editorialPrinciples?: string;
  boundaries?: string;
  isActive?: boolean;
  writingSamples?: WritingSampleInput[];
}
