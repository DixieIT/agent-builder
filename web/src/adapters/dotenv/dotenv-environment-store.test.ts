import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DotenvEnvironmentStore } from "./dotenv-environment-store";

let dir: string;
let store: DotenvEnvironmentStore;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "uab-dotenv-"));
  store = new DotenvEnvironmentStore(dir);
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const file = (name: string) => path.join(dir, name);
const read = (name: string) => readFile(file(name), "utf8");

describe("parsing", () => {
  test("KEY=value, export prefix, blank lines and full-line comments", async () => {
    await writeFile(file(".env.development"), "A=1\n\n# just a note\nexport B=two\n");
    const { values, missing } = await store.resolve("development", ["A", "B", "C"]);
    expect(values).toEqual({ A: "1", B: "two" });
    expect(missing).toEqual(["C"]);
  });

  test("inline comments after unquoted values are stripped, but '#' inside a word is kept", async () => {
    await writeFile(file(".env.development"), "A=abc # trailing\nB=abc#notcomment\nC=#only comment\n");
    const { values } = await store.resolve("development", ["A", "B", "C"]);
    expect(values).toEqual({ A: "abc", B: "abc#notcomment", C: "" });
  });

  test("double quotes decode \\n, \\\", \\\\ and keep '#' and spaces", async () => {
    await writeFile(file(".env.development"), 'A="line1\\nsay \\"hi\\" \\\\ # not comment" # comment\n');
    const { values } = await store.resolve("development", ["A"]);
    expect(values.A).toBe('line1\nsay "hi" \\ # not comment');
  });

  test("single quotes are literal", async () => {
    await writeFile(file(".env.development"), "A='no \\n escapes # here'\n");
    const { values } = await store.resolve("development", ["A"]);
    expect(values.A).toBe("no \\n escapes # here");
  });

  test("multi-line double-quoted values span lines", async () => {
    await writeFile(file(".env.development"), 'KEY="-----BEGIN-----\nabc\n-----END-----"\nNEXT=1\n');
    const { values } = await store.resolve("development", ["KEY", "NEXT"]);
    expect(values).toEqual({ KEY: "-----BEGIN-----\nabc\n-----END-----", NEXT: "1" });
  });

  test("the comment directly above a key becomes its comment; a detached one does not", async () => {
    await writeFile(file(".env"), "# detached\n\n# OpenAI key for agents\nOPENAI_API_KEY=sk-1234567890\nPLAIN=x\n");
    const vars = await store.list();
    expect(vars.find((v) => v.key === "OPENAI_API_KEY")?.comment).toBe("OpenAI key for agents");
    expect(vars.find((v) => v.key === "PLAIN")?.comment).toBeUndefined();
  });
});

describe("precedence and list()", () => {
  test("a shared .env key applies to all environments and the specific file overrides it", async () => {
    await writeFile(file(".env"), "SHARED=base\nOVERRIDDEN=base\n");
    await writeFile(file(".env.production"), "OVERRIDDEN=prod\n");

    expect((await store.resolve("development", ["SHARED", "OVERRIDDEN"])).values).toEqual({
      SHARED: "base",
      OVERRIDDEN: "base",
    });
    expect((await store.resolve("production", ["SHARED", "OVERRIDDEN"])).values).toEqual({
      SHARED: "base",
      OVERRIDDEN: "prod",
    });

    const vars = await store.list();
    const shared = vars.find((v) => v.key === "SHARED");
    expect(shared?.environments).toEqual(["development", "preview", "production"]);
    expect(shared?.value).toBe("base");
    expect(shared?.sensitive).toBe(false);
  });

  test("sensitive keys are masked, plain keys carry their value; environments list only where resolved", async () => {
    await writeFile(file(".env.preview"), "API_TOKEN=abcdefghijklmnop\nFEATURE_FLAG=on\n");
    const vars = await store.list();
    const token = vars.find((v) => v.key === "API_TOKEN");
    expect(token?.sensitive).toBe(true);
    expect(token?.value).toBeUndefined();
    expect(token?.preview).toBe("abc…mnop");
    expect(token?.environments).toEqual(["preview"]);
    const flag = vars.find((v) => v.key === "FEATURE_FLAG");
    expect(flag?.sensitive).toBe(false);
    expect(flag?.value).toBe("on");
  });

  test("a key that differs per environment does not expose a plain value", async () => {
    await writeFile(file(".env.development"), "LOG_LEVEL=debug\n");
    await writeFile(file(".env.production"), "LOG_LEVEL=warn\n");
    const logLevel = (await store.list()).find((v) => v.key === "LOG_LEVEL");
    expect(logLevel?.environments).toEqual(["development", "production"]);
    expect(logLevel?.value).toBeUndefined();
  });

  test("describe() reports a writable folder source", () => {
    expect(store.describe()).toEqual({ kind: "folder", label: `Folder ${dir}`, location: dir, writable: true });
  });

  test("a missing folder lists nothing instead of failing", async () => {
    const empty = new DotenvEnvironmentStore(file("does-not-exist"));
    expect(await empty.list()).toEqual([]);
  });
});

