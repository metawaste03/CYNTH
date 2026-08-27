import { useCallback, useEffect, useRef, useState } from 'react';
import { describeHealthFailure, fetchHealth } from '../../services/health';
import type { HealthResponse, HealthState } from '../../services/health';
import './ServerHealth.css';

/**
 * The backend status indicator (Milestone 13, Part 22).
 *
 * Answers one question at a glance — is Cynth's backend Running or
 * Unavailable — so a stopped server can never again be mistaken for a
 * rejected request.
 *
 * Deliberately NOT a Start/Stop control. A browser page cannot execute
 * `npm start`, and a button that cannot actually start anything is worse than
 * no button (docs/14_LOCAL_SERVICE_MANAGEMENT.md). What it does instead is
 * say precisely what is wrong and what command fixes it.
 */

/** Quiet enough not to be noise, frequent enough that a crash is noticed within seconds. */
const POLL_INTERVAL_MS = 20_000;

function useBackendHealth(): HealthState & { refresh: () => void } {
  const [state, setState] = useState<HealthState>({
    status: 'checking',
    health: null,
    message: null,
    checkedAt: null,
  });

  // Guards against a slow response from an unmounted component overwriting
  // state, and against two checks racing on a manual refresh.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  const check = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;

    try {
      const health: HealthResponse = await fetchHealth();
      if (mounted.current) {
        setState({ status: 'running', health, message: null, checkedAt: new Date() });
      }
    } catch (error) {
      if (mounted.current) {
        setState({
          status: 'unavailable',
          health: null,
          message: describeHealthFailure(error),
          checkedAt: new Date(),
        });
      }
    } finally {
      inFlight.current = false;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void check();

    const timer = window.setInterval(() => void check(), POLL_INTERVAL_MS);
    // Coming back to the tab is exactly when a stale indicator is most
    // misleading, so re-check immediately rather than waiting out the interval.
    const onFocus = () => void check();
    window.addEventListener('focus', onFocus);

    return () => {
      mounted.current = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [check]);

  return { ...state, refresh: () => void check() };
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
}

/** The compact indicator shown in the app shell's top bar. */
export function ServerHealth() {
  const { status, health, message, checkedAt, refresh } = useBackendHealth();
  const [isExpanded, setIsExpanded] = useState(false);

  const label = status === 'checking' ? 'Checking…' : status === 'running' ? 'Running' : 'Unavailable';

  return (
    <div className="server-health">
      <button
        type="button"
        className={`server-health__badge is-${status}`}
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        title={status === 'running' ? 'The Cynth backend is responding.' : (message ?? 'Checking the Cynth backend…')}
      >
        <span className="server-health__dot" aria-hidden="true" />
        <span className="server-health__label">
          <span className="server-health__label-prefix">Backend</span> {label}
        </span>
      </button>

      {isExpanded && (
        <div className="server-health__panel" role="status">
          {status === 'running' && health ? (
            <dl className="server-health__facts">
              <div>
                <dt>Status</dt>
                <dd>Running</dd>
              </div>
              <div>
                <dt>Mode</dt>
                <dd>{health.mode === 'production' ? 'Production — single process' : 'Development — Vite + API'}</dd>
              </div>
              <div>
                <dt>Uptime</dt>
                <dd>{formatUptime(health.uptimeSeconds)}</dd>
              </div>
              <div>
                <dt>Database</dt>
                <dd>{health.database.connected ? 'Connected' : 'Not connected'}</dd>
              </div>
            </dl>
          ) : (
            <>
              <p className="server-health__message">{message ?? 'Checking the Cynth backend…'}</p>
              {status === 'unavailable' && (
                <p className="server-health__hint">
                  Nothing in the browser can start the server. Run it from a terminal, or register the Windows
                  startup task (<code>scripts\install-startup-task.ps1</code>) so it starts on its own.
                </p>
              )}
            </>
          )}

          <div className="server-health__actions">
            <button type="button" className="button" onClick={refresh}>
              Check again
            </button>
            {checkedAt && <span className="server-health__checked">Last checked {checkedAt.toLocaleTimeString()}</span>}
          </div>
        </div>
      )}
    </div>
  );
}
