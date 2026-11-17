import { listProjects, createProject } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(listProjects);
export const POST = toHandler(createProject);
