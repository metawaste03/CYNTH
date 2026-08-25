import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { ProviderForm } from './ProviderForm';
import { createProvider } from './api';

export function NewAIProvider() {
  const navigate = useNavigate();

  return (
    <div className="page">
      <PageHeader title="Add AI Provider" description="Configure a new AI provider. No requests are ever sent until a future milestone implements generation." />
      <ProviderForm
        submitLabel="Add Provider"
        onSubmit={async (input) => {
          const provider = await createProvider(input);
          navigate(`/settings/ai-providers/${provider.id}`, { state: { flash: `${provider.name} was added.` } });
        }}
      />
    </div>
  );
}
