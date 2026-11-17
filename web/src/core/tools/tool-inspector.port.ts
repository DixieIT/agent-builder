/**
 * Port: discover the tools a tool server exposes.
 * Harness-agnostic: it speaks in transports, not in Goose or Pydantic AI terms.
 */

export type ToolSource =
  | {
      transport: "stdio";
      command: string;
      args: string[];
      env: Record<string, string>;
      cwd?: string;
      timeoutMs: number;
    }
  | {
      transport: "http";
      url: string;
      headers: Record<string, string>;
      timeoutMs: number;
    };

export interface JsonSchemaObject {
  type?: string;
  properties?: Record<string, JsonSchemaProperty>;
  required?: string[];
  [key: string]: unknown;
}

export interface JsonSchemaProperty {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  default?: unknown;
  items?: JsonSchemaProperty;
  [key: string]: unknown;
}

export interface ToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema: JsonSchemaObject;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
}

export type InspectionResult =
  | {
      status: "ok";
      server: { name: string; version: string };
      instructions?: string;
      tools: ToolDescriptor[];
      durationMs: number;
    }
  | { status: "error"; message: string; stderr?: string; durationMs: number };

export interface ToolInspector {
  inspect(source: ToolSource): Promise<InspectionResult>;
}
