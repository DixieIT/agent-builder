import { plugin } from "bun";

/**
 * Tests run outside Next.js, where `server-only` throws on import. Server code (adapters, container) is
 * still server code here, so resolve it to an empty module, as the `react-server` condition does for the CLI.
 */
plugin({
  name: "server-only (tests)",
  setup(build) {
    build.module("server-only", () => ({ contents: "export {};", loader: "js" }));
  },
});
