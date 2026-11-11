import { Link } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { Icon, type IconName } from '../../shared/components/Icon/Icon';
import './Settings.css';

interface SettingsSection {
  icon: IconName;
  title: string;
  description: string;
  href?: string;
}

const SECTIONS: SettingsSection[] = [
  {
    icon: 'system',
    title: 'AI Providers',
    description: 'Connect and configure the AI providers Cynth uses for drafting and review.',
    href: '/settings/ai-providers',
  },
  {
    icon: 'site',
    title: 'WordPress',
    description: 'Connect a WordPress site so approved drafts can be sent to it. Cynth never publishes automatically.',
    href: '/settings/wordpress',
  },
  {
    icon: 'system',
    title: 'Model Roles',
    description:
      'Which model performs which job. Premium models where quality matters; a much cheaper one for the narrow keyword task.',
    href: '/settings/models',
  },
  {
    icon: 'products',
    title: 'Amazon Creators API',
    description:
      "Amazon's official product-data service. Required for Amazon product URLs — Cynth does not read Amazon product pages.",
    href: '/settings/amazon',
  },
  {
    icon: 'qualityGate',
    title: 'Editorial',
    description: 'Publication-wide standards, including how long an article may be.',
    href: '/settings/editorial',
  },
  {
    icon: 'settings',
    title: 'General',
    description: 'General application preferences.',
  },
];

export function Settings() {
  return (
    <div className="page settings">
      <PageHeader title="Settings" description="Configure Cynth." />
      <div className="settings__list">
        {SECTIONS.map((section) =>
          section.href ? (
            <Link key={section.title} to={section.href} className="settings__section settings__section--active">
              <div className="settings__section-icon">
                <Icon name={section.icon} />
              </div>
              <div className="settings__section-body">
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
              <span className="status-badge is-active">Configure</span>
            </Link>
          ) : (
            <section key={section.title} className="settings__section" aria-disabled="true">
              <div className="settings__section-icon">
                <Icon name={section.icon} />
              </div>
              <div className="settings__section-body">
                <h2>{section.title}</h2>
                <p>{section.description}</p>
              </div>
              <span className="settings__section-badge">Not yet configurable</span>
            </section>
          ),
        )}
      </div>
    </div>
  );
}
