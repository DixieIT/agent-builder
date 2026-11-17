"use client";

import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useTheme } from "next-themes";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { Skeleton } from "@/components/ui/skeleton";
import { agentSpecSchema, type AgentSpec } from "@/core/agents/agent-spec";

const Monaco = dynamic(() => import("@monaco-editor/react").then((m) => m.Editor), {
  ssr: false,
  loading: () => <Skeleton className="h-[60vh] w-full rounded-2xl" />,
});

export function specToYaml(spec: AgentSpec): string {
  return stringifyYaml(spec, { lineWidth: 0, blockQuote: "literal" });
}

/** Two-way YAML view: valid edits update the form immediately; invalid ones show the reason and wait. */
export function YamlTab({ spec, onChange }: { spec: AgentSpec; onChange: (spec: AgentSpec) => void }) {
  const { resolvedTheme } = useTheme();
  const [text, setText] = useState(() => specToYaml(spec));
  const [error, setError] = useState<string>();
  const lastEmitted = useRef<string>(JSON.stringify(spec));

  useEffect(() => {
    const incoming = JSON.stringify(spec);
    if (incoming !== lastEmitted.current) {
      lastEmitted.current = incoming;
      setText(specToYaml(spec));
      setError(undefined);
    }
  }, [spec]);

  function handle(value: string | undefined) {
    const next = value ?? "";
    setText(next);
    let document: unknown;
    try {
      document = parseYaml(next);
    } catch (e) {
      setError(e instanceof Error ? e.message.split("\n")[0] : "Invalid YAML");
      return;
    }
    const parsed = agentSpecSchema.safeParse(document);
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join(" · "));
      return;
    }
    setError(undefined);
    lastEmitted.current = JSON.stringify(parsed.data);
    onChange(parsed.data);
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="overflow-hidden rounded-2xl border">
        <Monaco
          height="60vh"
          language="yaml"
          theme={resolvedTheme === "light" ? "light" : "vs-dark"}
          value={text}
          onChange={handle}
          options={{ minimap: { enabled: false }, fontSize: 13, tabSize: 2, scrollBeyondLastLine: false, wordWrap: "on" }}
        />
      </div>
      <p className={error ? "text-sm text-destructive" : "text-sm text-muted-foreground"} role="status">
        {error ?? "Valid agent spec. Changes apply to the form as you type."}
      </p>
    </div>
  );
}
