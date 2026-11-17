import "server-only";

import { z } from "zod";
import { problemSchema } from "./problem";
import type { AnyRoute } from "./route";

/** Builds an OpenAPI 3.1 document from declared routes. Schemas with `.meta({ id })` become shared components. */
export function buildOpenApi(routes: AnyRoute[], info: { title: string; version: string; description?: string }) {
  const components: Record<string, unknown> = {};
  const toSchema = (schema: z.ZodType, io: "input" | "output") => {
    const generated = z.toJSONSchema(schema, {
      io,
      target: "draft-2020-12",
      unrepresentable: "any",
      reused: "ref",
    }) as Record<string, unknown>;
    // zod emits local "#/$defs/X" refs; OpenAPI shares them under components.schemas.
    const rewired = JSON.parse(JSON.stringify(generated).replaceAll('"#/$defs/', '"#/components/schemas/')) as Record<string, unknown>;
    const { $schema: _ignored, $defs, ...rest } = rewired as { $schema?: string; $defs?: Record<string, unknown> };
    for (const [id, definition] of Object.entries($defs ?? {})) components[id] = definition;
    const id = z.globalRegistry.get(schema)?.id;
    if (typeof id === "string") {
      components[id] = rest;
      return { $ref: `#/components/schemas/${id}` };
    }
    return rest;
  };

  const paths: Record<string, Record<string, unknown>> = {};
  const problem = { "application/problem+json": { schema: toSchema(problemSchema, "output") } };

  for (const route of [...routes].sort((a, b) => a.path.localeCompare(b.path))) {
    const parameters = [
      ...objectParameters(route.params, "path", toSchema),
      ...objectParameters(route.query, "query", toSchema),
    ];
    const responses: Record<string, unknown> = {};
    for (const [status, response] of Object.entries(route.responses)) {
      responses[status] = {
        description: response.description,
        ...(response.schema || response.contentType
          ? {
              content: {
                [response.contentType ?? "application/json"]: response.schema
                  ? { schema: toSchema(response.schema, "output") }
                  : {},
              },
            }
          : {}),
      };
    }
    responses["4XX"] ??= { description: "Client error", content: problem };
    responses["5XX"] ??= { description: "Server error", content: problem };

    (paths[`/api/v1${route.path}`] ??= {})[route.method] = {
      operationId: route.operationId,
      summary: route.summary,
      description: route.description,
      tags: route.tags,
      parameters: parameters.length ? parameters : undefined,
      requestBody: route.body
        ? {
            required: !route.body.safeParse(undefined).success,
            content: { [route.bodyContentType ?? "application/json"]: { schema: toSchema(route.body, "input") } },
          }
        : undefined,
      responses,
      security: route.scopes ? [{ bearer: [] }, { apiKey: [] }] : undefined,
    };
  }

  return {
    openapi: "3.1.0",
    info,
    servers: [{ url: "/" }],
    tags: [...new Set(routes.flatMap((r) => r.tags))].map((name) => ({ name })),
    paths,
    components: {
      schemas: components,
      securitySchemes: {
        bearer: { type: "http", scheme: "bearer" },
        apiKey: { type: "apiKey", in: "header", name: "x-api-key" },
      },
    },
  };
}

function objectParameters(
  schema: z.ZodObject<z.ZodRawShape> | undefined,
  location: "path" | "query",
  toSchema: (schema: z.ZodType, io: "input" | "output") => unknown,
) {
  if (!schema) return [];
  return Object.entries(schema.shape).map(([name, field]) => {
    const fieldSchema = field as z.ZodType;
    return {
      name,
      in: location,
      required: location === "path" || !fieldSchema.safeParse(undefined).success,
      description: fieldSchema.description,
      schema: toSchema(fieldSchema, "input"),
    };
  });
}
