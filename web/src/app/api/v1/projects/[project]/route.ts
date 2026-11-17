import { getProject, updateProject, deleteProject } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(getProject);
export const PUT = toHandler(updateProject);
export const DELETE = toHandler(deleteProject);
