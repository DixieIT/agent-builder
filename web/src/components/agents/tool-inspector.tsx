"use client"

import { toast } from "sonner"

import { useId, useState, useTransition } from "react"
import { ChevronDown, Loader2, ScanSearch } from "lucide-react"
import { inspectMcpServerAction } from "@/app/agents/actions"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import type { McpServerArgs } from "@/core/agents/agent-spec"
import type {
  InspectionResult,
  JsonSchemaObject,
  JsonSchemaProperty,
  ToolDescriptor,
} from "@/core/tools/tool-inspector.port"
import { cn } from "@/lib/utils"

type OkResult = Extract<InspectionResult, { status: "ok" }>

const LONG_INSTRUCTIONS = 160

export function ToolInspector({
  server,
  allowedTools,
  onAllowedToolsChange,
  readOnly = false,
}: {
  server: McpServerArgs
  /** allowed tool names; undefined = all tools allowed */
  allowedTools: string[] | undefined
  onAllowedToolsChange?: (tools: string[] | undefined) => void
  /** Lists the server's tools without offering to change which ones are allowed. */
  readOnly?: boolean
}) {
  const [result, setResult] = useState<InspectionResult | null>(null)
  const [pending, startTransition] = useTransition()
  const [instructionsOpen, setInstructionsOpen] = useState(false)
  const allId = useId()

  function inspect() {
    startTransition(async () => {
      let next: InspectionResult
      try {
        next = await inspectMcpServerAction(server)
      } catch (error) {
        next = { status: "error", message: error instanceof Error ? error.message : "Inspection failed", durationMs: 0 }
      }
      if (next.status === "error") {
        toast.error("Couldn't inspect the server", {
          description: [next.message.replace("args.", ""), lastLines(next.stderr)].filter(Boolean).join(" — "),
        })
        return
      }
      setResult(next)
    })
  }

  const ok: OkResult | null = result?.status === "ok" ? result : null
  const tools = ok?.tools ?? []
  const names = tools.map((tool) => tool.name)
  const missing = (allowedTools ?? []).filter((name) => !names.includes(name))

  function setAllowed(name: string, on: boolean) {
    const current = allowedTools ?? names
    const next = on
      ? [...new Set([...current, name])]
      : current.filter((n) => n !== name)
    onAllowedToolsChange?.(names.every((n) => next.includes(n)) ? undefined : next)
  }

  return (
    <div className="space-y-4">
      <Button
        variant="outline"
        size="sm"
        className="rounded-full"
        onClick={inspect}
        disabled={pending}
      >
        {pending ? (
          <>
            <Loader2 className="animate-spin" />
            Connecting…
          </>
        ) : (
          <>
            <ScanSearch />
            {result ? "Re-inspect" : "Inspect tools"}
          </>
        )}
      </Button>

      {ok && (
        <>
          <div className="space-y-1">
            <p className="text-sm font-medium" title={`v${ok.server.version} · ${ok.durationMs} ms`}>
              {ok.server.name}
              <span className="font-normal text-muted-foreground"> · {tools.length}</span>
            </p>
            {ok.instructions && (
              <div className="space-y-1">
                <p
                  className={cn(
                    "whitespace-pre-wrap text-sm text-muted-foreground",
                    !instructionsOpen && "line-clamp-3"
                  )}
                >
                  {ok.instructions}
                </p>
                {ok.instructions.length > LONG_INSTRUCTIONS && (
                  <Button
                    variant="link"
                    size="xs"
                    className="h-auto p-0"
                    onClick={() => setInstructionsOpen((open) => !open)}
                  >
                    {instructionsOpen ? "Show less" : "Show more"}
                  </Button>
                )}
              </div>
            )}
          </div>

          {!readOnly && (
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id={allId}
                checked={allowedTools === undefined}
                onCheckedChange={(on) =>
                  onAllowedToolsChange?.(on ? undefined : names)
                }
              />
              <label htmlFor={allId}>Allow all tools</label>
            </div>
          )}

          <div className="space-y-2">
            {tools.map((tool) => (
              <ToolRow
                key={tool.name}
                tool={tool}
                readOnly={readOnly}
                checked={
                  allowedTools === undefined || allowedTools.includes(tool.name)
                }
                onCheckedChange={(on) => setAllowed(tool.name, on)}
              />
            ))}
          </div>

          {missing.length > 0 && (
            <p className="text-xs text-destructive">
              Not offered by the server: {missing.join(", ")}
            </p>
          )}
        </>
      )}
    </div>
  )
}

