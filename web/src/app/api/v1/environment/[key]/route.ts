import { deleteEnvironmentVariable, setEnvironmentVariable } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const PUT = toHandler(setEnvironmentVariable);
export const DELETE = toHandler(deleteEnvironmentVariable);