describe("set()", () => {
  test("writes to each selected environment file, creating it when missing", async () => {
    const variable = await store.set({
      key: "API_KEY",
      value: "secret-value",
      environments: ["development", "production"],
      sensitive: true,
    });
    expect(variable.environments).toEqual(["development", "production"]);
    expect(await read(".env.development")).toBe("API_KEY=secret-value\n");
    expect(await read(".env.production")).toBe("API_KEY=secret-value\n");
  });

  test("removes the key from unselected environment files and from the shared .env", async () => {
    await writeFile(file(".env"), "API_KEY=old\nOTHER=1\n");
    await writeFile(file(".env.preview"), "API_KEY=old-preview\n");
    await store.set({ key: "API_KEY", value: "new", environments: ["production"], sensitive: true });

    expect(await read(".env")).toBe("OTHER=1\n");
    expect(await read(".env.preview")).toBe("");
    expect(await read(".env.production")).toBe("API_KEY=new\n");
    const { values } = await store.resolve("development", ["API_KEY"]);
    expect(values).toEqual({});
  });

  test("preserves unrelated lines, ordering and comments when updating an existing key", async () => {
    const original = [
      "# header",
      "FIRST=1",
      "",
      "# the api key",
      "API_KEY=old",
      "LAST=3",
      "",
    ].join("\n");
    await writeFile(file(".env.development"), original);
    await store.set({ key: "API_KEY", value: "new", environments: ["development"], sensitive: true });
    expect(await read(".env.development")).toBe(
      ["# header", "FIRST=1", "", "# the api key", "API_KEY=new", "LAST=3", ""].join("\n"),
    );
  });

  test("updates the comment when one is supplied and keeps it otherwise", async () => {
    await writeFile(file(".env.development"), "# old note\nAPI_KEY=a\n");
    await store.set({ key: "API_KEY", value: "b", environments: ["development"], sensitive: true, comment: "new note" });
    expect(await read(".env.development")).toBe("# new note\nAPI_KEY=b\n");
    await store.set({ key: "API_KEY", value: "c", environments: ["development"], sensitive: true });
    expect(await read(".env.development")).toBe("# new note\nAPI_KEY=c\n");
  });

  test("quotes values with spaces, '#', quotes or newlines and round-trips them", async () => {
    const tricky = 'it "works" # really\nline two';
    await store.set({ key: "MULTI", value: tricky, environments: ["development"], sensitive: false });
    expect(await read(".env.development")).toBe('MULTI="it \\"works\\" # really\\nline two"\n');
    const { values } = await store.resolve("development", ["MULTI"]);
    expect(values.MULTI).toBe(tricky);
  });

  test("plain values are written without quotes", async () => {
    await store.set({ key: "PLAIN", value: "abc123", environments: ["preview"], sensitive: false });
    expect(await read(".env.preview")).toBe("PLAIN=abc123\n");
  });

  test("returns the stored variable as listed", async () => {
    const variable = await store.set({ key: "FLAG", value: "on", environments: ["preview"], sensitive: false });
    expect(variable).toMatchObject({ key: "FLAG", environments: ["preview"], sensitive: false, value: "on" });
  });
});

describe("remove()", () => {
  test("deletes the key and its comment from every file, keeping the rest", async () => {
    await writeFile(file(".env"), "KEEP=1\n# drop me\nDROP=x\n");
    await writeFile(file(".env.production"), "DROP=y\nKEEP2=2\n");
    await store.remove("DROP");
    expect(await read(".env")).toBe("KEEP=1\n");
    expect(await read(".env.production")).toBe("KEEP2=2\n");
    expect((await store.list()).map((v) => v.key)).toEqual(["KEEP", "KEEP2"]);
  });

  test("removing an absent key is a no-op", async () => {
    await writeFile(file(".env"), "A=1\n");
    await store.remove("MISSING");
    expect(await read(".env")).toBe("A=1\n");
  });
});
