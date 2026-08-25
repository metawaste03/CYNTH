import { Link } from 'react-router-dom';
import { PageHeader } from '../PageHeader/PageHeader';

/** Fallback route for unknown paths. Not one of the seven feature pages — shared shell plumbing. */
export function NotFound() {
  return (
    <div className="page">
      <PageHeader title="Page not found" description="The page you're looking for doesn't exist in Cynth." />
      <p>
        <Link to="/">Return to the Dashboard</Link>
      </p>
    </div>
  );
}
