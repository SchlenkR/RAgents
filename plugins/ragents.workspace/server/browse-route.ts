import {
  implement,
  implementChannel,
  type AccessContext,
  type ChannelContribution,
  type MethodContribution,
} from "@ragents/engine";
import {
  FILE_OPERATIONS,
  listDirectory,
  readTextFile,
  watchDirectory,
  type FileListing,
  type FileText,
  type FileWatchProgress,
} from "@ragents/workspace-executor";
import { withDomainCause, type SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";
import {
  workspaceContracts,
  type BrowseListing,
  type BrowsePreview,
  type BrowseRoot,
} from "../contract.js";

export interface BrowseOptions {
  ensureSession: (runId: string) => void;
  /** Der Arbeitsbereich eines Runs, den nur sein Eigentümer bedient, liegt bei ihm; die Dateiablage des Servers nicht. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  /** Der Arbeitsbereich ist nur über den Executor des Runs erreichbar, wo immer er liegt. */
  execute: SandboxServices["execute"];
  /** Die Dateiablage liegt auf dem Server und gehört nicht zum Arbeitsbereich. */
  documentsFor: (runId: string) => Promise<string>;
  /** Wie die Wurzel eines Runs heißt, etwa mit dem Label seines Arbeitsplatzes. */
  locationOf: (runId: string, location: string) => string;
}

const onServer = async <T>(operation: () => Promise<T>): Promise<T> => {
  try {
    return await operation();
  } catch (error) {
    throw withDomainCause(error);
  }
};

const listingOf = async (options: BrowseOptions, runId: string, root: BrowseRoot, target: string): Promise<BrowseListing> => {
  if (root === "files") {
    const listing = await onServer(async () => listDirectory(await options.documentsFor(runId), target));
    return { root, ...listing };
  }
  const listing = await options.execute(runId, FILE_OPERATIONS.list, { path: target }) as FileListing;
  return { root, ...listing, location: options.locationOf(runId, listing.location) };
};

const previewOf = async (options: BrowseOptions, runId: string, root: BrowseRoot, target: string): Promise<BrowsePreview> => {
  const text = root === "files"
    ? await onServer(async () => readTextFile(await options.documentsFor(runId), target))
    : await options.execute(runId, FILE_OPERATIONS.read, { path: target }) as FileText;
  return { root, ...text };
};

const ensureRoot = (options: BrowseOptions, access: AccessContext, runId: string, root: BrowseRoot): void => {
  if (root === "workspace") options.ensureWorkspaceAccess(access, runId);
  else options.ensureSession(runId);
};

export const createBrowseMethods = (options: BrowseOptions): MethodContribution[] => [
  implement(workspaceContracts.browse.list, ({ runId, root, path: target }, { access }) => {
    ensureRoot(options, access, runId, root);
    return listingOf(options, runId, root, target);
  }),
  implement(workspaceContracts.browse.preview, ({ runId, root, path: target }, { access }) => {
    ensureRoot(options, access, runId, root);
    return previewOf(options, runId, root, target);
  }),
];

/** Nach dem Ende einer laufenden Beobachtung, etwa weil der Arbeitsplatz weg war, versucht der Kanal es in diesem Abstand erneut. */
const WATCH_RETRY_MS = 5_000;

/** Beobachtet den Arbeitsbereich beim Executor des Runs bis zum Abbruch; steht die Beobachtung, ist der Kanal offen, und endet sie, beginnt er eine neue. */
const watchWorkspace = (options: BrowseOptions, runId: string, changed: () => void): Promise<() => void> =>
  new Promise((ready, failed) => {
    const controller = new AbortController();
    let opened = false;
    let retry: NodeJS.Timeout | undefined;
    const stop = (): void => {
      controller.abort();
      clearTimeout(retry);
    };
    const start = (): void => {
      let watching = false;
      const ended = (error?: unknown): void => {
        if (controller.signal.aborted) return;
        if (!opened) {
          failed(error ?? new Error("Die Beobachtung des Arbeitsbereichs endete, bevor sie stand"));
          return;
        }
        // Endet eine laufende Beobachtung, lädt die Ansicht neu und zeigt die Ursache; steht die nächste, lädt sie noch einmal.
        if (watching) changed();
        retry = setTimeout(start, WATCH_RETRY_MS);
      };
      options.execute(runId, FILE_OPERATIONS.watch, {}, {
        signal: controller.signal,
        untilAborted: true,
        onProgress: (value) => {
          if ((value as FileWatchProgress).kind === "changed") changed();
          else if (!watching) {
            watching = true;
            if (opened) changed();
            else {
              opened = true;
              ready(stop);
            }
          }
        },
      }).then(() => ended(), ended);
    };
    start();
  });

export const createBrowseChannel = (options: BrowseOptions): ChannelContribution =>
  implementChannel(workspaceContracts.channels.browse, async ({ runId, root }, emit, { access }) => {
    ensureRoot(options, access, runId, root);
    const changed = (): void => emit({ changed: true });
    if (root === "workspace") return watchWorkspace(options, runId, changed);
    return onServer(async () => watchDirectory(await options.documentsFor(runId), { onChange: changed, onError: changed }));
  });
