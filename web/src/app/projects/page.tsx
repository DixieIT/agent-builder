import { redirect } from "next/navigation";
import { DEFAULT_PROJECT_ID } from "@/core/projects/project";

export default function ProjectsPage() {
  redirect(`/projects/${DEFAULT_PROJECT_ID}`);
}
