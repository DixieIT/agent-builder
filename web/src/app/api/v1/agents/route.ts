import { listAgents, createAgent } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";


export const GET = toHandler(listAgents);
export const POST = toHandler(createAgent);
