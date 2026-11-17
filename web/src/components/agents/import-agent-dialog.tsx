"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, CircleX, FolderOpen, Upload } from "lucide-react";
import { toast } from "sonner";
import { importAgentAction, importFolderAction } from "@/app/agents/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ImportReport } from "@/core/library/import-service";

/** Text files a bundle can hold; everything else (images, binaries, node_modules) is left out of the upload. */
const IMPORTABLE = /\.(ya?ml|md|py|ts|sh|txt|json)$/i;
const SKIP_DIR = /(^|\/)(\.git|node_modules|\.venv|__pycache__)(\/|$)/;
const MAX_FILE = 1_000_000;

type Picked = { name: string; files: { path: string; content: string }[]; skipped: number };

export function ImportAgentDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState("");
  const [picked, setPicked] = useState<Picked | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [pending, startTransition] = useTransition();
  const folderInput = useRef<HTMLInputElement>(null);

  async function pickFolder(list: FileList | null) {
    setReport(null);
    if (!list?.length) return;
    const all = Array.from(list);
    const name = all[0].webkitRelativePath.split("/")[0] || "folder";
    const files: Picked["files"] = [];
    let skipped = 0;
    for (const file of all) {
      // Paths come as "<picked folder>/<rest>"; the server recreates the folder under its own name.
      const rel = file.webkitRelativePath.split("/").slice(1).join("/");
      if (!rel || SKIP_DIR.test(rel) || !IMPORTABLE.test(rel) || file.size > MAX_FILE) {
        skipped++;
        continue;
      }
      files.push({ path: rel, content: await file.text() });
    }
    setPicked({ name, files, skipped });
  }

  function importFolder() {
    if (!picked) return;
    startTransition(async () => {
      const result = await importFolderAction(picked.name, picked.files);
      if ("ok" in result) {
        toast.error(result.message);
        return;
      }
      setReport(result);
      if (result.failed === 0) toast.success(`Imported ${result.imported} ${result.imported === 1 ? "item" : "items"}`);
      else toast.error(`${result.failed} of ${result.lines.length} items failed`, { description: "See the list in the dialog." });
      router.refresh();
    });
  }

  function importYaml() {
    startTransition(async () => {
      const result = await importAgentAction(yaml);
      if (result && !result.ok) {
        toast.error(result.message, { description: result.issues?.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join(" · ") });
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) {
          setPicked(null);
          setReport(null);
        }
      }}
    >
      <DialogTrigger render={<Button variant="outline" className="rounded-full" />}>
        <Upload /> Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import</DialogTitle>
          <DialogDescription>Agents (specs, lele AGENTS.md, Goose recipes), tools, skills and capabilities.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="folder">
          <TabsList>
            <TabsTrigger value="folder">Folder</TabsTrigger>
            <TabsTrigger value="yaml">YAML</TabsTrigger>
          </TabsList>

          <TabsContent value="folder" className="mt-4 flex flex-col gap-4">
            <input
              ref={folderInput}
              id="import-folder"
              type="file"
              multiple
              className="hidden"
              onChange={(e) => pickFolder(e.target.files)}
              {...{ webkitdirectory: "", directory: "" }}
            />
            <button
              type="button"
              onClick={() => folderInput.current?.click()}
              className="flex flex-col items-center gap-2 rounded-2xl border border-dashed bg-background/50 px-6 py-8 text-sm text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
            >
              <FolderOpen className="size-6" />
              {picked ? (
                <span>
                  <span className="font-mono text-foreground">{picked.name}</span> · {picked.files.length} files
                  {picked.skipped ? ` (${picked.skipped} skipped)` : ""}
                </span>
              ) : (
                "Choose a folder, e.g. examples/lele-agents or a bundle from agents dump"
              )}
            </button>
            {report ? (
              <ul className="max-h-56 divide-y overflow-auto rounded-xl border text-sm">
                {report.lines.map((line) => (
                  <li key={`${line.kind}-${line.name}`} className="flex items-center gap-2 px-3 py-1.5" title={[line.message, ...(line.warnings ?? [])].filter(Boolean).join("\n")}>
                    {line.ok ? <CheckCircle2 className="size-4 shrink-0 text-chart-2" /> : <CircleX className="size-4 shrink-0 text-destructive" />}
                    <span className="text-muted-foreground">{line.kind}</span>
                    <span className="truncate font-mono">{line.name}</span>
                    {line.replaced ? <span className="ml-auto text-xs text-muted-foreground">replaced</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <DialogFooter>
              <Button className="rounded-full" disabled={pending || !picked?.files.length} onClick={importFolder}>
                {pending ? "Importing…" : "Import folder"}
              </Button>
            </DialogFooter>
          </TabsContent>

          <TabsContent value="yaml" className="mt-4 flex flex-col gap-4">
            <Textarea
              id="import-agent-yaml"
              aria-label="Agent YAML"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              className="min-h-64 font-mono text-xs"
              placeholder={"name: research_assistant\nmodel: anthropic:claude-opus-5-5\ninstructions: You are helping {{user_name}}."}
            />
            <DialogFooter>
              <Button className="rounded-full" disabled={pending || !yaml.trim()} onClick={importYaml}>
                {pending ? "Importing…" : "Import agent"}
              </Button>
            </DialogFooter>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
