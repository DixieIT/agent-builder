import { getSystemAgent } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(getSystemAgent);
