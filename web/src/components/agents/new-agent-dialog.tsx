"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import { createAgentAction } from "@/app/agents/actions";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function NewAgentDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(undefined);
    startTransition(async () => {
      const result = await createAgentAction(name);
      if (result && !result.ok) {
        setError(result.message);
        toast.error(result.message);
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button className="rounded-full" />}>
        <Plus /> New agent
      </DialogTrigger>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>New agent</DialogTitle>
            <DialogDescription>The id is derived from the name, e.g. “Support Triage” becomes support-triage.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="new-agent-name">Name</Label>
            <Input
              id="new-agent-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Research assistant"
              aria-invalid={Boolean(error)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" className="rounded-full" disabled={pending || !name.trim()}>
              {pending ? "Creating…" : "Create agent"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
