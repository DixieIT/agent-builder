import "server-only";

import { z } from "zod";
import type { Principal } from "@/core/auth/authenticator.port";
import { ForbiddenError, UnauthorizedError } from "@/core/shared/errors";
import { authenticator } from "@/server/container";
import { toProblem } from "./problem";

/**
 * Declare an API operation once: the schemas validate requests at runtime AND generate the OpenAPI document.
 *
 *   export const getAgent = defineRoute({
 *     method: "get", path: "/agents/{id}", tags: ["Agents"], summary: "Get an agent",
 *     params: z.object({ id: z.string() }),
 *     responses: { 200: { description: "The agent", schema: agentRecordDto } },
 *     handler: async ({ params }) => json(await service.get(params.id)),
 *   });
 *   // app/api/v1/agents/[id]/route.ts
 *   export const GET = toHandler(getAgent);
 *
 * Paths are relative to /api/v1 and use OpenAPI `{param}` syntax.
 */

type Method = "get" | "post" | "put" | "patch" | "delete";
type AnyObject = z.ZodObject<z.ZodRawShape>;

export interface ResponseSpec {
  description: string;
  schema?: z.ZodType;
  /** e.g. "text/event-stream" or "application/yaml"; default application/json */
  contentType?: string;
}

export interface RouteSpec<P extends AnyObject, Q extends AnyObject, B extends z.ZodType> {
  method: Method;
  path: string;
  operationId: string;
  summary: string;
  description?: string;
  tags: string[];
  params?: P;
  query?: Q;
  body?: B;
  /** Request body content type when not JSON (e.g. application/yaml); the body is then passed as text. */
  bodyContentType?: string;
  responses: Record<number, ResponseSpec>;
  /** Set to require authentication. Every listed scope must be held (a "*" scope holds all). `[]` only requires a valid caller. */
  scopes?: string[];
  handler: (input: {
    params: z.infer<P>;
    query: z.infer<Q>;
    body: z.infer<B>;
    request: Request;
    /** The authenticated caller; present only when the route declares `scopes`. */
    principal?: Principal;
  }) => Promise<Response>;
}

export type AnyRoute = RouteSpec<AnyObject, AnyObject, z.ZodType>;

export function defineRoute<
  P extends AnyObject = z.ZodObject<Record<string, never>>,
  Q extends AnyObject = z.ZodObject<Record<string, never>>,
  B extends z.ZodType = z.ZodUndefined,
>(spec: RouteSpec<P, Q, B>): RouteSpec<P, Q, B> {
  registry.set(`${spec.method} ${spec.path}`, spec as unknown as AnyRoute);
  return spec;
}

/** Every declared route, keyed "method path". Filled as route modules load. */
export const registry = new Map<string, AnyRoute>();

/** Adapts a declared route to a Next.js route handler. */
export function toHandler<P extends AnyObject, Q extends AnyObject, B extends z.ZodType>(spec: RouteSpec<P, Q, B>) {
  return async (request: Request, context: { params: Promise<Record<string, string | string[]>> }): Promise<Response> => {
    try {
      const principal = spec.scopes ? await authorize(request, spec.scopes) : undefined;
      const rawParams = (await context.params) ?? {};
      const params = (spec.params ?? z.object({})).parse(rawParams);
      const url = new URL(request.url);
      const query = (spec.query ?? z.object({})).parse(Object.fromEntries(url.searchParams));
      let body: unknown = undefined;
      if (spec.body) {
        const raw = spec.bodyContentType ? await request.text() : await readJson(request);
        body = spec.body.parse(raw);
      }
      return await spec.handler({ params, query, body, request, principal } as never);
    } catch (error) {
      return toProblem(error, request);
    }
  };
}

async function authorize(request: Request, required: string[]): Promise<Principal> {
  const principal = await authenticator().authenticate(request.headers);
  if (!principal) throw new UnauthorizedError("Send a valid API key in Authorization: Bearer <key>.");
  if (!principal.scopes.includes("*")) {
    const missing = required.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) throw new ForbiddenError(`Missing scope: ${missing.join(", ")}.`);
  }
  return principal;
}

async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new z.ZodError([{ code: "custom", path: [], message: "The request body is not valid JSON.", input: text }]);
  }
}

export function json(data: unknown, init?: number | ResponseInit): Response {
  return Response.json(data, typeof init === "number" ? { status: init } : init);
}
