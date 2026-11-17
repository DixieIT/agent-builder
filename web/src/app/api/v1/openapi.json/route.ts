import "@/server/api/routes";
import { buildOpenApi } from "@/server/http/openapi";
import { json, registry } from "@/server/http/route";


/** Every declared operation, generated from the route declarations. */
export function GET() {
  return json(
    buildOpenApi([...registry.values()], {
      title: "Ultimate Agent Builder API",
      version: "1.0.0",
      description:
        "Create, edit, import and export agent specs, run agents on Goose, build their container images and inspect the tool servers they use. Errors are RFC 9457 problem details.",
    }),
  );
}
