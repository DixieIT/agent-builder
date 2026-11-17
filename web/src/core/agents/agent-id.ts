import { InvalidAgentIdError } from "@/core/shared/errors";

const AGENT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export type AgentId = string & { readonly __brand: "AgentId" };

export function parseAgentId(value: string): AgentId {
  if (!AGENT_ID.test(value)) throw new InvalidAgentIdError(value);
  return value as AgentId;
}

export function isAgentId(value: string): value is AgentId {
  return AGENT_ID.test(value);
}

/** Derives a valid id from a human name: "Research Assistant" -> "research-assistant". */
export function slugifyAgentId(name: string): AgentId {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "")
    .slice(0, 64);
  return parseAgentId(slug || "agent");
}
