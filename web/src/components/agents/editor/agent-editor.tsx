"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
} from "react";
import { useImmer } from "use-immer";
import {
  AlertCircle,
  Copy,
  Plus,
  Save,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { toast } from "sonner";
import { deleteAgentAction, saveAgentAction } from "@/app/agents/actions";
import { toGooseRecipe } from "@/adapters/goose/goose-recipe";
import {
  SchemaEditor,
  type JsonObjectSchema,
} from "@/components/agents/schema-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Textarea } from "@/components/ui/textarea";
import {
  CAPABILITY_CATALOG,
  type Capability,
  type DepsSchema,
  type Retry,
  fromCapability,
  instructionsText,
  templateVariables,
  toCapability,
  validateAgentSpec,
  type GooseAgentSpec,
  type SpecIssue,
} from "@/core/agents/agent-spec";
import { CapabilityCard } from "./capability-card";
import {
  CodecTextarea,
  Field,
  Hint,
  IconButton,
  NumberField,
  TextField,
  linesCodec,
} from "./fields";
import { YamlTab } from "./yaml-tab";

const MODELS = [
  "anthropic:claude-opus-5-5",
  "anthropic:claude-sonnet-5-5",
  "anthropic:claude-haiku-5-5",
  "anthropic:claude-fable-5-2",
  "openai:gpt-5",
  "google-gla:gemini-2.5-pro",
];

type Props = { id: string; initialSpec: GooseAgentSpec; updatedAt: string };

export function GooseAgentEditor({ id, initialSpec, updatedAt }: Props) {
  const [spec, update] = useImmer<GooseAgentSpec>(initialSpec);
  const [saved, setSaved] = useState(() => JSON.stringify(initialSpec));
  const [savedAt, setSavedAt] = useState(updatedAt);
  const [serverIssues, setServerIssues] = useState<SpecIssue[]>([]);
  const [saving, startSaving] = useTransition();
  const [deleting, startDeleting] = useTransition();
  const [confirmDelete, setConfirmDelete] = useState(false);

  const dirty = JSON.stringify(spec) !== saved;
  const { issues } = useMemo(() => validateAgentSpec(spec), [spec]);
  const allIssues = serverIssues.length ? serverIssues : issues;
  const errors = allIssues.filter((i) => i.severity === "error");
  const variables = useMemo(() => templateVariables(spec), [spec]);
  const undeclared = variables.filter(
    (v) => !Object.keys(spec.deps_schema?.properties ?? {}).includes(v),
  );
  const goose = useMemo(() => toGooseRecipe(spec), [spec]);
  const caps = spec.capabilities.map(toCapability);

  const save = useCallback(() => {
    startSaving(async () => {
      const result = await saveAgentAction(id, spec);
      if (result.ok) {
        setSaved(JSON.stringify(spec));
        setSavedAt(result.updatedAt);
        setServerIssues([]);
        toast.success("Agent saved");
      } else {
        setServerIssues(result.issues ?? []);
        toast.error(result.message);
      }
    });
  }, [id, spec]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (dirty) save();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
    };
  }, [dirty, save]);

  const setRetry = (patch: Partial<Retry>) =>
    update((d) => {
      const next = { checks: [], ...d.retry, ...patch } as Retry;
      const empty =
        next.max_retries === undefined &&
        !next.checks.length &&
        !next.on_failure &&
        !next.timeout_seconds &&
        !next.on_failure_timeout_seconds;
      d.retry = empty ? undefined : next;
    });

  const issuesFor = (prefix: string) =>
    allIssues
      .filter((i) => i.path === prefix || i.path.startsWith(`${prefix}.`))
      .map((i) => i.message);
  const fieldError = (path: string) =>
    allIssues.find((i) => i.path === path && i.severity === "error")?.message;

  return (
    <div className="overflow-hidden rounded-3xl border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b px-5 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Tooltip>
            <TooltipTrigger
              render={<h1 className="truncate text-2xl font-semibold" />}
            >
              {spec.name || id}
            </TooltipTrigger>
            <TooltipContent>
              {id} ·{" "}
              {dirty
                ? "Unsaved changes"
                : `Saved ${new Date(savedAt).toLocaleString()}`}
            </TooltipContent>
          </Tooltip>
          {dirty ? (
            <span
              aria-label="Unsaved changes"
              className="size-2 shrink-0 rounded-full bg-peach"
            />
          ) : null}
        </div>
        {errors.length ? (
          <Badge variant="destructive" className="rounded-full">
            <AlertCircle /> {errors.length}
          </Badge>
        ) : null}
        <IconButton
          label="Delete"
          variant="ghost"
          disabled={deleting}
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 />
        </IconButton>
        <IconButton
          label={saving ? "Saving…" : "Save (Ctrl+S)"}
          variant="default"
          onClick={save}
          disabled={!dirty || saving}
        >
          <Save />
        </IconButton>
        <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete {id}?</AlertDialogTitle>
              <AlertDialogDescription>
                The agent spec is removed from the store. This can’t be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep agent</AlertDialogCancel>
              <AlertDialogAction
                onClick={() =>
                  startDeleting(async () => {
                    const result = await deleteAgentAction(id);
                    if (result && !result.ok) toast.error(result.message);
                  })
                }
              >
                Delete agent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Tabs defaultValue="overview" className="gap-0">
        <div className="border-b px-5 py-2">
          <TabsList className="flex-wrap">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="capabilities">
              Capabilities{" "}
              <Badge
                variant="secondary"
                className="ml-1 rounded-full px-1.5 text-[10px]"
              >
                {caps.length}
              </Badge>
            </TabsTrigger>
            <TabsTrigger value="io">Inputs &amp; output</TabsTrigger>
            <TabsTrigger value="runtime">Runtime</TabsTrigger>
            <TabsTrigger value="goose">Goose recipe</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
          </TabsList>
        </div>
        <div
          className={
            allIssues.length
              ? "grid lg:grid-cols-[minmax(0,1fr)_300px]"
              : "grid"
          }
        >
          <div className="min-w-0 p-5">
            <TabsContent value="overview" className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  id="spec-name"
                  label="Name"
                  mono
                  value={spec.name}
                  error={fieldError("name")}
                  onChange={(v) => update((d) => void (d.name = v ?? ""))}
                />
                <TextField
                  id="spec-model"
                  label="Model"
                  mono
                  list="model-options"
                  value={spec.model}
                  error={fieldError("model")}
                  hint="provider:model"
                  onChange={(v) => update((d) => void (d.model = v))}
                />
                <datalist id="model-options">
                  {MODELS.map((m) => (
                    <option key={m} value={m} />
                  ))}
                </datalist>
              </div>
              <Field
                id="spec-description"
                label="Description"
                hint="Shown to people and other agents. Can use {{variables}}."
              >
                <Textarea
                  id="spec-description"
                  rows={2}
                  value={spec.description}
                  onChange={(e) =>
                    update((d) => void (d.description = e.target.value))
                  }
                />
              </Field>
              <Field
                id="spec-instructions"
                label="Instructions"
                error={fieldError("instructions")}
                hint={
                  variables.length ? (
                    <span className="flex flex-wrap items-center gap-1">
                      Variables:
                      {variables.map((v) => (
                        <Badge
                          key={v}
                          variant={
                            undeclared.includes(v) ? "destructive" : "outline"
                          }
                          className="rounded-full font-mono text-[10px]"
                        >
                          {`{{${v}}}`}
                        </Badge>
                      ))}
                    </span>
                  ) : (
                    "Use {{name}} for values supplied at run time; declare them under Inputs."
                  )
                }
              >
                <Textarea
                  id="spec-instructions"
                  rows={10}
                  className="font-mono text-sm"
                  value={instructionsText(spec)}
                  onChange={(e) =>
                    update((d) => void (d.instructions = e.target.value))
                  }
                />
              </Field>
              <Field
                id="spec-prompt"
                label="Starting prompt"
                hint="The first message of a headless run (goose run, CLI, container)."
              >
                <Textarea
                  id="spec-prompt"
                  rows={3}
                  value={spec.prompt ?? ""}
                  onChange={(e) =>
                    update((d) => void (d.prompt = e.target.value || undefined))
                  }
                />
              </Field>
            </TabsContent>

            <TabsContent value="capabilities" className="flex flex-col gap-4">
              {caps.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-card/50 p-8 text-center text-sm text-muted-foreground">
                  No capabilities yet. Add an MCP server to give the agent
                  tools, then inspect them.
                </div>
              ) : (
                caps.map((capability, index) => (
                  <CapabilityCard
                    key={index}
                    index={index}
                    count={caps.length}
                    capability={capability}
                    onChange={(next) =>
                      update(
                        (d) =>
                          void (d.capabilities[index] = fromCapability(next)),
                      )
                    }
                    onRemove={() =>
                      update((d) => void d.capabilities.splice(index, 1))
                    }
                    onMove={(delta) =>
                      update((d) => {
                        const [item] = d.capabilities.splice(index, 1);
                        d.capabilities.splice(index + delta, 0, item);
                      })
                    }
                  />
                ))
              )}
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button
                      variant="outline"
                      className="self-start rounded-full"
                    />
                  }
                >
                  <Plus /> Add capability
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-80">
                  {CAPABILITY_CATALOG.map((entry) => (
                    <DropdownMenuItem
                      key={entry.kind}
                      onClick={() =>
                        update(
                          (d) =>
                            void d.capabilities.push(
                              fromCapability({
                                kind: entry.kind,
                                args: structuredClone(entry.defaults),
                              } as Capability),
                            ),
                        )
                      }
                      className="flex flex-col items-start gap-0.5"
                    >
                      <span className="font-medium">{entry.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {entry.summary}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </TabsContent>

            <TabsContent value="io" className="flex flex-col gap-6">
              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                  Inputs{" "}
                  <Hint>
                    deps_schema: values supplied at run time, used as{" "}
                    {"{{variables}}"}. In Goose they become recipe parameters.
                  </Hint>
                </h2>
                <SchemaEditor
                  id="deps"
                  value={spec.deps_schema as JsonObjectSchema | undefined}
                  onChange={(next) =>
                    update(
                      (d) =>
                        void (d.deps_schema = next as DepsSchema | undefined),
                    )
                  }
                  emptyHint="No inputs. Add one for each {{variable}} in the instructions."
                  suggestedNames={undeclared}
                />
              </section>
              <section className="flex flex-col gap-2">
                <h2 className="flex items-center gap-1.5 text-lg font-semibold">
                  Structured output{" "}
                  <Hint>
                    output_schema: the shape of the final answer. Leave empty
                    for free text.
                  </Hint>
                </h2>
                <SchemaEditor
                  id="output"
                  value={spec.output_schema as JsonObjectSchema | undefined}
                  onChange={(next) =>
                    update((d) => void (d.output_schema = next))
                  }
                  emptyHint="Free-text answers."
                />
              </section>
            </TabsContent>

            <TabsContent value="runtime" className="flex flex-col gap-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <NumberField
                  id="ms-temperature"
                  label="Temperature"
                  min={0}
                  max={2}
                  step={0.1}
                  value={spec.model_settings?.temperature}
                  hint="settings.temperature"
                  onChange={(v) =>
                    update(
                      (d) =>
                        void (d.model_settings =
                          v === undefined ? undefined : { temperature: v }),
                    )
                  }
                />
                <NumberField
                  id="spec-max-turns"
                  label="Max turns"
                  min={1}
                  value={spec.max_turns}
                  hint="settings.max_turns"
                  onChange={(v) => update((d) => void (d.max_turns = v))}
                />
              </div>

              <h2 className="flex items-center gap-1.5 font-semibold">
                Retry{" "}
                <Hint>
                  Goose re-runs the agent until every check exits 0, up to the
                  retry limit.
                </Hint>
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <NumberField
                  id="retry-max"
                  label="Max retries"
                  min={1}
                  max={20}
                  value={spec.retry?.max_retries}
                  onChange={(v) => setRetry({ max_retries: v })}
                />
                <NumberField
                  id="retry-timeout"
                  label="Check timeout (s)"
                  min={1}
                  value={spec.retry?.timeout_seconds}
                  placeholder="300"
                  onChange={(v) => setRetry({ timeout_seconds: v })}
                />
                <NumberField
                  id="retry-failure-timeout"
                  label="On-failure timeout (s)"
                  min={1}
                  value={spec.retry?.on_failure_timeout_seconds}
                  placeholder="600"
                  onChange={(v) => setRetry({ on_failure_timeout_seconds: v })}
                />
              </div>
              <CodecTextarea
                id="retry-checks"
                label="Checks"
                hint="Shell commands, one per line. Success means exit code 0."
                value={spec.retry?.checks.map((c) => c.command)}
                {...linesCodec}
                placeholder="test -f report.md"
                onChange={(v) =>
                  setRetry({
                    checks: (v ?? []).map((command) => ({
                      type: "shell" as const,
                      command,
                    })),
                  })
                }
              />
              <TextField
                id="retry-on-failure"
                label="On failure"
                mono
                value={spec.retry?.on_failure}
                hint="Shell command run after a failed attempt, before retrying."
                onChange={(v) => setRetry({ on_failure: v })}
              />

              <CodecTextarea
                id="spec-activities"
                label="Activities"
                hint="One per line. Quick-start buttons in Goose Desktop."
                value={spec.activities}
                {...linesCodec}
                onChange={(v) => update((d) => void (d.activities = v))}
              />
            </TabsContent>

            <TabsContent value="goose" className="flex flex-col gap-3">
              {goose.warnings.length ? (
                <div className="rounded-2xl border border-gold/60 bg-gold/10 p-4 text-sm">
                  <p className="flex items-center gap-2 font-medium">
                    <TriangleAlert className="size-4" /> Not carried over to
                    Goose
                  </p>
                  <ul className="mt-2 list-inside list-disc text-muted-foreground">
                    {goose.warnings.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="relative">
                <Button
                  variant="outline"
                  size="sm"
                  className="absolute top-3 right-3 rounded-full"
                  onClick={() =>
                    navigator.clipboard.writeText(goose.yaml).then(
                      () => toast.success("Recipe copied"),
                      () =>
                        toast.error("Couldn't copy. Select the text instead."),
                    )
                  }
                >
                  <Copy /> Copy
                </Button>
                <pre className="max-h-[60vh] overflow-auto rounded-2xl border bg-card p-4 font-mono text-xs leading-relaxed">
                  {goose.yaml}
                </pre>
              </div>
            </TabsContent>

            <TabsContent value="yaml">
              <YamlTab spec={spec} onChange={(next) => (next.runtime === "goose" ? update(() => next) : toast.error("Switching runtime isn't supported here; create a new agent instead."))} />
            </TabsContent>
          </div>
          {allIssues.length ? (
            <aside className="border-t p-5 lg:border-t-0 lg:border-l">
              {allIssues.length ? (
                <section>
                  <h2 className="text-sm font-semibold">Checks</h2>
                  <ul className="mt-2 flex flex-col gap-2">
                    {allIssues.map((issue) => (
                      <li
                        key={`${issue.path}-${issue.message}`}
                        className="flex gap-2 text-sm"
                      >
                        {issue.severity === "error" ? (
                          <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" />
                        ) : (
                          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-chart-5" />
                        )}
                        <span className="min-w-0" title={issue.path}>
                          {issue.message}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
            </aside>
          ) : null}
        </div>
      </Tabs>
    </div>
  );
}
