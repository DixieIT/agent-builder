"use client";

import "@xyflow/react/dist/style.css";

import { useMemo, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { Controls, MarkerType, Position, ReactFlow, type Edge, type Node } from "@xyflow/react";

/** `href` overrides the default link to the agent in its system (e.g. an agent of an attached system). */
export type GraphAgent = { id: string; name: string; capabilityCount: number; href?: string };
export type GraphEdge = { from: string; to: string; via: string };

const NODE_WIDTH = 200;
const NODE_HEIGHT = 56;
const COLUMN_GAP = 260;
const ROW_GAP = 84;

/**
 * Columns by delegation depth: agents nobody delegates to (the delegators) sit on the left,
 * and each sub-agent sits one column further right than the closest agent that calls it.
 * Agents caught in a cycle with no entry point land in the first column.
 */
function layout(agents: GraphAgent[], edges: GraphEdge[]): { depth: Map<string, number>; column: Map<string, GraphAgent[]> } {
  const incoming = new Map(agents.map((a) => [a.id, 0]));
  const outgoing = new Map(agents.map((a) => [a.id, [] as string[]]));
  for (const edge of edges) {
    outgoing.get(edge.from)?.push(edge.to);
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const delegates = (id: string) => (outgoing.get(id)?.length ?? 0) > 0;
  const roots = agents
    .filter((a) => incoming.get(a.id) === 0)
    .sort((a, b) => Number(delegates(b.id)) - Number(delegates(a.id)));

  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const root of roots) {
    depth.set(root.id, 0);
    queue.push(root.id);
  }
  while (queue.length) {
    const id = queue.shift() as string;
    const next = (depth.get(id) ?? 0) + 1;
    for (const child of outgoing.get(id) ?? []) {
      if (!depth.has(child)) {
        depth.set(child, next);
        queue.push(child);
      }
    }
  }
  for (const agent of agents) if (!depth.has(agent.id)) depth.set(agent.id, 0);

  const column = new Map<string, GraphAgent[]>();
  for (const agent of agents) {
    const index = depth.get(agent.id) ?? 0;
    column.set(String(index), [...(column.get(String(index)) ?? []), agent]);
  }
  return { depth, column };
}

function toFlow(agents: GraphAgent[], edges: GraphEdge[], system: string) {
  const { depth, column } = layout(agents, edges);
  const tallest = Math.max(...[...column.values()].map((list) => list.length), 1);

  const nodes: Node[] = agents.map((agent) => {
    const index = depth.get(agent.id) ?? 0;
    const members = column.get(String(index)) ?? [agent];
    const row = members.indexOf(agent);
    const offset = ((tallest - members.length) * ROW_GAP) / 2;
    return {
      id: agent.id,
      position: { x: index * COLUMN_GAP, y: offset + row * ROW_GAP },
      sourcePosition: Position.Right,
      targetPosition: Position.Left,
      data: {
        label: (
          <span className="flex min-w-0 flex-col gap-0.5 text-left">
            <span className="truncate font-medium">{agent.name}</span>
            <span className="text-xs text-muted-foreground">
              {agent.capabilityCount === 1 ? "1 capability" : `${agent.capabilityCount} capabilities`}
            </span>
          </span>
        ),
      },
      style: {
        width: NODE_WIDTH,
        minHeight: NODE_HEIGHT,
        padding: "8px 12px",
        fontSize: 13,
        color: "var(--foreground)",
        background: "var(--card)",
        border: "1px solid var(--border)",
        borderRadius: 16,
        cursor: "pointer",
      } satisfies CSSProperties,
      ariaLabel: `${agent.name}, open agent`,
    };
  });

  const flowEdges: Edge[] = edges.map((edge) => ({
    id: `${edge.from}->${edge.to}`,
    source: edge.from,
    target: edge.to,
    ariaLabel: `${edge.from} delegates to ${edge.to} via ${edge.via}`,
    markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    style: { stroke: "var(--muted-foreground)", strokeWidth: 1.25 },
  }));

  return { nodes, edges: flowEdges, system };
}

const THEME_VARIABLES = {
  "--xy-background-color-default": "transparent",
  "--xy-edge-stroke-default": "var(--muted-foreground)",
  "--xy-controls-button-background-color-default": "var(--card)",
  "--xy-controls-button-background-color-hover-default": "var(--accent)",
  "--xy-controls-button-color-default": "var(--foreground)",
  "--xy-controls-button-border-color-default": "var(--border)",
} as CSSProperties;

export function AgentGraph({ system, agents, edges }: { system: string; agents: GraphAgent[]; edges: GraphEdge[] }) {
  const router = useRouter();
  const flow = useMemo(() => toFlow(agents, edges, system), [agents, edges, system]);
  const hrefs = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.href ?? `/systems/${encodeURIComponent(system)}/${encodeURIComponent(agent.id)}`])),
    [agents, system],
  );

  if (agents.length === 0) {
    return <p className="text-sm text-muted-foreground">No agents to draw.</p>;
  }

  return (
    <div className="h-[560px] w-full overflow-hidden rounded-2xl border bg-background/50" style={THEME_VARIABLES}>
      <ReactFlow
        nodes={flow.nodes}
        edges={flow.edges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable={false}
        onNodeClick={(_, node) => {
          const href = hrefs.get(node.id);
          if (href) router.push(href);
        }}
      >
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
