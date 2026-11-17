---
name: agent-builder
description: Load to inspect, import or build agents with Ultimate Agent Builder (UAB), or to add an adapter for a new agent system.
---

# Agent builder (Ultimate Agent Builder)

UAB is a Next.js app and CLI in `web/` that stores agent specs (Pydantic AI AgentSpec, run on Goose or lele), exports them to each harness, and explores any agentic system through the `AgentSystem` port. Its rules are in `CLAUDE.md` at the repo root; read it before changing code.

## Run it

- UI: `cd web && bun run dev` (Next.js dev server, port 3000 by default). Projects are in the left sidebar (`/projects/<id>`: agents, attached systems, multi-agent graph, folder import); systems are at `/systems`, the builder's editable agents at `/agents`.
- CLI: from `web/`, `bun run agents <command>`. Run `bun run agents help` for the full list.
- REST API: under `/api/v1` (for example `GET /api/v1/systems`). Swagger UI is at `/api/docs`, the OpenAPI document at `/api/v1/openapi.json`.

## Configuration

Saved settings live in the builder's store. `bun run agents config set <KEY> <value>` saves one; `config get`, `config list` and `config unset` read and remove them. Keys are UPPER_SNAKE_CASE. Saved settings are loaded into the environment at start, and variables set in the shell win over them.

Secrets are refused: a key matching KEY, SECRET, TOKEN or PASSWORD is rejected. Put those under **Environment** (`ENV_SOURCE`) instead, in `env/.env.<environment>` (folder, the default) or the SQLite store.

Useful keys:
- `AGENT_SYSTEMS`: systems to explore, comma-separated (default `builder`).
- `AGENT_STORE`: where the builder's own agents live: `fs` (default), `sqlite`, `mongo` or `lele`.
- `UAB_PROJECT`: the current project id (set with `projects use`).
- `LELE_PROJECT_DIR`, `LELE_HARNESS_DIR`: the lele project folder and the lele-harness checkout.
- `ENV_SOURCE` (`folder` or `sqlite`) and `ENV_DIR` (default `env/`).
- `UAB_DB`: the SQLite file (default `data/uab.sqlite`).

## Projects

A project groups agents (kept in the builder's SQLite database) and the systems it connects to.

- `bun run agents projects list`
- `bun run agents projects create "<name>" [--description "<text>"]`
- `bun run agents projects use <id>`: sets `UAB_PROJECT`.
- `bun run agents projects show [id]`: systems and agent count (default: the current project).

## Importing

`bun run agents import <path> [--dry-run] [--project <id>]`

The path can be one item (`tools/<name>`, `skills/<name>`, `capabilities/<name>.yaml`, `agents/<id>`), a folder of items (an `agents/` folder, a lele `.lele/agents` folder, a folder of Goose recipes), or a whole bundle. Each line of the report is one item. `--dry-run` validates and saves nothing. Without `--project` the items go to the builder's store; with it they go to that project's store.

Bundle layout: `agents/<id>/agent.yaml`, `capabilities/<name>.yaml`, `tools/<name>/tool.yaml` with its code, `skills/<name>/SKILL.md` with its files.

`bun run agents dump <dir>` writes the agents and library items as a bundle. `bun run agents library [tools|skills|capabilities]` lists the library.

## Exploring systems

- `bun run agents systems`: the systems in `AGENT_SYSTEMS`, with their ids.
- `bun run agents inspect <system>`: the agents in a system, with capability and sub-agent counts.
- `bun run agents inspect <system> <agent>`: one agent's model, facts, capabilities with each tool's access, and sub-agents.

`AGENT_SYSTEMS` kinds:
- `builder`: the builder's own store (`AGENT_STORE`), editable.
- `lele:<projectDir>`: a lele project's agents (`.lele/agents` plus the global and bundled layers).
- `fs:<dir>`: a folder of builder agent specs (read-only).
- `sqlite:<file>`: a builder SQLite store (read-only).
- `litellm:<url>`: agents and MCP servers defined on a LiteLLM gateway (`/v1/agents`, `/v1/mcp/server`, `/mcp-rest/tools/list`). Each MCP server is a capability with its tools; A2A card skills are the agent's skills; `object_permission.agents` are its sub-agents. Put the key under Environment as `LITELLM_API_KEY` (or in the shell env); a master key sees everything, a virtual key only what it can reach.

Example: `AGENT_SYSTEMS=builder,lele:/path/to/project,litellm:http://localhost:4000`. A project can attach the same kinds from its Systems tab.

## Running agents

`bun run agents list`, `run <agentId> [--param k=v] [--prompt "text"] [--env development|preview|production]`, `chat <agentId>`. `run --yaml` prints the harness definition without running.

## Adding an agent system

Use this for another platform's agents (a database, a folder format).

1. Write `web/src/adapters/systems/<name>-agent-system.ts` implementing the `AgentSystem` port (`web/src/core/systems/agent-system.port.ts`). Alternatively, wrap the platform's `AgentRepository` in `RepositoryAgentSystem`.
2. Add a colocated test, `<name>-agent-system.test.ts`, that calls `agentSystemContract(...)` from `web/src/core/systems/agent-system.contract.ts`. The factory must return a system with at least one agent.
3. Add one case in `systemFromSource()` in `web/src/server/container.ts`, and extend the kind list in `web/cli/agents.ts` help and the project Systems form.
4. Configure it with `AGENT_SYSTEMS`, or attach it to a project's systems.

Run the tests with `bun test src/adapters/systems` (from `web/`).

## Rules (see CLAUDE.md)

- `src/core` holds the domain and ports (`*.port.ts`) and imports no adapter, framework or driver.
- `src/adapters` implements one port per technology and imports only `src/core`.
- `src/server/container.ts` is the only place that picks adapters.
- The app, the API and the CLI use ports and services, never adapter classes.
- Every adapter ships with its test, next to the code. Run everything with `bun test` in `web/`.
- Bun only: `bun install`, `bun add`, `bun run`, `bunx`, `bun test`.
