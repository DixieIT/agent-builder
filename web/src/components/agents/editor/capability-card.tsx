"use client";

import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { ToolInspector } from "@/components/agents/tool-inspector";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CAPABILITY_CATALOG, type Capability, type GooseExtensionArgs, type McpArgs, type McpStdioArgs } from "@/core/agents/agent-spec";
import { CodecTextarea, Field, Hint, IconButton, NumberField, TextField, keyValueCodec, linesCodec, listCodec } from "./fields";

type Props = {
  index: number;
  count: number;
  capability: Capability;
  onChange: (capability: Capability) => void;
  onRemove: () => void;
  onMove: (delta: -1 | 1) => void;
};

export function CapabilityCard({ index, count, capability, onChange, onRemove, onMove }: Props) {
  const meta = CAPABILITY_CATALOG.find((c) => c.kind === capability.kind);
  const id = `cap-${index}`;
  const name = capability.kind === "GooseExtension" ? capability.args.name : capability.args.id;

  return (
    <section aria-labelledby={`${id}-title`} className="rounded-2xl border bg-background/50">
      <header className="flex items-center gap-2 border-b px-4 py-2.5">
        <Badge className="rounded-full font-mono">{capability.kind}</Badge>
        <h3 id={`${id}-title`} className="min-w-0 truncate text-sm font-semibold">
          {name}
        </h3>
        {meta ? <Hint>{meta.summary}</Hint> : null}
        <div className="ml-auto flex items-center">
          <IconButton label="Move up" disabled={index === 0} onClick={() => onMove(-1)}>
            <ArrowUp />
          </IconButton>
          <IconButton label="Move down" disabled={index === count - 1} onClick={() => onMove(1)}>
            <ArrowDown />
          </IconButton>
          <IconButton label="Remove" onClick={onRemove}>
            <Trash2 />
          </IconButton>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {capability.kind === "MCPStdio" ? (
          <StdioForm id={id} args={capability.args} onChange={(args) => onChange({ kind: "MCPStdio", args })} />
        ) : capability.kind === "MCP" ? (
          <HttpForm id={id} args={capability.args} onChange={(args) => onChange({ kind: "MCP", args })} />
        ) : (
          <GooseForm id={id} args={capability.args} onChange={(args) => onChange({ kind: "GooseExtension", args })} />
        )}
      </div>
    </section>
  );
}

function StdioForm({ id, args, onChange }: { id: string; args: McpStdioArgs; onChange: (a: McpStdioArgs) => void }) {
  const set = <K extends keyof McpStdioArgs>(key: K, value: McpStdioArgs[K]) => onChange(prune({ ...args, [key]: value }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <TextField id={`${id}-id`} label="Name" value={args.id} onChange={(v) => set("id", v ?? "")} mono />
        <TextField id={`${id}-command`} label="Command" value={args.command} onChange={(v) => set("command", v ?? "")} mono placeholder="npx" />
      </div>
      <TextField id={`${id}-description`} label="Description" value={args.description} onChange={(v) => set("description", v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <CodecTextarea id={`${id}-args`} label="Arguments" hint="One per line." value={args.args} {...linesCodec} onChange={(v) => set("args", v)} />
        <CodecTextarea id={`${id}-env`} label="Environment" hint="KEY=value per line." value={args.env} {...keyValueCodec} onChange={(v) => set("env", v)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <CodecTextarea id={`${id}-env-keys`} label="Secrets" hint="env_keys: read from the environment at run time." rows={1} value={args.env_keys} {...listCodec} onChange={(v) => set("env_keys", v)} />
        <TextField id={`${id}-cwd`} label="Working directory" value={args.cwd} onChange={(v) => set("cwd", v)} mono />
        <NumberField id={`${id}-timeout`} label="Timeout (s)" value={args.timeout} min={1} onChange={(v) => set("timeout", v)} placeholder="300" />
      </div>
      <ToolInspector server={{ kind: "MCPStdio", args }} allowedTools={args.allowed_tools} onAllowedToolsChange={(tools) => set("allowed_tools", tools)} />
    </>
  );
}

function HttpForm({ id, args, onChange }: { id: string; args: McpArgs; onChange: (a: McpArgs) => void }) {
  const set = <K extends keyof McpArgs>(key: K, value: McpArgs[K]) => onChange(prune({ ...args, [key]: value }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <TextField id={`${id}-id`} label="Name" value={args.id} onChange={(v) => set("id", v ?? "")} mono />
        <TextField id={`${id}-url`} label="URL" value={args.url} onChange={(v) => set("url", v ?? "")} mono type="url" />
      </div>
      <TextField id={`${id}-description`} label="Description" value={args.description} onChange={(v) => set("description", v)} />
      <div className="grid gap-4 sm:grid-cols-2">
        <CodecTextarea id={`${id}-headers`} label="Headers" hint="Name: value per line." value={args.headers} {...keyValueCodec} onChange={(v) => set("headers", v)} />
        <CodecTextarea id={`${id}-env`} label="Environment" hint="KEY=value per line." value={args.env} {...keyValueCodec} onChange={(v) => set("env", v)} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CodecTextarea id={`${id}-env-keys`} label="Secrets" hint="env_keys: read from the environment at run time." rows={1} value={args.env_keys} {...listCodec} onChange={(v) => set("env_keys", v)} />
        <NumberField id={`${id}-timeout`} label="Timeout (s)" value={args.timeout} min={1} onChange={(v) => set("timeout", v)} placeholder="300" />
      </div>
      <ToolInspector server={{ kind: "MCP", args }} allowedTools={args.allowed_tools} onAllowedToolsChange={(tools) => set("allowed_tools", tools)} />
    </>
  );
}

function GooseForm({ id, args, onChange }: { id: string; args: GooseExtensionArgs; onChange: (a: GooseExtensionArgs) => void }) {
  const set = <K extends keyof GooseExtensionArgs>(key: K, value: GooseExtensionArgs[K]) => onChange(prune({ ...args, [key]: value }));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id={`${id}-type`} label="Type">
          <Select value={args.type} onValueChange={(v) => set("type", (v ?? "builtin") as GooseExtensionArgs["type"])}>
            <SelectTrigger id={`${id}-type`} className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="builtin">builtin</SelectItem>
              <SelectItem value="platform">platform</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <TextField id={`${id}-name`} label="Name" value={args.name} onChange={(v) => set("name", v ?? "")} mono placeholder="developer" />
        {args.type === "builtin" ? <NumberField id={`${id}-timeout`} label="Timeout (s)" value={args.timeout} min={1} onChange={(v) => set("timeout", v)} /> : null}
      </div>
      <TextField id={`${id}-description`} label="Description" value={args.description} onChange={(v) => set("description", v)} />
      <CodecTextarea
        id={`${id}-tools`}
        label="Allowed tools"
        rows={1}
        hint="Goose extensions run inside Goose, so their tools can't be listed from here. Name the ones to allow, or leave empty for all."
        value={args.allowed_tools}
        {...listCodec}
        onChange={(v) => set("allowed_tools", v)}
      />
    </>
  );
}

function prune<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)) as T;
}
