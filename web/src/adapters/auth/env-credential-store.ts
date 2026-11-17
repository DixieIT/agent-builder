import type { CredentialStore } from "@/core/auth/credential-store.port";

/** Adapter: secrets from environment variables. Empty strings count as missing. */
export class EnvCredentialStore implements CredentialStore {
  constructor(private readonly env: Record<string, string | undefined> = process.env) {}

  async resolve(keys: string[]): Promise<{ values: Record<string, string>; missing: string[] }> {
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const value = this.env[key];
      if (value) values[key] = value;
      else missing.push(key);
    }
    return { values, missing };
  }

  describe(): string {
    return "process environment";
  }
}
