import { z } from "zod";

/**
 * A project groups what one person works on: its own agents (always stored in the builder's SQLite database,
 * scoped to the project) and the external agent systems it connects to (a lele folder, a LiteLLM gateway...).
 */

export const projectIdSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, "Use lowercase letters, digits, - and _.");

/** One external agent system attached to a project; the container turns it into an AgentSystem adapter. */
export const systemSourceSchema = z.strictObject({
  /** Adapter kind: "lele", "fs", "sqlite", "litellm"... */
  kind: z.string().regex(/^[a-z][a-z0-9-]*$/),
  /** Where it lives: a folder, a database file or a URL. */
  location: z.string().min(1),
  label: z.string().optional(),
});

export const projectInputSchema = z.strictObject({
  name: z.string().trim().min(1, "Give the project a name.").max(80),
  description: z.string().max(500).default(""),
  systems: z.array(systemSourceSchema).default([]),
});

export type SystemSource = z.infer<typeof systemSourceSchema>;
export type ProjectInput = z.infer<typeof projectInputSchema>;

export interface Project extends ProjectInput {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

/** The project every pre-project agent belongs to. */
export const DEFAULT_PROJECT_ID = "default";
