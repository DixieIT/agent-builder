import "server-only";

import { z } from "zod";
import {
  AgentConflictError,
  AgentNotFoundError,
  AgentValidationError,
  InvalidAgentDocumentError,
  InvalidAgentIdError,
  ForbiddenError,
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
  if (error instanceof AgentValidationError) return problem(422, "Invalid agent spec", error.message, error.issues);
  if (error instanceof InvalidAgentIdError) return problem(400, "Invalid agent id", error.message);
  if (error instanceof AgentNotFoundError) return problem(404, "Agent not found", error.message);
  if (error instanceof AgentConflictError) return problem(409, "Agent already exists", error.message);
  if (error instanceof InvalidAgentDocumentError) {
    return problem(500, "Stored agent is invalid", error.message, error.issues.map((m) => ({ path: "", message: m })));
  }
  if (error instanceof RuntimeUnavailableError) return problem(503, "Runtime unavailable", error.message);
  if (error instanceof UnauthorizedError) {
    return problem(401, "Unauthorized", error.message, undefined, { "WWW-Authenticate": "Bearer" });
  }
  if (error instanceof ForbiddenError) return problem(403, "Forbidden", error.message);

  console.error(error);
  return problem(500, "Internal error", error instanceof Error ? error.message : String(error));
}
