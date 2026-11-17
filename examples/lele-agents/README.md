# lele agents

Example lele sub-agents, one folder each (`<name>/AGENTS.md`), in the format `lele agent create` writes.

| Agent | What it does | Capabilities |
| --- | --- | --- |
| `code-reviewer` | Reports bugs in a diff or files, never edits | none (bash, read-file, todo only) |
| `test-writer` | Writes and runs tests next to the code | core.tools, core.edit |
| `web-researcher` | Answers with web sources, reads PDFs | core.web.tool, core.pdf |
| `docs-writer` | Writes docs from the code as it is | core.tools, core.edit |
| `task-lead` | Splits work across sub-agents and verifies it | core.subagents.tools, core.tools, core.edit |

Each capability is a lele plugin and grants all of its tools. `bash`, `read-file` and `todo` are always granted by lele.

Import them into the builder (from `web/`):

```sh
bun run agents import ../examples/lele-agents
```

Or copy the folders into a project's `.lele/agents/` (or `~/.lele/agents/`) to use them directly with `lele -a <name>`.
