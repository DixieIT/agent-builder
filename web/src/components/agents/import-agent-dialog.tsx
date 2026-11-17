"use client";

import { useState, useTransition } from "react";
import { Upload } from "lucide-react";
import { toast } from "sonner";
import { importAgentAction } from "@/app/agents/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SpecIssue } from "@/core/agents/agent-spec";

export function ImportAgentDialog() {
  const [open, setOpen] = useState(false);
  const [yaml, setYaml] = useState("");
  const [error, setError] = useState<{ message: string; issues?: SpecIssue[] }>();
  const [pending, startTransition] = useTransition();

  async function loadFile(file: File | undefined) {
    if (file) setYaml(await file.text());
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await importAgentAction(yaml);
      if (result && !result.ok) {
        setError(result);
        toast.error(result.message, { description: result.issues?.slice(0, 4).map((i) => `${i.path}: ${i.message}`).join(" · ") });
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" className="rounded-full" />}>
        <Upload /> Import
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Import an agent</DialogTitle>
            <DialogDescription>Paste a Pydantic AI agent spec or a Goose recipe (YAML), or pick a file.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="import-agent-yaml">YAML</Label>
            <Textarea
              id="import-agent-yaml"
              value={yaml}
              onChange={(e) => setYaml(e.target.value)}
              className="min-h-72 font-mono text-xs"
              placeholder={"name: research_assistant\nmodel: anthropic:claude-opus-5-5\ninstructions: You are helping {{user_name}}."}
              aria-invalid={Boolean(error)}
            />
            <input
              id="import-agent-file"
              type="file"
              accept=".yaml,.yml,text/yaml"
              className="text-sm text-muted-foreground file:mr-3 file:rounded-full file:border file:bg-secondary file:px-3 file:py-1 file:text-secondary-foreground"
              onChange={(e) => loadFile(e.target.files?.[0])}
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="rounded-full" disabled={pending || !yaml.trim()}>
              {pending ? "Importing…" : "Import agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
