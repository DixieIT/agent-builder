import { z } from "zod";
import { agentSpecSchema } from "@/core/agents/agent-spec";

/**
 * MongoDB storage contract for agents: collection name, the $jsonSchema validator,
 * and the indexes. Plain module (no "server-only") so the Bun CLI can import it.
 */

export const AGENTS_COLLECTION = "agents";

const AGENT_ID_PATTERN = "^[a-z0-9][a-z0-9_-]{0,63}$";

/** JSON Schema keywords that MongoDB $jsonSchema accepts. Anything else is dropped. */
const MONGO_KEYWORDS = new Set([
  "bsonType",
  "additionalProperties",
  "pattern",
  "enum",
  "required",
  "properties",
  "items",
  "anyOf",
  "oneOf",
  "allOf",
  "not",
  "minimum",
  "maximum",
  "minLength",
  "maxLength",
  "description",
]);

/** Keywords that hold a single subschema or a map of subschemas. */
const SUBSCHEMA_MAP_KEYWORDS = new Set(["properties", "patternProperties"]);
const SUBSCHEMA_LIST_KEYWORDS = new Set(["anyOf", "oneOf", "allOf"]);

/** JSON Schema type name -> BSON type names. */
const BSON_TYPES: Record<string, string[]> = {
  integer: ["int", "long"],
  number: ["int", "long", "double", "decimal"],
  boolean: ["bool"],
};

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toBsonTypes(type: unknown): string | string[] | undefined {
  const names = Array.isArray(type) ? type : [type];
  const bson: string[] = [];
  for (const name of names) {
    if (typeof name !== "string") continue;
    for (const mapped of BSON_TYPES[name] ?? [name]) {
      if (!bson.includes(mapped)) bson.push(mapped);
    }
  }
  if (bson.length === 0) return undefined;
  return bson.length === 1 ? bson[0] : bson;
}

/**
 * Rewrites a JSON Schema node into the dialect MongoDB $jsonSchema accepts.
 * Subschemas are recursed into; keys inside `properties` are property names, never keywords.
 */
function toMongoSchema(node: unknown): unknown {
  if (typeof node === "boolean") return node;
  if (!isObject(node)) return node;

  const out: JsonObject = {};
  for (const [key, value] of Object.entries(node)) {
    if (value === undefined || !MONGO_KEYWORDS.has(key)) continue;
    if (SUBSCHEMA_MAP_KEYWORDS.has(key) && isObject(value)) {
      out[key] = Object.fromEntries(Object.entries(value).map(([name, sub]) => [name, toMongoSchema(sub)]));
    } else if (SUBSCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value)) {
      out[key] = value.map(toMongoSchema);
    } else if (key === "items") {
      out[key] = Array.isArray(value) ? value.map(toMongoSchema) : toMongoSchema(value);
    } else if (key === "additionalProperties" || key === "not") {
      out[key] = toMongoSchema(value);
    } else {
      out[key] = value;
    }
  }

  if ("const" in node && node.const !== undefined && out.enum === undefined) {
    out.enum = [node.const];
  }
  if ("type" in node) {
    const bsonType = toBsonTypes(node.type);
    if (bsonType !== undefined) out.bsonType = bsonType;
  }

  // MongoDB rejects empty enum / required / anyOf-style arrays.
  for (const key of ["enum", "required", "anyOf", "oneOf", "allOf"]) {
    if (Array.isArray(out[key]) && out[key].length === 0) delete out[key];
  }
  return out;
}

/** The MongoDB validator for the agents collection. Plain JSON, safe to compare with stored options. */
export function buildAgentValidator(): { $jsonSchema: JsonObject } {
  const specSchema = toMongoSchema(
    z.toJSONSchema(agentSpecSchema, { io: "input", unrepresentable: "any" }),
  );
  const validator = {
    $jsonSchema: {
      bsonType: "object",
      required: ["_id", "spec", "createdAt", "updatedAt"],
      properties: {
        _id: { bsonType: "string", pattern: AGENT_ID_PATTERN },
        spec: specSchema,
        createdAt: { bsonType: "date" },
        updatedAt: { bsonType: "date" },
      },
    },
  };
  // JSON round trip drops undefined values and yields the exact shape the server stores.
  return JSON.parse(JSON.stringify(validator)) as { $jsonSchema: JsonObject };
}

export const AGENT_INDEXES: { key: Record<string, 1 | -1>; name: string }[] = [
  { key: { "spec.name": 1 }, name: "spec_name" },
  { key: { updatedAt: -1 }, name: "updated_at_desc" },
];
