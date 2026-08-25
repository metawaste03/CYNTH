import { Icon, type IconName } from '../Icon/Icon';
import './EmptyState.css';

interface EmptyStateProps {
  icon: IconName;
  title: string;
  message: string;
}

/** Placeholder content indicating future functionality, reused across feature pages. */
export function EmptyState({ icon, title, message }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} />
      </div>
      <h2>{title}</h2>
      <p>{message}</p>
      <span className="empty-state__badge">Coming in a future milestone</span>
    </div>
  );
}
