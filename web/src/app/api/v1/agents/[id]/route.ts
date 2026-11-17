import { getAgent, saveAgent, deleteAgent } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";


export const GET = toHandler(getAgent);
export const PUT = toHandler(saveAgent);
export const DELETE = toHandler(deleteAgent);
