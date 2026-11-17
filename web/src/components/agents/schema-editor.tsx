"use client"

import * as React from "react"
import { Braces, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"

export type JsonObjectSchema = {
  type?: string
  properties?: Record<string, unknown>
  required?: string[]
  [k: string]: unknown
}

type Props = {
  id: string
  value: JsonObjectSchema | undefined
  onChange: (next: JsonObjectSchema | undefined) => void
  emptyHint: string
  suggestedNames?: string[]
}

type Prop = Record<string, unknown>

const TYPES: readonly string[] = ["string", "number", "integer", "boolean", "array", "object"]
const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
const GRID = "grid grid-cols-[minmax(0,1fr)_8.5rem_auto_minmax(0,1.5fr)_auto] items-start gap-2"

function asRecord(v: unknown): Prop {
  return typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Prop) : {}
}

function isNested(p: Prop): boolean {
  return (
    (p.type === "object" && typeof p.properties === "object" && p.properties !== null) ||
    "anyOf" in p ||
    "oneOf" in p ||
    "$ref" in p
  )
}

function nameError(name: string, others: string[]): string | null {
  if (!NAME_RE.test(name)) return "Use letters, digits and _; start with a letter or _."
  if (others.includes(name)) return "Name is already used."
  return null
}

function normalizeProp(p: Prop): Prop {
  return p.type === "array" && !("items" in p) ? { ...p, items: { type: "string" } } : p
}

const readOnly = (text: string) => <span className="pt-1.5 text-sm text-muted-foreground">{text}</span>

type RowProps = {
  id: string
  index: number
  name: string
  prop: Prop
  required: boolean
  others: string[]
  onRename: (next: string) => void
  onUpdate: (next: Prop) => void
  onRequired: (checked: boolean) => void
  onRemove: () => void
}

