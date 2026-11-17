import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { EnvironmentStore, EnvSourceInfo } from "@/core/environment/environment-store.port";
import {
  ENVIRONMENTS,
  maskValue,
  type Environment,
  type EnvVar,
  type EnvVarInput,
} from "@/core/environment/environment";

/**
 * Folder source: a directory holding a shared `.env` (all environments) and one file per environment
 * (`.env.development`, `.env.preview`, `.env.production`). A specific file overrides `.env`.
 * Files are parsed and written by hand so that comments, ordering and unrelated lines survive edits.
 */

const SENSITIVE_KEY = /KEY|SECRET|TOKEN|PASSWORD|PRIVATE|CREDENTIAL/i;
const DOUBLE_QUOTE_ESCAPES: ReadonlyMap<string, string> = new Map([
  ["n", "\n"],
  ["r", "\r"],
  ["t", "\t"],
  ['"', '"'],
  ["\\", "\\"],
]);

interface Node {
  kind: "blank" | "comment" | "other" | "entry";
  /** Raw source lines of this node (a multi-line quoted value spans several). */
  lines: string[];
  key?: string;
  value?: string;
}

interface EnvFileDoc {
  path: string;
  original: string;
  bom: boolean;
  eol: string;
  nodes: Node[];
  values: Map<string, string>;
  /** Comment line directly above the key (last occurrence wins). */
  comments: Map<string, string>;
  mtime: Date | undefined;
}

interface LoadedFiles {
  shared: EnvFileDoc | undefined;
  specific: Partial<Record<Environment, EnvFileDoc>>;
}

export class DotenvEnvironmentStore implements EnvironmentStore {
  constructor(private readonly dir: string) {}

  describe(): EnvSourceInfo {
    return { kind: "folder", label: `Folder ${this.dir}`, location: this.dir, writable: true };
  }

  async list(): Promise<EnvVar[]> {
    const files = await this.loadFiles();
    const allDocs = [files.shared, ...ENVIRONMENTS.map((env) => files.specific[env])];

    const keys = new Set<string>();
    for (const doc of allDocs) for (const key of doc?.values.keys() ?? []) keys.add(key);

    const vars: EnvVar[] = [];
    for (const key of [...keys].sort()) {
      const resolved = new Map<Environment, string>();
      for (const env of ENVIRONMENTS) {
        const value = files.specific[env]?.values.get(key) ?? files.shared?.values.get(key);
        if (value !== undefined) resolved.set(env, value);
      }
      const resolvedValues = [...resolved.values()];
      const first = resolvedValues[0];
      if (first === undefined) continue;

      const sensitive = SENSITIVE_KEY.test(key);
      const uniform = resolvedValues.every((value) => value === first);
      const comment = [...ENVIRONMENTS.map((env) => files.specific[env]), files.shared]
        .map((doc) => doc?.comments.get(key))
        .find((text) => text !== undefined);

      let updatedAt = new Date(0);
      for (const doc of allDocs) {
        if (doc?.values.has(key) && doc.mtime && doc.mtime > updatedAt) updatedAt = doc.mtime;
      }

      vars.push({
        key,
        environments: [...resolved.keys()],
        sensitive,
        // One value field per variable: shown only when plain and identical across environments.
        value: !sensitive && uniform ? first : undefined,
        preview: maskValue(first),
        comment,
        updatedAt,
      });
    }
    return vars;
  }

  async set(input: EnvVarInput): Promise<EnvVar> {
    const { key, value, comment } = input;
    const selected = new Set<Environment>(input.environments);
    const paths = this.paths();

    for (const env of ENVIRONMENTS) {
      const path = paths.specific[env];
      const doc = await this.readDoc(path);
      if (selected.has(env)) {
        const base = doc ?? emptyDoc(path);
        await this.save(base, serialize(base, upsertEntry(base.nodes, key, value, comment)));
      } else if (doc) {
        // Not selected: the variable must not resolve here, so drop any specific entry...
        await this.save(doc, serialize(doc, removeKeyNodes(doc.nodes, key)));
      }
    }

    // ...and the shared `.env` entry: selected environments now carry explicit values, the others must not inherit it.
    const shared = await this.readDoc(paths.shared);
    if (shared) await this.save(shared, serialize(shared, removeKeyNodes(shared.nodes, key)));

    const stored = (await this.list()).find((variable) => variable.key === key);
    if (!stored) throw new Error(`Could not store ${key}.`);
    return stored;
  }

