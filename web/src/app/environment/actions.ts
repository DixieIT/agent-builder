"use server";

import { revalidatePath } from "next/cache";
import { envVarInputSchema } from "@/core/environment/environment";
import { DomainError } from "@/core/shared/errors";
import { environmentStore } from "@/server/container";

export type EnvActionResult = { ok: true } | { ok: false; message: string };

export async function setEnvVarAction(input: unknown): Promise<EnvActionResult> {
  const parsed = envVarInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: parsed.error.issues.map((i) => i.message).join(" · ") };
  try {
    await (await environmentStore()).set(parsed.data);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath("/environment");
  return { ok: true };
}

export async function removeEnvVarAction(key: string): Promise<EnvActionResult> {
  try {
    await (await environmentStore()).remove(key);
  } catch (error) {
    return { ok: false, message: messageOf(error) };
  }
  revalidatePath("/environment");
  return { ok: true };
}

function messageOf(error: unknown): string {
  return error instanceof DomainError || error instanceof Error ? error.message : String(error);
}
