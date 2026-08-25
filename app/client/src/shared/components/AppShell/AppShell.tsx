import { useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { Sidebar } from '../Sidebar/Sidebar';
import { Icon } from '../Icon/Icon';
import './AppShell.css';

/**
 * Top-level layout: permanent left sidebar + main content area.
 * Below the responsive breakpoint the sidebar becomes a toggleable drawer.
 */
export function AppShell() {
  const [isNavOpen, setIsNavOpen] = useState(false);
  const location = useLocation();

  // Close the mobile drawer whenever the route changes.
  useEffect(() => {
    setIsNavOpen(false);
  }, [location.pathname]);

  // Close on Escape for keyboard users.
  useEffect(() => {
    if (!isNavOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsNavOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isNavOpen]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <Sidebar isOpen={isNavOpen} onNavigate={() => setIsNavOpen(false)} />

      {isNavOpen && (
        <button
          type="button"
          className="app-shell__backdrop"
          aria-label="Close navigation"
          onClick={() => setIsNavOpen(false)}
        />
      )}

      <div className="app-shell__main-col">
        <header className="app-shell__topbar">
          <button
            type="button"
            className="app-shell__menu-button"
            aria-label={isNavOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={isNavOpen}
            onClick={() => setIsNavOpen((open) => !open)}
          >
            <Icon name={isNavOpen ? 'close' : 'menu'} />
          </button>
          <span className="app-shell__topbar-title">Cynth</span>
        </header>

        <main className="app-shell__content" id="main-content" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}