  async remove(key: string): Promise<void> {
    const paths = this.paths();
    const all = [paths.shared, ...ENVIRONMENTS.map((env) => paths.specific[env])];
    for (const path of all) {
      const doc = await this.readDoc(path);
      if (doc) await this.save(doc, serialize(doc, removeKeyNodes(doc.nodes, key)));
    }
  }

  async resolve(
    environment: Environment,
    keys: string[],
  ): Promise<{ values: Record<string, string>; missing: string[] }> {
    const files = await this.loadFiles();
    const specific = files.specific[environment];
    const values: Record<string, string> = {};
    const missing: string[] = [];
    for (const key of keys) {
      const value = specific?.values.get(key) ?? files.shared?.values.get(key);
      if (value !== undefined) values[key] = value;
      else missing.push(key);
    }
    return { values, missing };
  }

  private paths(): { shared: string; specific: Record<Environment, string> } {
    return {
      shared: join(this.dir, ".env"),
      specific: {
        development: join(this.dir, ".env.development"),
        preview: join(this.dir, ".env.preview"),
        production: join(this.dir, ".env.production"),
      },
    };
  }

  private async loadFiles(): Promise<LoadedFiles> {
    const paths = this.paths();
    const specific: Partial<Record<Environment, EnvFileDoc>> = {};
    for (const env of ENVIRONMENTS) {
      const doc = await this.readDoc(paths.specific[env]);
      if (doc) specific[env] = doc;
    }
    return { shared: await this.readDoc(paths.shared), specific };
  }

  private async readDoc(path: string): Promise<EnvFileDoc | undefined> {
    let text: string;
    let mtime: Date;
    try {
      text = await readFile(path, "utf8");
      mtime = (await stat(path)).mtime;
    } catch (error) {
      if (isNotFound(error)) return undefined;
      throw error;
    }
    return parseDoc(path, text, mtime);
  }

