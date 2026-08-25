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
  affiliateLink: string | null;
  editorialFit: string | null;
  notes: string | null;
  isActive: boolean;
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
}
