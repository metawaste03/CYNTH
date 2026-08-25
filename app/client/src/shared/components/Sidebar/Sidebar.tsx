import { NavLink } from 'react-router-dom';
import { Icon } from '../Icon/Icon';
import { NAV_ITEMS } from '../../config/navigation';
import './Sidebar.css';

interface SidebarProps {
  isOpen: boolean;
  onNavigate: () => void;
}

/** Permanent left navigation. Becomes a toggleable drawer below the responsive breakpoint. */
export function Sidebar({ isOpen, onNavigate }: SidebarProps) {
  return (
    <nav className={`sidebar${isOpen ? ' is-open' : ''}`} aria-label="Primary">
      <div className="sidebar__brand">
        <span className="sidebar__brand-mark" aria-hidden="true">C</span>
        <span className="sidebar__brand-name">Cynth</span>
      </div>

      <ul className="sidebar__list">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <NavLink
              to={item.path}
              end={item.path === '/'}
              className={({ isActive }) => `sidebar__link${isActive ? ' is-active' : ''}`}
              onClick={onNavigate}
            >
              <Icon name={item.icon} className="sidebar__icon" />
              <span>{item.label}</span>
            </NavLink>
          </li>
        ))}
      </ul>

      <div className="sidebar__footer">
        <span>Milestone 1 — Application Foundation</span>
      </div>
    </nav>
  );
}
