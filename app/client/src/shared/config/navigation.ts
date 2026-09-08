import type { NavItem } from '../types/navigation';

/** Single source of truth for the primary left navigation. */
export const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: 'dashboard' },
  { id: 'generate', label: 'Generate Article', path: '/generate', icon: 'newArticle' },
  { id: 'new-article', label: 'New Article (manual)', path: '/new-article', icon: 'newArticle' },
  { id: 'drafts', label: 'Drafts', path: '/drafts', icon: 'site' },
  { id: 'themes', label: 'Thematic Areas', path: '/content/themes', icon: 'dashboard' },
  { id: 'authors', label: 'Authors', path: '/authors', icon: 'authors' },
  { id: 'author-skills', label: 'Author Skills', path: '/author-skills', icon: 'authors' },
  { id: 'products', label: 'Products', path: '/products', icon: 'products' },
  { id: 'media', label: 'Media Library', path: '/media', icon: 'media' },
  { id: 'seo-review', label: 'SEO Review', path: '/seo-review', icon: 'seoReview' },
  { id: 'quality-gate', label: 'Quality Gate', path: '/quality-gate', icon: 'qualityGate' },
  { id: 'settings', label: 'Settings', path: '/settings', icon: 'settings' },
];
