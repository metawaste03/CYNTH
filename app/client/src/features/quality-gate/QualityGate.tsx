import { PageHeader } from '../../shared/components/PageHeader/PageHeader';
import { EmptyState } from '../../shared/components/EmptyState/EmptyState';

export function QualityGate() {
  return (
    <div className="page">
      <PageHeader
        title="Quality Gate"
        description="The last checkpoint before an article is handed off for human approval and publishing."
      />
      <EmptyState
        icon="qualityGate"
        title="Quality checks aren't available yet"
        message="Editorial-standard checks will run here once the Quality Gate is implemented."
      />
    </div>
  );
}
