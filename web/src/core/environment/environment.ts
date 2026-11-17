import { z } from "zod";

/**
 * Environment variables, managed like Vercel: each variable has a key, a value and the environments it applies to.
 * The values live in a pluggable source (a folder of .env files, the built-in encrypted store, ...).
 */

export const ENVIRONMENTS = ["development", "preview", "production"] as const;
export type Environment = (typeof ENVIRONMENTS)[number];

export const envKeySchema = z.string().regex(/^[A-Z_][A-Z0-9_]*$/, "Use UPPER_SNAKE_CASE, e.g. ANTHROPIC_API_KEY.");

export const envVarInputSchema = z.strictObject({
  key: envKeySchema,
  value: z.string(),
  environments: z.array(z.enum(ENVIRONMENTS)).min(1, "Pick at least one environment."),
  /** Sensitive values are write-only: listings return them masked. */
  sensitive: z.boolean().default(true),
  comment: z.string().optional(),
});
export type EnvVarInput = z.infer<typeof envVarInputSchema>;

/** What listings return: the value is masked when sensitive. */
export interface EnvVar {
  key: string;
  environments: Environment[];
  sensitive: boolean;
  /** Plain value for non-sensitive variables; undefined for sensitive ones. */
  value?: string;
  /** e.g. "sk-…a1b2" so people can tell values apart without reading them. */
  preview: string;
  comment?: string;
  updatedAt: Date;
}

export function maskValue(value: string): string {
  if (value.length <= 8) return "•".repeat(Math.max(value.length, 4));
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}