function ToolRow({
  tool,
  checked,
  onCheckedChange,
  readOnly,
}: {
  tool: ToolDescriptor
  checked: boolean
  onCheckedChange: (on: boolean) => void
  readOnly: boolean
}) {
  const [open, setOpen] = useState(false)
  const hints = tool.annotations ?? {}
  const chips: { label: string; destructive?: boolean }[] = []
  if (hints.readOnlyHint) chips.push({ label: "read-only" })
  if (hints.destructiveHint) chips.push({ label: "destructive", destructive: true })
  if (hints.idempotentHint) chips.push({ label: "idempotent" })
  if (hints.openWorldHint) chips.push({ label: "open world" })
  const summary = tool.description?.split("\n")[0]

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border bg-card"
    >
      <div className="flex items-start gap-3 p-3">
        {!readOnly && (
          <Checkbox
            className="mt-0.5"
            checked={checked}
            onCheckedChange={onCheckedChange}
            aria-label={`Allow ${tool.name}`}
          />
        )}
        <CollapsibleTrigger className="flex min-w-0 flex-1 flex-col items-start gap-1 rounded-md text-left outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-medium">{tool.name}</span>
            {chips.map((chip) => (
              <Badge
                key={chip.label}
                variant="outline"
                className={cn(
                  "rounded-full text-[10px]",
                  chip.destructive && "text-destructive"
                )}
              >
                {chip.label}
              </Badge>
            ))}
            <ChevronDown
              className={cn(
                "size-4 text-muted-foreground transition-transform",
                open && "rotate-180"
              )}
            />
          </span>
          {summary && (
            <span className="block w-full truncate text-xs text-muted-foreground">
              {summary}
            </span>
          )}
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent className="space-y-3 border-t p-3">
        {tool.description && (
          <p className="whitespace-pre-wrap text-sm text-muted-foreground">
            {tool.description}
          </p>
        )}
        <ArgumentsTable schema={tool.inputSchema} />
      </CollapsibleContent>
    </Collapsible>
  )
}

function ArgumentsTable({ schema }: { schema: JsonSchemaObject }) {
  const entries = Object.entries(schema.properties ?? {})
  if (entries.length === 0) {
    return <p className="text-sm text-muted-foreground">No arguments.</p>
  }
  const required = new Set(schema.required ?? [])

  return (
    <div className="rounded-xl border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Description</TableHead>
            <TableHead>Default</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {entries.map(([name, prop]) => (
            <TableRow key={name}>
              <TableCell className="font-mono text-xs">
                {name}
                {required.has(name) && <span className="text-destructive">*</span>}
              </TableCell>
              <TableCell className="font-mono text-xs">{describeType(prop)}</TableCell>
              <TableCell className="text-xs whitespace-normal text-muted-foreground">
                {prop.description ?? "—"}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {prop.default === undefined ? "—" : JSON.stringify(prop.default)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function describeType(prop: JsonSchemaProperty): string {
  if (prop.items) {
    const inner = describeType(prop.items)
    return inner.includes(" | ") ? `(${inner})[]` : `${inner}[]`
  }
  if (prop.enum && prop.enum.length > 0) {
    return prop.enum
      .map((value) => (typeof value === "string" ? value : JSON.stringify(value)))
      .join(" | ")
  }
  if (Array.isArray(prop.type)) return prop.type.join(" | ")
  return prop.type ?? "any"
}

function lastLines(text: string | undefined): string | undefined {
  return text?.trim().split("\n").slice(-3).join(" · ") || undefined
}
