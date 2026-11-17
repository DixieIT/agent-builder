"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { DEFAULT_PROJECT_ID, projectIdSchema, projectInputSchema } from "@/core/projects/project";
import { DomainError } from "@/core/shared/errors";
import type { ImportReport } from "@/core/library/import-service";
import { bundleCodec, projectImportService, projectRepository } from "@/server/container";
import { uploadedFolderSchema, withUploadedFolder } from "@/server/uploaded-folder";

type Failure = { ok: false; message: string };
export type ProjectActionResult = { ok: true } | Failure;

/** Projects appear in the sidebar of every page, so changes revalidate the whole app. */
function revalidateApp() {
  revalidatePath("/", "layout");
}

export async function createProjectAction(input: unknown): Promise<Failure | never> {
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesOf(parsed.error.issues) };
  let id: string;
  try {
    id = (await (await projectRepository()).create(parsed.data)).id;
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidateApp();
  redirect(`/projects/${encodeURIComponent(id)}`);
}

/** Saves the project's name, description and attached systems. */
export async function updateProjectAction(rawId: string, input: unknown): Promise<ProjectActionResult> {
  const id = projectIdSchema.safeParse(rawId);
  if (!id.success) return { ok: false, message: issuesOf(id.error.issues) };
  const parsed = projectInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: issuesOf(parsed.error.issues) };
  try {
    await (await projectRepository()).update(id.data, parsed.data);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidateApp();
  return { ok: true };
}

export async function deleteProjectAction(rawId: string): Promise<Failure | never> {
  const id = projectIdSchema.safeParse(rawId);
  if (!id.success) return { ok: false, message: issuesOf(id.error.issues) };
  try {
    await (await projectRepository()).remove(id.data);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidateApp();
  redirect(`/projects/${DEFAULT_PROJECT_ID}`);
}

/** Imports a folder picked in the browser into one project's own agent store. */
export async function importIntoProjectAction(
  rawId: string,
  folderName: string,
  files: unknown,
): Promise<ImportReport | Failure> {
  const id = projectIdSchema.safeParse(rawId);
  if (!id.success) return { ok: false, message: issuesOf(id.error.issues) };
  const parsed = uploadedFolderSchema.safeParse(files);
  if (!parsed.success) return { ok: false, message: issuesOf(parsed.error.issues) };
  try {
    const [importer, codec] = [await projectImportService(id.data), bundleCodec()];
    const report = await withUploadedFolder(folderName, parsed.data, async (dir) => importer.import(await codec.read(dir)));
    revalidateApp();
    return report;
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
}

function issuesOf(issues: { message: string }[]): string {
  return issues.map((issue) => issue.message).join(" · ");
}

function messageOf(error: unknown): string {
  if (error instanceof DomainError) return error.message;
  if (error instanceof Error) return error.message;
  return String(error);
}
