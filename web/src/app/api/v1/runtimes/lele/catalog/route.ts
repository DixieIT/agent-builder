import { getLeleCatalog } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(getLeleCatalog);
