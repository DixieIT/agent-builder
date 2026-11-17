import { timingSafeEqual } from "node:crypto";
import type { Authenticator, Principal } from "@/core/auth/authenticator.port";

export interface ApiKeyGrant {
  id: string;
  scopes: string[];
}

/**
 * Adapter: static API keys. Accepts `Authorization: Bearer <key>` or `x-api-key: <key>`.
 * An empty key map disables authentication (dev mode): every caller becomes an anonymous principal with scope "*".
 */
export class ApiKeyAuthenticator implements Authenticator {
  constructor(private readonly keys: Map<string, ApiKeyGrant>) {}

  async authenticate(headers: Headers): Promise<Principal | null> {
    if (this.keys.size === 0) return { id: "anonymous", kind: "anonymous", scopes: ["*"] };

    const presented = presentedKey(headers);
    if (!presented) return null;

    let matched: ApiKeyGrant | undefined;
    for (const [key, grant] of this.keys) {
      // Constant-time comparison; every candidate is checked so timing does not reveal which key matched.
      if (safeEqual(key, presented) && !matched) matched = grant;
    }
    return matched ? { id: matched.id, kind: "service", scopes: [...matched.scopes] } : null;
  }
}

function presentedKey(headers: Headers): string | undefined {
  const authorization = headers.get("authorization");
  if (authorization) {
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    if (match) return match[1].trim();
  }
  const apiKey = headers.get("x-api-key")?.trim();
  return apiKey || undefined;
}

function safeEqual(expected: string, actual: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(actual, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
