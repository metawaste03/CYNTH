import { Link } from 'react-router-dom';
import { Icon, type IconName } from '../Icon/Icon';
import './PlaceholderCard.css';

interface PlaceholderCardProps {
  icon: IconName;
  title: string;
  status: string;
  description: string;
  /**
   * Optional link to the area that manages this collection.
   *
   * The Dashboard summarises a collection; the collection's own page is where
   * individual records are managed. A card that reports a count is far more
   * useful when it can also take you to the things it counted.
   */
  action?: { label: string; to: string };
}

/**
 * A single Dashboard summary card.
 *
 * Named "Placeholder" when the Dashboard was static; several cards now carry
 * live database values. Kept as-is rather than renamed, so this change stays
 * a Dashboard change and not a rename across the codebase.
 */
export function PlaceholderCard({ icon, title, status, description, action }: PlaceholderCardProps) {
  return (
    <article className="placeholder-card">
      <div className="placeholder-card__icon">
        <Icon name={icon} />
      </div>
      <div className="placeholder-card__body">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="placeholder-card__footer">
        <span className="placeholder-card__status">{status}</span>
        {action && (
          <Link className="placeholder-card__action" to={action.to}>
            {action.label}
          </Link>
        )}
      </div>
    </article>
  );
}
