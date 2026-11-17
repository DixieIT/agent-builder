import type { Metadata } from "next";
import { connection } from "next/server";
import { EnvironmentManager } from "@/components/environment/environment-manager";
import { environmentStore } from "@/server/container";

export const metadata: Metadata = { title: "Environment" };

export default async function EnvironmentPage() {
  await connection();
  const store = await environmentStore();
  const vars = await store.list();
  return (
    <EnvironmentManager
      source={store.describe()}
      vars={vars.map((v) => ({ ...v, updatedAt: v.updatedAt.toISOString() }))}
    />
  );
}
