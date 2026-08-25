import { Icon, type IconName } from '../Icon/Icon';
import './PlaceholderCard.css';

interface PlaceholderCardProps {
  icon: IconName;
  title: string;
  status: string;
  description: string;
}

/** A single Dashboard summary card. Static content only — no live data. */
export function PlaceholderCard({ icon, title, status, description }: PlaceholderCardProps) {
  return (
    <article className="placeholder-card">
      <div className="placeholder-card__icon">
        <Icon name={icon} />
      </div>
      <div className="placeholder-card__body">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <span className="placeholder-card__status">{status}</span>
    </article>
  );
}