  private async save(doc: EnvFileDoc, content: string): Promise<void> {
    if (content === doc.original) return;
    await mkdir(dirname(doc.path), { recursive: true });
    // Atomic replace: write a sibling temp file, then rename over the target.
    const tmp = `${doc.path}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    await writeFile(tmp, content, "utf8");
    try {
      await rename(tmp, doc.path);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function emptyDoc(path: string): EnvFileDoc {
  return { path, original: "", bom: false, eol: "\n", nodes: [], values: new Map(), comments: new Map(), mtime: undefined };
}

function parseDoc(path: string, raw: string, mtime: Date): EnvFileDoc {
  const bom = raw.startsWith("﻿");
  const text = bom ? raw.slice(1) : raw;
  const nodes = parseNodes(text);
  const values = new Map<string, string>();
  const comments = new Map<string, string>();
  nodes.forEach((node, index) => {
    if (node.kind !== "entry" || node.key === undefined || node.value === undefined) return;
    values.set(node.key, node.value);
    const previous = index > 0 ? nodes[index - 1] : undefined;
    const comment = previous?.kind === "comment" ? commentText(previous) : "";
    if (comment) comments.set(node.key, comment);
    else comments.delete(node.key);
  });
  return {
    path,
    original: raw,
    bom,
    eol: text.includes("\r\n") ? "\r\n" : "\n",
    nodes,
    values,
    comments,
    mtime,
  };
}

function serialize(doc: EnvFileDoc, nodes: Node[]): string {
  if (nodes.length === 0) return "";
  const body = nodes.flatMap((node) => node.lines).join(doc.eol) + doc.eol;
  return (doc.bom ? "﻿" : "") + body;
}

function parseNodes(text: string): Node[] {
  const lines = text.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();

  const nodes: Node[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (trimmed === "") {
      nodes.push({ kind: "blank", lines: [line] });
      index += 1;
      continue;
    }
    if (trimmed.startsWith("#")) {
      nodes.push({ kind: "comment", lines: [line] });
      index += 1;
      continue;
    }
    const match = /^\s*(?:export\s+)?([A-Za-z_][\w.-]*)\s*=(.*)$/.exec(line);
    if (!match) {
      nodes.push({ kind: "other", lines: [line] });
      index += 1;
      continue;
    }
    const key = match[1] ?? "";
    const parsed = parseValue(lines, index, match[2] ?? "");
    nodes.push({ kind: "entry", lines: lines.slice(index, parsed.end + 1), key, value: parsed.value });
    index = parsed.end + 1;
  }
  return nodes;
}

/** Parses the value that starts on line `start` (right after `=`). Returns the value and the last line it spans. */
function parseValue(lines: string[], start: number, rest: string): { value: string; end: number } {
  const trimmed = rest.replace(/^\s+/, "");
  const quote = trimmed.charAt(0);
  if (quote === '"' || quote === "'") {
    const quoted = readQuoted(lines, start, trimmed.slice(1), quote);
    if (quoted) return quoted;
  }
  return { value: trimmed.replace(/(^|\s)#.*$/, "").trim(), end: start };
}

function readQuoted(
  lines: string[],
  start: number,
  firstLine: string,
  quote: string,
): { value: string; end: number } | undefined {
  // Quoted values may span lines: scan the remainder of the file from the opening quote.
  const src = [firstLine, ...lines.slice(start + 1)].join("\n");
  let out = "";
  let position = 0;
  while (position < src.length) {
    const char = src.charAt(position);
    if (char === quote) {
      return { value: out, end: start + countNewlines(src, position) };
    }
    if (quote === '"' && char === "\\" && position + 1 < src.length) {
      const next = src.charAt(position + 1);
      out += DOUBLE_QUOTE_ESCAPES.get(next) ?? char + next;
      position += 2;
      continue;
    }
    out += char;
    position += 1;
  }
  return undefined;
}

function countNewlines(src: string, end: number): number {
  let count = 0;
  for (let position = 0; position < end; position += 1) {
    if (src.charAt(position) === "\n") count += 1;
  }
  return count;
}

function commentText(node: Node): string {
  return (node.lines[0] ?? "").replace(/^\s*#\s?/, "").trim();
}

function commentNode(text: string): Node {
  const single = text.replace(/\s*\r?\n\s*/g, " ").trim();
  return { kind: "comment", lines: [`# ${single}`] };
}

/** Quotes only when needed: spaces, '#', quotes or newlines. Double-quoted values escape \\, ", \n and \r. */
function formatValue(value: string): string {
  if (!/[\s#"']/.test(value)) return value;
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

/**
 * Sets `key` in a file's nodes: replaces the first entry in place (keeping its attached comment unless
 * `comment` is given), drops later duplicates, or appends. `comment: ""` removes the attached comment.
 */
function upsertEntry(nodes: Node[], key: string, value: string, comment: string | undefined): Node[] {
  const entry: Node = { kind: "entry", lines: [`${key}=${formatValue(value)}`], key, value };
  const first = nodes.findIndex((node) => node.kind === "entry" && node.key === key);
  if (first === -1) {
    const added = comment?.trim() ? [commentNode(comment), entry] : [entry];
    return [...nodes, ...added];
  }

  const attachedIndex = first > 0 && nodes[first - 1]?.kind === "comment" ? first - 1 : -1;
  const attached = attachedIndex === -1 ? undefined : nodes[attachedIndex];
  let commentBlock: Node[];
  if (comment === undefined) commentBlock = attached ? [attached] : [];
  else commentBlock = comment.trim() ? [commentNode(comment)] : [];

  const before = nodes.slice(0, attachedIndex === -1 ? first : attachedIndex);
  const after = removeKeyNodes(nodes.slice(first + 1), key);
  return [...before, ...commentBlock, entry, ...after];
}

/** Drops every entry for `key` together with the comment line directly above it. */
function removeKeyNodes(nodes: Node[], key: string): Node[] {
  const drop = new Set<number>();
  nodes.forEach((node, index) => {
    if (node.kind !== "entry" || node.key !== key) return;
    drop.add(index);
    if (index > 0 && nodes[index - 1]?.kind === "comment") drop.add(index - 1);
  });
  return nodes.filter((_, index) => !drop.has(index));
}
