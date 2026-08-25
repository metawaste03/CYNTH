import { api } from '../../shared/services/apiClient';
import type { DashboardSummary } from '../../shared/types/dashboard';

export function fetchDashboardSummary(): Promise<DashboardSummary> {
  return api.get<DashboardSummary>('/dashboard/summary');
}
