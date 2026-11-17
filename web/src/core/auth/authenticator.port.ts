/** Who is calling. `anonymous` is only produced when authentication is disabled. */
export interface Principal {
  id: string;
  kind: "user" | "service" | "anonymous";
  scopes: string[];
}

/**
 * Port: resolve the caller from request headers.
 * Adapters: API keys (`adapters/auth/api-key-authenticator.ts`). Resolves to `null` when the caller is rejected.
 */
export interface Authenticator {
  authenticate(headers: Headers): Promise<Principal | null>;
}
