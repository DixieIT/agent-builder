import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  ENVIRONMENTS,
  envVarInputSchema,
  maskValue,
  type Environment,
  type EnvVar,
  type EnvVarInput,
} from "@/core/environment/environment";
import type { EnvironmentStore, EnvSourceInfo } from "@/core/environment/environment-store.port";
import { EnvironmentStoreError } from "@/core/shared/errors";
import type { SqliteDb } from "./sqlite-db";

const WRITE_BLOCKED = "Set UAB_SECRET_KEY to store secrets in the built-in store.";
const READ_BLOCKED = "Set UAB_SECRET_KEY to read secrets from the built-in store.";
const UNREADABLE_PREVIEW = "••••••••";
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

interface EnvRow {
  key: string;
  value_enc: string;
  environments: string;
  sensitive: number;
  comment: string | null;
  updated_at: string;
}

const environmentsSchema = z.array(z.enum(ENVIRONMENTS));

/**
 * Built-in environment store: rows of `env_vars`, every value encrypted with AES-256-GCM.
 * The key is sha256(UAB_SECRET_KEY). Without a secret the store is read-only: listings show
 * masked previews, and writes and reads of values throw EnvironmentStoreError.
 */
export class SqliteEnvironmentStore implements EnvironmentStore {
  private readonly key: Buffer | undefined;

  constructor(
    private readonly db: SqliteDb,
    private readonly file: string,
    secret: string | undefined,
  ) {
    this.key = secret ? createHash("sha256").update(secret, "utf8").digest() : undefined;
  }

  describe(): EnvSourceInfo {
    return { kind: "sqlite", label: "Built-in store", location: this.file, writable: this.key !== undefined };
  }

  async list(): Promise<EnvVar[]> {
    const rows = this.db.all<EnvRow>(
      "SELECT key, value_enc, environments, sensitive, comment, updated_at FROM env_vars ORDER BY key",
    );
    return rows.map((row) => this.toEnvVar(row));
  }

  async set(input: EnvVarInput): Promise<EnvVar> {
    const key = this.key;
    if (!key) throw new EnvironmentStoreError(WRITE_BLOCKED);
    const parsed = envVarInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new EnvironmentStoreError(
        parsed.error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`).join("; "),
      );
    }
    const variable = parsed.data;
    const now = new Date().toISOString();
    this.db.run(
      `INSERT INTO env_vars (key, value_enc, environments, sensitive, comment, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_enc = excluded.value_enc, environments = excluded.environments,
         sensitive = excluded.sensitive, comment = excluded.comment, updated_at = excluded.updated_at`,
      variable.key,
      encrypt(key, variable.value),
      JSON.stringify(variable.environments),
      variable.sensitive ? 1 : 0,
      variable.comment ?? null,
      now,
    );
    return {
      key: variable.key,
      environments: variable.environments,
      sensitive: variable.sensitive,
      ...(variable.sensitive ? {} : { value: variable.value }),
      preview: maskValue(variable.value),
      ...(variable.comment !== undefined ? { comment: variable.comment } : {}),
      updatedAt: new Date(now),
    };
  }

  async remove(key: string): Promise<void> {
    const { changes } = this.db.run("DELETE FROM env_vars WHERE key = ?", key);
    if (changes === 0) throw new EnvironmentStoreError(`"${key}" is not set in the built-in store.`);
  }

  async resolve(environment: Environment, keys: string[]): Promise<{ values: Record<string, string>; missing: string[] }> {
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of new Set(keys)) {
      const row = this.db.get<EnvRow>(
        "SELECT key, value_enc, environments, sensitive, comment, updated_at FROM env_vars WHERE key = ?",
        key,
      );
      if (!row || !parseEnvironments(row).includes(environment)) {
        missing.push(key);
        continue;
      }
      const secret = this.key;
      if (!secret) throw new EnvironmentStoreError(READ_BLOCKED);
      values[key] = decrypt(secret, row.value_enc, key);
    }
    return { values, missing };
  }

  /** Listings never fail on a missing secret: values stay hidden and previews are generic. */
  private toEnvVar(row: EnvRow): EnvVar {
    const plain = this.key ? decrypt(this.key, row.value_enc, row.key) : undefined;
    const sensitive = row.sensitive === 1;
    return {
      key: row.key,
      environments: parseEnvironments(row),
      sensitive,
      ...(!sensitive && plain !== undefined ? { value: plain } : {}),
      preview: plain === undefined ? UNREADABLE_PREVIEW : maskValue(plain),
      ...(row.comment !== null ? { comment: row.comment } : {}),
      updatedAt: new Date(row.updated_at),
    };
  }
}

function parseEnvironments(row: EnvRow): Environment[] {
  let raw: unknown;
  try {
    raw = JSON.parse(row.environments);
  } catch {
    throw new EnvironmentStoreError(`Stored environments for "${row.key}" are not valid JSON.`);
  }
  const parsed = environmentsSchema.safeParse(raw);
  if (!parsed.success) throw new EnvironmentStoreError(`Stored environments for "${row.key}" are invalid.`);
  return parsed.data;
}

/** Output format: base64 iv, auth tag and ciphertext joined with ":". */
function encrypt(key: Buffer, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(":");
}

function decrypt(key: Buffer, stored: string, name: string): string {
  const parts = stored.split(":");
  if (parts.length !== 3) throw new EnvironmentStoreError(`The stored value of "${name}" is corrupt.`);
  const [iv, tag, data] = parts.map((part) => Buffer.from(part, "base64"));
  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    throw new EnvironmentStoreError(`Cannot decrypt "${name}". UAB_SECRET_KEY may have changed since the value was stored.`);
  }
}
