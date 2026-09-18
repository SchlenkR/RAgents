export const PROCESSES_PLUGIN_ID = "ragents.processes";

export interface RunProcessPort {
  port: number;
  address: string;
}

export type RunProcessOrigin = "tool-call" | "background";

export interface RunProcess {
  id: string;
  pid: number;
  label: string;
  command: string;
  origin: RunProcessOrigin;
  ports: RunProcessPort[];
  seenSince: string;
}

export interface RunProcessSnapshot {
  runId: string;
  observedAt: string;
  processes: RunProcess[];
}

export type RunProcessMessage =
  | { kind: "snapshot"; snapshot: RunProcessSnapshot }
  | { kind: "error"; error: string };

export const processesSnapshotPath = (routePrefix: string, runId: string): string =>
  `${routePrefix}/runs/${encodeURIComponent(runId)}/processes`;

export const processesChannel = (runId: string): string => `processes:${runId}`;

export const processesRunIdOf = (channel: string): string | undefined => {
  const match = /^processes:([A-Za-z0-9_-]{1,64})$/.exec(channel);
  return match?.[1];
};

export const processStopPath = (routePrefix: string, runId: string, processId: string): string =>
  `${processesSnapshotPath(routePrefix, runId)}/${encodeURIComponent(processId)}/stop`;
