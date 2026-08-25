import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  description: string;
}

/** Title + short description, used at the top of every feature page. */
export function PageHeader({ title, description }: PageHeaderProps) {
  return (
    <header className="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
    </header>
  );
}
