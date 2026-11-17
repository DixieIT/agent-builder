import "server-only";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";

/** A folder picked in the browser, sent as text files with their path relative to the picked folder. */
export const uploadedFolderSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(512),
      content: z.string().max(1_000_000, "Files over 1 MB are skipped."),
    }),
  )
  .min(1, "The folder has no importable files.")
  .max(2_000, "Pick a smaller folder (at most 2,000 files).");

export type UploadedFolder = z.infer<typeof uploadedFolderSchema>;

/**
 * Recreates the picked folder (under its own name, which names a single lele agent) in a temporary directory,
 * runs `work` on it, then deletes it. Paths can't escape the folder.
 */
export async function withUploadedFolder<T>(name: string, files: UploadedFolder, work: (dir: string) => Promise<T>): Promise<T> {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "uab-import-"));
  const safeName = path.basename(name).replace(/[^\w.-]+/g, "-") || "folder";
  const root = path.join(tmp, safeName);
  try {
    for (const file of files) {
      const rel = file.path.replaceAll("\\", "/").replace(/^\/+/, "");
      const target = path.resolve(root, rel);
      if (!target.startsWith(root + path.sep)) throw new Error(`"${file.path}" is outside the picked folder.`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, file.content, "utf8");
    }
    return await work(root);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
