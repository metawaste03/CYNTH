export interface ProductImage {
  id: number;
  url: string;
  originalFilename: string | null;
  isPrimary: boolean;
  position: number;
  createdAt: string;
}

export interface Product {
  id: number;
  title: string;
  brand: string | null;
  category: string | null;
  shortDescription: string | null;
  description: string | null;
  /** The user's link. Supplied by them, stored verbatim, never rewritten by research. */
  affiliateLink: string | null;
  editorialFit: string | null;
  notes: string | null;
  isActive: boolean;
  /* --- Product research (Milestone 17). Null until a product has been researched. --- */
  /** The page that was read for research — never used as a link in an article. */
  sourceUrl: string | null;
  vendor: string | null;
  sourceImageUrl: string | null;
  useCase: string | null;
  problemSolved: string | null;
  bestFor: string | null;
  keyFeatures: string[];
  researchStatus: 'none' | 'retrieved' | 'researched' | 'failed';
  researchedAt: string | null;
  /** The thematic area this product belongs to (Milestone 18). Null means none chosen. */
  themeId: number | null;
  themeName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductListItem extends Product {
  primaryImage: ProductImage | null;
}

export interface ProductDetail extends Product {
  images: ProductImage[];
}

export interface ProductInput {
  title: string;
  brand?: string;
  category?: string;
  shortDescription?: string;
  description?: string;
  affiliateLink?: string;
  editorialFit?: string;
  notes?: string;
  isActive?: boolean;
  /** null clears the thematic area; undefined leaves it alone. */
  themeId?: number | null;
  /**
   * The fields the article writer reads (Milestone 27). An empty string is a
   * deliberate clear; an absent field leaves what research wrote alone.
   */
  useCase?: string;
  problemSolved?: string;
  bestFor?: string;
  keyFeatures?: string[];
}
