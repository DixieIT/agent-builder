"use client";

import { useState } from "react";
import { CircleAlert, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export function Field({
  id,
  label,
  hint,
  error,
  className,
  children,
}: {
  id: string;
  label: string;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)}>
      <div className="flex items-center gap-1.5">
        <Label htmlFor={id}>{label}</Label>
        {hint ? <Hint>{hint}</Hint> : null}
        {error ? (
          <Tooltip>
            <TooltipTrigger render={<span role="img" aria-label={error} className="inline-flex text-destructive" />}>
              <CircleAlert className="size-3.5" />
            </TooltipTrigger>
            <TooltipContent>{error}</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** Icon-only action with its name in a tooltip (and aria-label). */
export function IconButton({
  label,
  children,
  variant = "ghost",
  className,
  ...props
}: { label: string; variant?: "ghost" | "outline" | "default" | "destructive" } & Omit<React.ComponentProps<"button">, "aria-label">) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button type="button" variant={variant} size="icon" aria-label={label} className={cn("rounded-full", className)} {...props} />}>
        {children}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

/** Secondary information lives in a tooltip, never as text under the field. */
export function Hint({ children, label = "More information" }: { children: React.ReactNode; label?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button type="button" aria-label={label} className="inline-flex text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground" />}
      >
        <Info className="size-3.5" />
      </TooltipTrigger>
      <TooltipContent className="max-w-72">{children}</TooltipContent>
    </Tooltip>
  );
}

/** Optional text: empty input means "unset". */
export function TextField(props: {
  id: string;
  label: string;
  value: string | undefined;
  onChange: (value: string | undefined) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  error?: string;
  mono?: boolean;
  type?: string;
  className?: string;
  list?: string;
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={props.error} className={props.className}>
      <Input
        id={props.id}
        type={props.type}
        list={props.list}
        value={props.value ?? ""}
        placeholder={props.placeholder}
        aria-invalid={Boolean(props.error)}
        className={cn(props.mono && "font-mono text-sm")}
        onChange={(e) => props.onChange(e.target.value === "" ? undefined : e.target.value)}
      />
    </Field>
  );
}

export function NumberField(props: {
  id: string;
  label: string;
  value: number | undefined;
  onChange: (value: number | undefined) => void;
  min?: number;
  max?: number;
  step?: number;
  hint?: React.ReactNode;
  placeholder?: string;
}) {
  return (
    <Field id={props.id} label={props.label} hint={props.hint}>
      <Input
        id={props.id}
        type="number"
        inputMode="decimal"
        min={props.min}
        max={props.max}
        step={props.step}
        placeholder={props.placeholder}
        className="tabular-nums"
        value={props.value ?? ""}
        onChange={(e) => {
          const next = e.target.value === "" ? undefined : Number(e.target.value);
          props.onChange(next !== undefined && Number.isNaN(next) ? undefined : next);
        }}
      />
    </Field>
  );
}

export function SwitchField(props: {
  id: string;
  label: string;
  description?: string;
  checked: boolean | undefined;
  onChange: (value: boolean | undefined) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border bg-background/40 px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Label htmlFor={props.id}>{props.label}</Label>
        {props.description ? <Hint>{props.description}</Hint> : null}
      </div>
      <Switch id={props.id} checked={props.checked ?? false} onCheckedChange={(v) => props.onChange(v ? true : undefined)} />
    </div>
  );
}

/**
 * A textarea editing a structured value through a text form (lines, KEY=VALUE, YAML...).
 * Keeps the user's text while typing; commits parsed values on every valid change.
 */
export function CodecTextarea<T>(props: {
  id: string;
  label: string;
  value: T;
  format: (value: T) => string;
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string };
  onChange: (value: T) => void;
  placeholder?: string;
  hint?: React.ReactNode;
  rows?: number;
}) {
  const { value, format } = props;
  const [text, setText] = useState(() => format(value));
  const [error, setError] = useState<string>();
  const [seen, setSeen] = useState(value);

  // Sync when the value changes from outside (YAML tab, undo), unless it is what we just typed.
  if (seen !== value) {
    setSeen(value);
    const parsed = props.parse(text);
    if (!parsed.ok || JSON.stringify(parsed.value) !== JSON.stringify(value)) {
      setText(format(value));
      setError(undefined);
    }
  }

  return (
    <Field id={props.id} label={props.label} hint={props.hint} error={error}>
      <Textarea
        id={props.id}
        rows={props.rows ?? 3}
        value={text}
        placeholder={props.placeholder}
        aria-invalid={Boolean(error)}
        className="font-mono text-xs"
        onChange={(e) => {
          setText(e.target.value);
          const parsed = props.parse(e.target.value);
          if (parsed.ok) {
            setError(undefined);
            props.onChange(parsed.value);
          } else setError(parsed.error);
        }}
      />
    </Field>
  );
}

export const linesCodec = {
  format: (value: string[] | undefined) => (value ?? []).join("\n"),
  parse: (text: string) => {
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    return { ok: true as const, value: lines.length ? lines : undefined };
  },
};

export const listCodec = {
  format: (value: string[] | undefined) => (value ?? []).join(", "),
  parse: (text: string) => {
    const items = text.split(/[,\n]/).map((l) => l.trim()).filter(Boolean);
    return { ok: true as const, value: items.length ? items : undefined };
  },
};

export const keyValueCodec = {
  format: (value: Record<string, string> | undefined) =>
    Object.entries(value ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
  parse: (text: string): { ok: true; value: Record<string, string> | undefined } | { ok: false; error: string } => {
    const record: Record<string, string> = {};
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    for (const [index, line] of lines.entries()) {
      const eq = line.indexOf("=");
      const sep = eq === -1 ? line.indexOf(":") : eq;
      if (sep <= 0) return { ok: false, error: `Line ${index + 1}: write KEY=value.` };
      record[line.slice(0, sep).trim()] = line.slice(sep + 1).trim();
    }
    return { ok: true, value: lines.length ? record : undefined };
  },
};
