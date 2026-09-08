import type { SVGProps } from 'react';

/**
 * A small, hand-drawn icon set used throughout the app shell.
 * Deliberately not a third-party icon package — keeps the dependency
 * footprint minimal per docs/04_DEVELOPMENT_RULES.md ("no unnecessary
 * dependencies"). Every icon inherits color via `currentColor`.
 */
export type IconName =
  | 'dashboard'
  | 'newArticle'
  | 'authors'
  | 'products'
  | 'seoReview'
  | 'qualityGate'
  | 'settings'
  | 'system'
  | 'site'
  | 'media'
  | 'menu'
  | 'close';

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
}

const shared = {
  viewBox: '0 0 24 24',
  fill: 'none' as const,
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function Icon({ name, ...rest }: IconProps) {
  switch (name) {
    case 'dashboard':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="13" y="3.5" width="7.5" height="7.5" rx="1.5" />
          <rect x="3.5" y="13" width="7.5" height="7.5" rx="1.5" />
          <rect x="13" y="13" width="7.5" height="7.5" rx="1.5" />
        </svg>
      );
    case 'newArticle':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <path d="M6 3.5h8l4 4V20a.5.5 0 0 1-.5.5h-11A.5.5 0 0 1 6 20z" />
          <path d="M14 3.5V8h4" />
          <path d="M12 12v5M9.5 14.5h5" />
        </svg>
      );
    case 'authors':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <circle cx="9" cy="8" r="3" />
          <path d="M3.5 20c0-3.31 2.46-5.5 5.5-5.5s5.5 2.19 5.5 5.5" />
          <circle cx="17" cy="8.5" r="2.25" />
          <path d="M15.5 14.75c2.4.2 4.5 2.1 4.9 5.25" />
        </svg>
      );
    case 'products':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <path d="M12 3.5 20 7.5 12 11.5 4 7.5z" />
          <path d="M4 7.5V16l8 4 8-4V7.5" />
          <path d="M12 11.5V20.5" />
        </svg>
      );
    case 'seoReview':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.3 15.3 20.5 20.5" />
        </svg>
      );
    case 'qualityGate':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <path d="M12 3.5 19 6v5.5c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z" />
          <path d="m9 12 2 2 4-4.5" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <line x1="4" y1="6" x2="20" y2="6" />
          <circle cx="9" cy="6" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <circle cx="15" cy="12" r="2" fill="currentColor" stroke="none" />
          <line x1="4" y1="18" x2="20" y2="18" />
          <circle cx="11" cy="18" r="2" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'system':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <path d="M3 12h4l2-6 4 12 2-6h6" />
        </svg>
      );
    case 'site':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <circle cx="12" cy="12" r="8.5" />
          <path d="M3.5 12h17" />
          <path d="M12 3.5c2.5 2.2 3.8 5.2 3.8 8.5s-1.3 6.3-3.8 8.5c-2.5-2.2-3.8-5.2-3.8-8.5S9.5 5.7 12 3.5Z" />
        </svg>
      );
    case 'menu':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <line x1="4" y1="6.5" x2="20" y2="6.5" />
          <line x1="4" y1="12" x2="20" y2="12" />
          <line x1="4" y1="17.5" x2="20" y2="17.5" />
        </svg>
      );
    case 'media':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="14" rx="2" />
          <circle cx="8.5" cy="10" r="1.6" />
          <path d="M3.5 16.5 9 12l4 3.5 3-2.5 4.5 3.5" />
        </svg>
      );
    case 'close':
      return (
        <svg {...shared} {...rest} aria-hidden="true">
          <line x1="5" y1="5" x2="19" y2="19" />
          <line x1="19" y1="5" x2="5" y2="19" />
        </svg>
      );
    default:
      return null;
  }
}
