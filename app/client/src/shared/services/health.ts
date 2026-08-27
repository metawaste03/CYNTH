import { api, ApiError, SERVER_UNREACHABLE } from './apiClient';

/**
 * BACKEND HEALTH.
 *
 * Cynth's UI must be able to say, plainly, whether its own backend is
 * Running or Unavailable — because "Request failed" for a backend that simply
 * is not running reads as *the AI rejected your request*, and has already
 * cost real debugging time chasing a generation bug that did not exist
 * (docs/14_LOCAL_SERVICE_MANAGEMENT.md).
 *
 * This is a status report, not a control surface. The browser cannot start a
 * server and this module does not pretend otherwise: when the backend is
 * down, it says so and says how to start it.
 */

export interface HealthResponse {
  status: string;
  service: string;
  timestamp: string;
  startedAt: string;
  uptimeSeconds: number;
  /** 'production' when one process serves both the API and this client; 'development' when Vite serves the client. */
  mode: 'production' | 'development' | string;
  servingClient: boolean;
  database: { connected: boolean; path: string; tables: string[] };
}

export type BackendStatus = 'checking' | 'running' | 'unavailable';

export interface HealthState {
  status: BackendStatus;
  health: HealthResponse | null;
  /** Plain-language explanation when the backend is unavailable. */
  message: string | null;
  checkedAt: Date | null;
}

export function fetchHealth(): Promise<HealthResponse> {
  return api.get<HealthResponse>('/health');
}

/**
 * Turns a failed health check into a message that names the actual problem.
 *
 * The three cases are genuinely different: nothing listening at all, a
 * process that is up but broken, and a proxy that cannot reach the backend.
 */
export function describeHealthFailure(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === SERVER_UNREACHABLE || error.status === 0) {
      return 'The Cynth backend is not responding. Start it with "npm start" (production) or "npm run dev" in app/server (development).';
    }
    if (error.status >= 500) {
      return `The Cynth backend answered with an error (HTTP ${error.status}). Check the server console.`;
    }
    return error.errors.join(' ');
  }
  return 'The Cynth backend could not be reached.';
}