function FieldRow({ id, index, name, prop, required, others, onRename, onUpdate, onRequired, onRemove }: RowProps) {
  const [draft, setDraft] = React.useState(name)
  const error = nameError(draft, others)
  const nested = isNested(prop)
  const type = typeof prop.type === "string" ? prop.type : "string"
  const description = typeof prop.description === "string" ? prop.description : ""
  const typeOptions = TYPES.includes(type) ? TYPES : [type, ...TYPES]

  // Names commit on blur/Enter so the row key (the name) stays stable while typing.
  const commitName = () => {
    if (draft !== name && nameError(draft, others) === null) onRename(draft)
  }

  return (
    <div className="border-t border-border px-3 py-2">
      <div className={GRID}>
        {nested ? (
          <span className="pt-1.5 font-mono text-sm">{name}</span>
        ) : (
          <div className="flex flex-col gap-1">
            <Input
              id={`${id}-${index}-name`}
              aria-label="Name"
              aria-invalid={error ? true : undefined}
              className="font-mono"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur()
              }}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {nested ? (
          readOnly(type)
        ) : (
          <Select value={type} onValueChange={(v) => v && onUpdate({ ...prop, type: v })}>
            <SelectTrigger aria-label="Type" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((t) => (
                <SelectItem key={t} value={t}>
                  {t}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {nested ? (
          readOnly(required ? "Yes" : "No")
        ) : (
          <div className="flex h-8 items-center">
            <Checkbox aria-label="Required" checked={required} onCheckedChange={(c) => onRequired(c)} />
          </div>
        )}

        {nested ? (
          readOnly(description)
        ) : (
          <Input
            aria-label="Description"
            value={description}
            onChange={(e) => {
              const next: Prop = { ...prop }
              if (e.target.value) next.description = e.target.value
              else delete next.description
              onUpdate(next)
            }}
          />
        )}

        {nested ? (
          <span />
        ) : (
          <Button type="button" variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} onClick={onRemove}>
            <Trash2 />
          </Button>
        )}
      </div>
      {nested && <p className="mt-1 text-xs text-muted-foreground">Nested schema: edit this in the YAML tab</p>}
    </div>
  )
}

export function SchemaEditor({ id, value, onChange, emptyHint, suggestedNames = [] }: Props) {
  const [jsonMode, setJsonMode] = React.useState(false)
  const [jsonText, setJsonText] = React.useState("")
  const [jsonError, setJsonError] = React.useState<string | null>(null)

  const props = asRecord(value?.properties)
  const names = Object.keys(props)
  const required: string[] = value?.required ?? []

  const commit = (nextProps: Prop, nextRequired: string[]) => {
    if (Object.keys(nextProps).length === 0) {
      onChange(undefined)
      return
    }
    onChange({ ...value, type: value?.type ?? "object", properties: nextProps, required: nextRequired })
  }

  const setProp = (name: string, next: Prop) => commit({ ...props, [name]: normalizeProp(next) }, required)

  const rename = (oldName: string, newName: string) =>
    commit(
      Object.fromEntries(Object.entries(props).map(([k, p]) => [k === oldName ? newName : k, p])),
      required.map((r) => (r === oldName ? newName : r))
    )

  const setRequired = (name: string, on: boolean) =>
    commit(props, on ? [...required.filter((r) => r !== name), name] : required.filter((r) => r !== name))

  const remove = (name: string) =>
    commit(
      Object.fromEntries(Object.entries(props).filter(([k]) => k !== name)),
      required.filter((r) => r !== name)
    )

  const addField = (name: string) => commit({ ...props, [name]: { type: "string" } }, required)

  const freshName = () => {
    let candidate = "field"
    for (let i = 2; names.includes(candidate); i += 1) candidate = `field_${i}`
    return candidate
  }

  const applyJson = () => {
    try {
      const parsed: unknown = JSON.parse(jsonText)
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        setJsonError("Must be a JSON object.")
        return
      }
      setJsonError(null)
      onChange(parsed as JsonObjectSchema)
    } catch (err) {
      setJsonError(err instanceof Error ? err.message : "Invalid JSON.")
    }
  }

  const toggleJson = () => {
    if (jsonMode) {
      setJsonMode(false)
      return
    }
    setJsonText(JSON.stringify(value ?? {}, null, 2))
    setJsonError(null)
    setJsonMode(true)
  }

  const suggestions = suggestedNames.filter(
    (n, i, all) => NAME_RE.test(n) && !names.includes(n) && all.indexOf(n) === i
  )

  return (
    <div className="overflow-hidden rounded-xl border bg-card text-card-foreground">
      <div className="flex justify-end px-3 py-2">
        <Button type="button" variant="ghost" size="sm" aria-pressed={jsonMode} onClick={toggleJson}>
          <Braces />
          Edit as JSON
        </Button>
      </div>

      {jsonMode ? (
        <div className="border-t border-border px-3 py-2">
          <Textarea
            id={`${id}-json`}
            aria-label="Schema JSON"
            aria-invalid={jsonError ? true : undefined}
            className="min-h-48 font-mono text-xs"
            value={jsonText}
            onChange={(e) => setJsonText(e.target.value)}
            onBlur={applyJson}
          />
          {jsonError && <p className="mt-1 text-xs text-destructive">{jsonError}</p>}
        </div>
      ) : (
        <>
          {names.length === 0 ? (
            <p className="border-t border-border px-3 py-3 text-sm text-muted-foreground">{emptyHint}</p>
          ) : (
            <div className="overflow-x-auto">
              <div className="min-w-[40rem]">
                <div className={`${GRID} px-3 py-1.5 text-xs text-muted-foreground`}>
                  <span>Name</span>
                  <span>Type</span>
                  <span>Required</span>
                  <span>Description</span>
                  <span />
                </div>
                {names.map((name, index) => (
                  <FieldRow
                    key={name}
                    id={id}
                    index={index}
                    name={name}
                    prop={asRecord(props[name])}
                    required={required.includes(name)}
                    others={names.filter((n) => n !== name)}
                    onRename={(next) => rename(name, next)}
                    onUpdate={(next) => setProp(name, next)}
                    onRequired={(checked) => setRequired(name, checked)}
                    onRemove={() => remove(name)}
                  />
                ))}
              </div>
            </div>
          )}

          {suggestions.length > 0 && (
            <div className="flex flex-wrap gap-1.5 border-t border-border px-3 py-2">
              {suggestions.map((n) => (
                <Button
                  key={n}
                  type="button"
                  variant="outline"
                  size="xs"
                  className="rounded-full font-mono"
                  onClick={() => addField(n)}
                >
                  <Plus />
                  {"Add {{" + n + "}}"}
                </Button>
              ))}
            </div>
          )}

          <div className="border-t border-border px-3 py-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-full"
              onClick={() => addField(freshName())}
            >
              <Plus />
              Add field
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
