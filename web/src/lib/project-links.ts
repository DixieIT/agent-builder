/** The project's own agents are the "project" system; attached systems are addressed by their id with `?system=`. */
export const OWN_SYSTEM_ID = "project";

export function projectAgentHref(projectId: string, systemId: string, agentId: string): string {
  const path = `/projects/${encodeURIComponent(projectId)}/agents/${encodeURIComponent(agentId)}`;
  return systemId === OWN_SYSTEM_ID ? path : `${path}?system=${encodeURIComponent(systemId)}`;
}
