import { listLibraryItems } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(listLibraryItems);
