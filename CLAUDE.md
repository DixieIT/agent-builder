# Ultimate Agent Builder: project laws

These are binding. `bun test` in `web/` enforces the checkable ones (`web/src/architecture.test.ts`).

## Tooling
- **Bun only.** `bun install`, `bun add`, `bun run`, `bunx`, `bun test`. Never npm, yarn or pnpm, and no lockfiles other than `bun.lock`.
- Frontend: Next.js (App Router) + shadcn/ui (base-ui flavour: `render` prop, not `asChild`) + Tailwind v4, themed with the **Bubble** design system (`web/src/app/globals.css`).

## Architecture: ports and adapters
- `src/core/**` is the domain: specs, services and **ports** (`*.port.ts`). It imports nothing from `src/adapters`, `src/server`, `src/app`, `src/components`, Next.js, React, or any driver (mongodb, MCP SDK, child_process, fs).
- `src/adapters/**` implements ports, one adapter per technology (fs, mongo, mcp, goose, docker, auth...). Adapters import `src/core` only, never each other, `src/app` or `src/server`.
- `src/server/container.ts` is the **only** place that picks adapters (env-driven). Everything else asks the container for ports.
- `src/app/**`, the REST API and the CLI call **application services / ports**, never adapter classes directly.
- Adding a backend (another database, harness, auth provider) = one new adapter + one line in the container.

## Agents
- The canonical agent model is the **Pydantic AI AgentSpec** (`src/core/agents/agent-spec.ts`). Builder-only additions are namespaced: `MCPStdio`, `GooseExtension` capabilities and the `x-goose` block.
- **Goose** is the runtime: specs export to Goose recipes (`adapters/goose`), run with the Goose CLI and package into a Docker image.
- No mocks or fake data in the product: tool lists come from real MCP servers; if something can't be inspected, say so in the UI.

## Tests
- Tests live **next to the code they test**: `src/adapters/sqlite/sqlite.test.ts`, `src/core/agents/agent-spec.test.ts`. No top-level `test/` folder. Project-wide rules live in `src/architecture.test.ts`.
- Every adapter ships with its test. Run everything with `bun test`, one feature with `bun test src/adapters/<name>`.

## API
- Every endpoint is declared with `defineRoute` (`src/server/http/route.ts`) under `/api/v1`. Zod schemas validate requests **and** generate the OpenAPI doc (`/api/v1/openapi.json`, Swagger UI at `/api/docs`). Never hand-write OpenAPI.
- Errors are RFC 9457 problem+json, mapped from domain errors in one place (`src/server/http/problem.ts`).
- Streaming (runs, builds, live events) uses SSE (`src/server/sse.ts`).

## UI
- Every route has a skeleton `loading.tsx`. The global top progress bar tracks navigation, server actions and `/api` calls; opt out per request with `skipLoaderHeaders()`.
- Live updates arrive over SSE (`/api/v1/events`).

## Git
- Repo root is `d:\Progetti\ultimate-agent-builder`; the frontend and API live in `web/`, agent specs in `agents/`.
