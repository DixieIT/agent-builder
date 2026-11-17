import { deleteLibraryItem, getLibraryItem, saveLibraryItem } from "@/server/api/routes";
import { toHandler } from "@/server/http/route";

export const GET = toHandler(getLibraryItem);
export const PUT = toHandler(saveLibraryItem);
export const DELETE = toHandler(deleteLibraryItem);
