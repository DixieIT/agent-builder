import "server-only";

import { z } from "zod";
import {
  AgentConflictError,
  AgentNotFoundError,
  AgentSystemNotFoundError,
  AgentValidationError,
  InvalidAgentDocumentError,
  InvalidAgentIdError,
  ForbiddenError,
  EnvironmentStoreError,
  InvalidLibraryItemError,
  LibraryItemNotFoundError,
  ProjectConflictError,
  ProjectNotFoundError,
  ProjectProtectedError,
  ReadOnlyAgentError,
  RuntimeUnavailableError,
  UnauthorizedError,
} from "@/core/shared/errors";

/** RFC 9457 problem details. Maps domain errors to HTTP status codes in one place. */
export const problemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string().optional(),
    issues: z
      .array(z.object({ path: z.string(), message: z.string(), severity: z.enum(["error", "warning"]).optional() }))
      .optional(),
  })
  .meta({ id: "Problem" });

export function toProblem(error: unknown, request: Request): Response {
  const instance = new URL(request.url).pathname;
  const problem = (
    status: number,
    title: string,
    detail: string,
    issues?: z.infer<typeof problemSchema>["issues"],
    extraHeaders?: Record<string, string>,
  ) =>
    Response.json(
      { type: `https://httpstatuses.io/${status}`, title, status, detail, instance, issues },
      { status, headers: { "Content-Type": "application/problem+json", ...extraHeaders } },
    );

  if (error instanceof z.ZodError) {
    return problem(
      400,
      "Invalid request",
      "The request does not match the API schema.",
      error.issues.map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })),
    );
  }
  if (is(error, AgentValidationError)) return problem(422, "Invalid agent spec", error.message, error.issues);
  if (is(error, InvalidAgentIdError)) return problem(400, "Invalid agent id", error.message);
  if (is(error, AgentNotFoundError)) return problem(404, "Agent not found", error.message);
  if (is(error, AgentSystemNotFoundError)) return problem(404, "Agent system not found", error.message);
  if (is(error, AgentConflictError)) return problem(409, "Agent already exists", error.message);
  if (is(error, InvalidAgentDocumentError)) {
    return problem(500, "Stored agent is invalid", error.message, error.issues.map((m) => ({ path: "", message: m })));
  }
  if (is(error, RuntimeUnavailableError)) return problem(503, "Runtime unavailable", error.message);
  if (is(error, UnauthorizedError)) {
    return problem(401, "Unauthorized", error.message, undefined, { "WWW-Authenticate": "Bearer" });
  }
  if (is(error, ForbiddenError)) return problem(403, "Forbidden", error.message);
  if (is(error, LibraryItemNotFoundError)) return problem(404, "Library item not found", error.message);
  if (is(error, InvalidLibraryItemError)) {
    return problem(422, "Invalid library item", error.message, error.issues.map((m) => ({ path: "", message: m })));
  }
  if (is(error, EnvironmentStoreError)) return problem(409, "Environment store refused the operation", error.message);
  if (is(error, ReadOnlyAgentError)) return problem(409, "Agent is read-only", error.message);
  if (is(error, ProjectNotFoundError)) return problem(404, "Project not found", error.message);
  if (is(error, ProjectConflictError)) return problem(409, "Project already exists", error.message);
  if (is(error, ProjectProtectedError)) return problem(409, "Project is protected", error.message);

  console.error(error);
  return problem(500, "Internal error", error instanceof Error ? error.message : String(error));
}

/**
 * `instanceof` by class name: in Next.js dev a module can be instantiated twice (lazy imports), so an error thrown
 * by an adapter may come from a different copy of its class. DomainError sets `name` to the concrete class name.
 */
function is<T extends abstract new (...args: never[]) => Error>(error: unknown, type: T): error is InstanceType<T> {
  return error instanceof type || (error instanceof Error && error.name === type.name);
}
