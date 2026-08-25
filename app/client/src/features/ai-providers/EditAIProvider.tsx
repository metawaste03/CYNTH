import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ProviderForm } from './ProviderForm';
import { fetchProvider, updateProvider } from './api';
import type { ProviderDetail } from '../../shared/types/aiProvider';

export function EditAIProvider() {
  const { id } = useParams();
  const navigate = useNavigate();
  const providerId = Number(id);

  const [provider, setProvider] = useState<ProviderDetail | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsLoading(true);
    fetchProvider(providerId)
      .then(setProvider)
      .catch(() => setError('Provider not found.'))
      .finally(() => setIsLoading(false));
  }, [providerId]);

  if (isLoading) {
    return (
      <div className="page">
        <p>Loading…</p>
      </div>
    );
  }

  if (error || !provider) {
    return (
      <div className="page">
        <PageHeader title="Provider not found" description="This AI provider may have been deleted." />
        <Link to="/settings/ai-providers">Back to AI Providers</Link>
      </div>
    );
  }

  return (
    <div className="page">
      <PageHeader title={`Edit ${provider.name}`} description="Update this provider's configuration. Models are managed from its detail page." />
      <ProviderForm
        submitLabel="Save Changes"
        hasExistingKey={provider.hasApiKey}
        initialValues={{
          name: provider.name,
          providerType: provider.providerType,
          description: provider.description ?? '',
          baseUrl: provider.baseUrl ?? '',
          defaultModel: provider.defaultModel ?? '',
        }}
        onSubmit={async (input) => {
          const updated = await updateProvider(providerId, input);
          navigate(`/settings/ai-providers/${updated.id}`, { state: { flash: 'Changes saved.' } });
        }}
      />
    </div>
  );
}
