# lele agents

Example lele sub-agents, one folder each (`<name>/AGENTS.md`), in the format `lele agent create` writes.

| Agent | What it does | Grants |
| --- | --- | --- |
| `code-reviewer` | Reports bugs in a diff or files, never edits | read-only |
| `test-writer` | Writes and runs tests next to the code | write-file, edit-file |
| `web-researcher` | Answers with web sources | web-search, web-fetch, read-only |
| `docs-writer` | Writes docs from the code as it is | write-file, edit-file |
| `task-lead` | Splits work across sub-agents and verifies it | subagent, write-file, edit-file |

`bash`, `read-file` and `todo` are always granted by lele.

Import them into the builder (from `web/`):

```sh
bun run agents import ../examples/lele-agents
```

Or copy the folders into a project's `.lele/agents/` (or `~/.lele/agents/`) to use them directly with `lele -a <name>`.
