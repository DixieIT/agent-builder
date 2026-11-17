export class DomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class AgentNotFoundError extends DomainError {
  constructor(readonly id: string) {
    super(`Agent "${id}" does not exist.`);
  }
}

export class AgentConflictError extends DomainError {
  constructor(readonly id: string) {
    super(`An agent with id "${id}" already exists.`);
  }
}

/** The stored document exists but does not match the agent schema. `raw` lets the UI offer a repair. */
export class InvalidAgentDocumentError extends DomainError {
  constructor(
    readonly id: string,
    readonly issues: string[],
    readonly raw?: string,
  ) {
    super(`Agent "${id}" is not a valid agent spec: ${issues.join("; ")}`);
  }
}

export class AgentValidationError extends DomainError {
  constructor(readonly issues: { path: string; message: string; severity: "error" | "warning" }[]) {
    super(`The agent spec is invalid: ${issues.filter((i) => i.severity === "error").map((i) => `${i.path}: ${i.message}`).join("; ")}`);
  }
}

export class RuntimeUnavailableError extends DomainError {}

export class InvalidAgentIdError extends DomainError {
  constructor(readonly id: string) {
    super(`"${id}" is not a valid agent id. Use lowercase letters, digits, "-" and "_".`);
  }
}

/** The caller did not prove who they are (missing or invalid credentials). Maps to 401. */
export class UnauthorizedError extends DomainError {}

/** The caller is known but lacks the scope the operation needs. Maps to 403. */
export class ForbiddenError extends DomainError {}
