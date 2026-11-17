/**
 * Port: the secrets an agent run needs (provider API keys such as ANTHROPIC_API_KEY, MCP `env_keys`).
 * Adapters: process environment (`adapters/auth/env-credential-store.ts`), later a secret manager.
 */
export interface CredentialStore {
  /** Looks up each key. `missing` lists the keys without a value; they never throw. */
  resolve(keys: string[]): Promise<{ values: Record<string, string>; missing: string[] }>;
  /** Human-readable description of where the secrets come from, for logs and diagnostics. */
  describe(): string;
}
