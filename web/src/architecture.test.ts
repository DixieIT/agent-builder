import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";

/** Enforces the project laws in /CLAUDE.md that a machine can check. */

const WEB = path.resolve(import.meta.dir, "..");
const SRC = path.join(WEB, "src");

/** Source files the layering rules apply to. Tests are composition code and may wire real adapters together. */
function sources(dir: string): string[] {
  return files(dir).filter((file) => !/\.test\.tsx?$/.test(file));
}

function files(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function imports(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  for (const match of source.matchAll(/(?:import|export)\s[^'"]*?from\s+["']([^"']+)["']|import\(\s*["']([^"']+)["']\s*\)|^import\s+["']([^"']+)["']/gm)) {
    found.push(match[1] ?? match[2] ?? match[3]);
  }
  return found;
}

function layerOf(specifier: string, fromFile: string): string | undefined {
  let target = specifier;
  if (specifier.startsWith("@/")) target = path.join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) target = path.resolve(path.dirname(fromFile), specifier);
  else return undefined;
  const rel = path.relative(SRC, target).split(path.sep);
  return rel[0];
}

const rel = (file: string) => path.relative(WEB, file).replaceAll("\\", "/");

describe("ports and adapters", () => {
  test("core imports no outer layer, framework or driver", () => {
    const forbiddenLayers = new Set(["adapters", "server", "app", "components", "hooks"]);
    const forbiddenPackages = /^(next|react|react-dom|mongodb|@modelcontextprotocol\/|node:child_process|node:fs|fs|child_process|server-only)(\/|$)/;
    const violations = sources(path.join(SRC, "core")).flatMap((file) =>
      imports(file)
        .filter((spec) => forbiddenLayers.has(layerOf(spec, file) ?? "") || forbiddenPackages.test(spec))
        .map((spec) => `${rel(file)} -> ${spec}`),
    );
    expect(violations).toEqual([]);
  });

  test("adapters import only core (never app, server, components or another adapter)", () => {
    const violations = sources(path.join(SRC, "adapters")).flatMap((file) => {
      const ownAdapter = path.relative(path.join(SRC, "adapters"), file).split(path.sep)[0];
      return imports(file)
        .filter((spec) => {
          const layer = layerOf(spec, file);
          if (!layer) return false;
          if (["app", "server", "components", "hooks"].includes(layer)) return true;
          if (layer === "adapters") {
            const target = spec.startsWith("@/") ? spec.slice(2) : path.relative(SRC, path.resolve(path.dirname(file), spec));
            return target.replaceAll("\\", "/").split("/")[1] !== ownAdapter;
          }
          return false;
        })
        .map((spec) => `${rel(file)} -> ${spec}`);
    });
    expect(violations).toEqual([]);
  });

  test("only the container (and the CLI composition) imports adapters", () => {
    const allowed = new Set(["src/server/container.ts"]);
    const outside = [...sources(path.join(SRC, "app")), ...sources(path.join(SRC, "components")), ...sources(path.join(SRC, "server")), ...sources(path.join(SRC, "hooks"))];
    const violations = outside
      .filter((file) => !allowed.has(rel(file)))
      .flatMap((file) =>
        imports(file)
          .filter((spec) => layerOf(spec, file) === "adapters" && !/adapters\/goose\/goose-recipe$/.test(spec))
          .map((spec) => `${rel(file)} -> ${spec}`),
      );
    expect(violations).toEqual([]);
  });

  test("every port has at least one adapter implementing it", () => {
    const ports = files(path.join(SRC, "core")).filter((f) => f.endsWith(".port.ts"));
    const adapterSource = files(path.join(SRC, "adapters")).map((f) => readFileSync(f, "utf8")).join("\n");
    const missing = ports.flatMap((file) => {
      // A port is an interface with at least one method (`name(...)`); plain data interfaces are skipped.
      const interfaces = [...readFileSync(file, "utf8").matchAll(/export interface (\w+)[^{]*\{([^}]*)\}/g)]
        .filter((m) => /^\s+(readonly\s+)?\w+\??\(/m.test(m[2].replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")))
        .map((m) => m[1]);
      return interfaces.filter((name) => !new RegExp(`implements[^{]*\\b${name}\\b`).test(adapterSource)).map((name) => `${rel(file)}: ${name}`);
    });
    expect(missing).toEqual([]);
  });
});

describe("api", () => {
  test("API route handlers are generated from defineRoute, never hand-written", () => {
    const apiDir = path.join(SRC, "app", "api", "v1");
    const violations = files(apiDir)
      .filter((file) => file.endsWith("route.ts") && !file.includes("openapi.json"))
      .filter((file) => !readFileSync(file, "utf8").includes("toHandler("))
      .map(rel);
    expect(violations).toEqual([]);
  });
});

describe("tests", () => {
  test("tests are colocated with the feature they test (no top-level test folders)", () => {
    for (const dir of ["test", "tests", "__tests__"]) expect(existsSync(path.join(WEB, dir))).toBe(false);
    const nested = files(SRC).filter((f) => /[\/]__tests__[\/]/.test(f)).map(rel);
    expect(nested).toEqual([]);
  });
});

describe("tooling", () => {
  test("bun is the only package manager", () => {
    const root = path.resolve(WEB, "..");
    for (const lock of ["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]) {
      expect(existsSync(path.join(WEB, lock)) || existsSync(path.join(root, lock))).toBe(false);
    }
    expect(existsSync(path.join(WEB, "bun.lock"))).toBe(true);
    const pkg = JSON.parse(readFileSync(path.join(WEB, "package.json"), "utf8")) as { packageManager?: string };
    expect(pkg.packageManager?.startsWith("bun@")).toBe(true);
  });

  test("shadcn components use the project utils, not a broken alias", () => {
    const broken = files(path.join(SRC, "components", "ui")).filter((f) => /from ["']cn["']/.test(readFileSync(f, "utf8"))).map(rel);
    expect(broken).toEqual([]);
  });

  test("every app route has a skeleton loader", () => {
    const appDir = path.join(SRC, "app");
    const pages = files(appDir).filter((f) => f.endsWith("page.tsx") && path.dirname(f) !== appDir);
    const missing = pages.filter((page) => !existsSync(path.join(path.dirname(page), "loading.tsx"))).map(rel);
    expect(missing).toEqual([]);
  });
});
