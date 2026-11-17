import { validateAgentSpecRoute } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";


export const POST = toHandler(validateAgentSpecRoute);
