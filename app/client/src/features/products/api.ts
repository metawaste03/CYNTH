import { api } from '../../shared/services/apiClient';
import type { Product, ProductDetail, ProductImage, ProductInput, ProductListItem } from '../../shared/types/product';

export interface ProductListFilters {
  search?: string;
  category?: string;
  status?: 'active' | 'inactive';
}

function buildQuery(filters: ProductListFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.category) params.set('category', filters.category);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export function fetchProducts(filters: ProductListFilters = {}): Promise<ProductListItem[]> {
  return api.get<{ products: ProductListItem[] }>(`/products${buildQuery(filters)}`).then((r) => r.products);
}

export function fetchProductCategories(): Promise<string[]> {
  return api.get<{ categories: string[] }>('/products/meta/categories').then((r) => r.categories);
}

export function fetchProduct(id: number): Promise<ProductDetail> {
  return api.get<{ product: ProductDetail }>(`/products/${id}`).then((r) => r.product);
}

export function createProduct(input: ProductInput): Promise<ProductDetail> {
  return api.post<{ product: ProductDetail }>('/products', input).then((r) => r.product);
}

export function updateProduct(id: number, input: ProductInput): Promise<ProductDetail> {
  return api.put<{ product: ProductDetail }>(`/products/${id}`, input).then((r) => r.product);
}

export function setProductStatus(id: number, isActive: boolean): Promise<Product> {
  return api.patch<{ product: Product }>(`/products/${id}/status`, { isActive }).then((r) => r.product);
}

export function deleteProduct(id: number): Promise<void> {
  return api.delete(`/products/${id}`);
}

export function uploadProductImage(productId: number, file: File, isPrimary = false): Promise<ProductImage> {
  const formData = new FormData();
  formData.append('file', file);
  if (isPrimary) formData.append('isPrimary', 'true');
  return api.upload<{ image: ProductImage }>(`/products/${productId}/images`, formData).then((r) => r.image);
}

export function setPrimaryImage(productId: number, imageId: number): Promise<ProductImage> {
  return api.patch<{ image: ProductImage }>(`/products/${productId}/images/${imageId}/primary`, {}).then((r) => r.image);
}

export function deleteProductImage(productId: number, imageId: number): Promise<void> {
  return api.delete(`/products/${productId}/images/${imageId}`);
}
