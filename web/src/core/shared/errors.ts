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

export class LibraryItemNotFoundError extends DomainError {
  constructor(
    readonly kind: "tool" | "skill" | "capability",
    readonly name: string,
  ) {
    super(`${kind} "${name}" does not exist in the library.`);
  }
}

/** A library item fails its schema, on save or when read back from the store. */
export class InvalidLibraryItemError extends DomainError {
  constructor(
    readonly kind: "tool" | "skill" | "capability",
    readonly name: string,
    readonly issues: string[],
  ) {
    super(`Library ${kind} "${name}" is not valid: ${issues.join("; ")}`);
  }
}

/** The environment store refused the operation, e.g. writing without UAB_SECRET_KEY or a value that cannot be decrypted. */
export class EnvironmentStoreError extends DomainError {}

/** The agent is defined in a layer this store cannot write (lele: bundled or global agents). */
export class ReadOnlyAgentError extends DomainError {
  constructor(
    readonly id: string,
    readonly location: string,
  ) {
    super(`Agent "${id}" is defined in the ${location} layer and is read-only here.`);
  }
}

/** No agent system is configured under this id (see AGENT_SYSTEMS). Maps to 404. */
export class AgentSystemNotFoundError extends DomainError {
  constructor(readonly id: string) {
    super(`Agent system "${id}" is not configured. Check AGENT_SYSTEMS.`);
  }
}

export class ProjectNotFoundError extends DomainError {
  constructor(readonly id: string) {
    super(`Project "${id}" does not exist.`);
  }
}

export class ProjectConflictError extends DomainError {
  constructor(readonly id: string) {
    super(`A project with id "${id}" already exists.`);
  }
}

/** The project cannot be removed (the default project holds every pre-project agent). Maps to 409. */
export class ProjectProtectedError extends DomainError {
  constructor(readonly id: string) {
    super(`Project "${id}" is protected and cannot be removed.`);
  }
}
