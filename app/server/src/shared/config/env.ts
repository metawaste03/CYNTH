/**
 * Local environment configuration. No secrets, no API keys —
 * out of scope for Milestone 1 (see docs/03_SYSTEM_ARCHITECTURE.md).
 */
export const env = {
  port: Number(process.env.PORT ?? 4000),
};
