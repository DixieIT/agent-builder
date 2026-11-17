import { isDeepStrictEqual } from "node:util";
import { type Db, MongoClient } from "mongodb";
import { type AgentId, isAgentId } from "@/core/agents/agent-id";
import type {
  AgentRecord,
  AgentRepository,
  AgentSummary,
  ProvisionableStore,
  StoreCheck,
} from "@/core/agents/agent-repository.port";
import { type AgentSpec, agentSpecSchema } from "@/core/agents/agent-spec";
import {
  AgentConflictError,
  AgentNotFoundError,
  InvalidAgentDocumentError,
} from "@/core/shared/errors";
import {
  AGENT_INDEXES,
  AGENTS_COLLECTION,
  buildAgentValidator,
} from "./mongo-agent-schema";

interface AgentDocument {
  _id: string;
  spec: unknown;
  createdAt: Date;
  updatedAt: Date;
}

const MONGO_DUPLICATE_KEY = 11000;
const MONGO_NAMESPACE_EXISTS = 48;
const MAX_LISTED_BAD_IDS = 5;

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorCode(error: unknown): unknown {
  return isObject(error) ? error.code : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Drops undefined values and anything JSON cannot store, so the spec is safe to persist. */
function plainSpec(spec: AgentSpec): AgentSpec {
  return JSON.parse(JSON.stringify(spec)) as AgentSpec;
}

function issuesOf(error: { issues: { path: PropertyKey[]; message: string }[] }): string[] {
  return error.issues.map((issue) => `${issue.path.map(String).join(".") || "(root)"}: ${issue.message}`);
}

function toRecord(doc: AgentDocument): AgentRecord {
  const id = doc._id as AgentId;
  const parsed = agentSpecSchema.safeParse(doc.spec);
  if (!parsed.success) {
    throw new InvalidAgentDocumentError(
      doc._id,
      issuesOf(parsed.error),
      JSON.stringify(doc.spec, null, 2),
    );
  }
  return { id, spec: parsed.data, createdAt: doc.createdAt, updatedAt: doc.updatedAt };
}

function toSummary(doc: AgentDocument): AgentSummary {
  const raw = isObject(doc.spec) ? doc.spec : {};
  const parsed = agentSpecSchema.safeParse(doc.spec);
  const problems: string[] = [];
  if (!isAgentId(doc._id)) problems.push(`invalid agent id "${doc._id}"`);
  if (!parsed.success) problems.push(...issuesOf(parsed.error));

  const spec = parsed.success ? parsed.data : undefined;
  return {
    id: doc._id as AgentId,
    name: spec?.name ?? (typeof raw.name === "string" ? raw.name : ""),
    description: spec?.description ?? (typeof raw.description === "string" ? raw.description : ""),
    model: spec?.model,
    capabilityCount: spec?.capabilities.length ?? 0,
    updatedAt: doc.updatedAt,
    ...(problems.length > 0 ? { problem: problems.join("; ") } : {}),
  };
}

async function runCheck(
  name: string,
  run: () => Promise<{ ok: boolean; detail: string }>,
): Promise<StoreCheck> {
  try {
    return { name, ...(await run()) };
  } catch (error) {
    return { name, ok: false, detail: errorMessage(error) };
  }
}

export class MongoAgentRepository implements AgentRepository, ProvisionableStore {
  constructor(private readonly db: Db) {}

  private collection() {
    return this.db.collection<AgentDocument>(AGENTS_COLLECTION);
  }

  private async collectionInfo() {
    const [info] = await this.db
      .listCollections({ name: AGENTS_COLLECTION }, { nameOnly: false })
      .toArray();
    return info;
  }

  async list(): Promise<AgentSummary[]> {
    const docs = await this.collection().find({}).sort({ updatedAt: -1 }).toArray();
    return docs.map(toSummary);
  }

  async get(id: AgentId): Promise<AgentRecord> {
    const doc = await this.collection().findOne({ _id: id });
    if (!doc) throw new AgentNotFoundError(id);
    return toRecord(doc);
  }

  async exists(id: AgentId): Promise<boolean> {
    const doc = await this.collection().findOne({ _id: id }, { projection: { _id: 1 } });
    return doc !== null;
  }

  async create(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const now = new Date();
    const value = plainSpec(spec);
    try {
      await this.collection().insertOne({ _id: id, spec: value, createdAt: now, updatedAt: now });
    } catch (error) {
      if (errorCode(error) === MONGO_DUPLICATE_KEY) throw new AgentConflictError(id);
      throw error;
    }
    return { id, spec: value, createdAt: now, updatedAt: now };
  }

  async save(id: AgentId, spec: AgentSpec): Promise<AgentRecord> {
    const now = new Date();
    await this.collection().updateOne(
      { _id: id },
      { $set: { spec: plainSpec(spec), updatedAt: now }, $setOnInsert: { createdAt: now } },
      { upsert: true },
    );
    return this.get(id);
  }

  async remove(id: AgentId): Promise<void> {
    const result = await this.collection().deleteOne({ _id: id });
    if (result.deletedCount === 0) throw new AgentNotFoundError(id);
  }

  async verify(): Promise<StoreCheck[]> {
    const checks: StoreCheck[] = [];

    checks.push(
      await runCheck("connection", async () => {
        await this.db.command({ ping: 1 });
        return { ok: true, detail: `reachable (database "${this.db.databaseName}")` };
      }),
    );

    checks.push(
      await runCheck("collection", async () => {
        const info = await this.collectionInfo();
        return info
          ? { ok: true, detail: `"${AGENTS_COLLECTION}" exists` }
          : { ok: false, detail: `"${AGENTS_COLLECTION}" is missing (run init)` };
      }),
    );

    checks.push(
      await runCheck("validator", async () => {
        const info = await this.collectionInfo();
        if (!info) return { ok: false, detail: "missing: collection does not exist" };
        const options = (info.options ?? {}) as JsonObject;
        if (options.validator === undefined) return { ok: false, detail: "missing (run init)" };
        const level = options.validationLevel;
        const upToDate =
          isDeepStrictEqual(options.validator, buildAgentValidator()) && level === "strict";
        if (!upToDate) {
          return { ok: false, detail: `outdated (validationLevel: ${String(level ?? "default")}; run init)` };
        }
        return { ok: true, detail: "up to date (validationLevel: strict)" };
      }),
    );

    checks.push(
      await runCheck("indexes", async () => {
        const info = await this.collectionInfo();
        if (!info) return { ok: false, detail: "collection is missing" };
        const existing = new Set(
          (await this.collection().listIndexes().toArray()).map((index) => index.name),
        );
        const missing = AGENT_INDEXES.map((index) => index.name).filter((name) => !existing.has(name));
        return missing.length === 0
          ? { ok: true, detail: AGENT_INDEXES.map((index) => index.name).join(", ") }
          : { ok: false, detail: `missing: ${missing.join(", ")} (run init)` };
      }),
    );

    checks.push(
      await runCheck("documents", async () => {
        let total = 0;
        const badIds: string[] = [];
        let badCount = 0;
        const cursor = this.collection().find({}, { projection: { spec: 1 } });
        for await (const doc of cursor) {
          total += 1;
          if (!agentSpecSchema.safeParse(doc.spec).success) {
            badCount += 1;
            if (badIds.length < MAX_LISTED_BAD_IDS) badIds.push(doc._id);
          }
        }
        if (badCount === 0) return { ok: true, detail: `${total} documents valid` };
        const more = badCount > badIds.length ? ", ..." : "";
        return {
          ok: false,
          detail: `${badCount} of ${total} documents invalid: ${badIds.join(", ")}${more}`,
        };
      }),
    );

    return checks;
  }

  async provision(): Promise<StoreCheck[]> {
    const validator = buildAgentValidator();
    const options = {
      validator,
      validationLevel: "strict" as const,
      validationAction: "error" as const,
    };

    if (!(await this.collectionInfo())) {
      try {
        await this.db.createCollection(AGENTS_COLLECTION, options);
      } catch (error) {
        if (errorCode(error) !== MONGO_NAMESPACE_EXISTS) throw error;
        await this.db.command({ collMod: AGENTS_COLLECTION, ...options });
      }
    } else {
      await this.db.command({ collMod: AGENTS_COLLECTION, ...options });
    }

    await this.collection().createIndexes(AGENT_INDEXES);
    return this.verify();
  }
}

/** Connects to MongoDB. The caller owns the client and must close it. */
export async function connectMongo(
  uri: string,
  dbName: string,
): Promise<{ client: MongoClient; db: Db }> {
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  try {
    await client.connect();
  } catch (error) {
    await client.close().catch(() => undefined);
    throw error;
  }
  return { client, db: client.db(dbName) };
}
