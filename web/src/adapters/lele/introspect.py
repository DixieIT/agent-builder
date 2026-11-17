"""Print lele's capabilities as JSON: every mounted plugin and the tools it registers.

Run with lele's own interpreter, e.g. `uv run --project <lele-harness> python introspect.py <cwd> [profile]`.
It boots lele's kernel exactly as `lele --dump-config` does (no frontend runs), reads the tool registry, and shuts
down. A plugin is lele's capability unit: its name is the grant an agent writes in `tools:`.
"""
import inspect
import json
import sys
from pathlib import Path

from lele_harness.kernel import composition, runtime

MARK = "UAB-LELE-CAPABILITIES:"


def first_line(text):
    for line in (text or "").strip().splitlines():
        if line.strip():
            return line.strip()
    return ""


def plugin_doc(name):
    try:
        for plugin in composition.collect([name]):
            module = inspect.getmodule(plugin.apply)
            return first_line(getattr(module, "__doc__", "") or "")
    except Exception:
        return ""
    return ""


def main():
    cwd = Path(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1] else Path.cwd()
    profile = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    ctx = runtime.boot(profile, cwd)
    try:
        plan = runtime.plan()
        mounted = list(plan.plugins) if plan else []
        plugins = {name: {"name": name, "description": "", "tools": []} for name in mounted}
        for entry in ctx.tools.entries.values():
            # Extensions register under "extension:<dir>", but an agent grants them by the bare dir name.
            owner = (entry.get("plugin") or "unknown").removeprefix("extension:")
            plugin = plugins.setdefault(owner, {"name": owner, "description": "", "tools": []})
            plugin["tools"].append({
                "name": entry["name"],
                "description": entry.get("description") or "",
                "parameters": entry.get("parameters") or {},
                "deferred": bool(entry.get("deferred")),
                "group": entry.get("skill") or owner,
                "builtin": bool(entry.get("builtin")),
            })
        for plugin in plugins.values():
            plugin["description"] = plugin_doc(plugin["name"])
        from lele_harness.packages.core.tools import _AGENT_FLOOR

        print(MARK + json.dumps({
            "profile": plan.profile if plan else None,
            "floor": sorted(_AGENT_FLOOR),
            "plugins": [p for p in plugins.values() if p["tools"]],
        }))
    finally:
        runtime.shutdown()


if __name__ == "__main__":
    main()
