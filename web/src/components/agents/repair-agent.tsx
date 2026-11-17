"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import { saveAgentYamlAction } from "@/app/agents/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function RepairAgent({ id, issues, raw }: { id: string; issues: string[]; raw: string }) {
  const router = useRouter();
  const [text, setText] = useState(raw);
  const [errors, setErrors] = useState(issues);
  const [pending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      const result = await saveAgentYamlAction(id, text);
      if (result.ok) {
        toast.success("Agent repaired");
        router.refresh();
      } else {
        setErrors(result.issues?.map((i) => `${i.path}: ${i.message}`) ?? [result.message]);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 p-4">
        <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" />
        <div className="min-w-0">
          <h1 className="font-heading text-lg font-semibold">{id} needs repair</h1>
          <p className="text-sm text-muted-foreground">The stored document doesn’t match the agent schema. Fix it below and save.</p>
          <ul className="mt-2 list-inside list-disc text-sm">
            {errors.map((issue) => (
              <li key={issue} className="font-mono text-xs">
                {issue}
              </li>
            ))}
          </ul>
        </div>
      </div>
      <Textarea id="repair-yaml" value={text} onChange={(e) => setText(e.target.value)} className="min-h-[60vh] font-mono text-xs" />
      <div>
        <Button className="rounded-full" onClick={save} disabled={pending}>
          {pending ? "Saving…" : "Save repaired agent"}
        </Button>
      </div>
    </div>
  );
}
