import type { NavItem } from '../types/navigation';

/** Single source of truth for the primary left navigation. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'dashboard' },
  { id: 'new-article', label: 'New Article', path: '/new-article', icon: 'newArticle' },
  { id: 'authors', label: 'Authors', path: '/authors', icon: 'authors' },
  { id: 'products', label: 'Products', path: '/products', icon: 'products' },
  { id: 'seo-review', label: 'SEO Review', path: '/seo-review', icon: 'seoReview' },
  { id: 'quality-gate', label: 'Quality Gate', path: '/quality-gate', icon: 'qualityGate' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];
