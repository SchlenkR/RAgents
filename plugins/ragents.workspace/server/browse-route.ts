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
  /** The workspace of a run that only its owner operates is with the owner; the server's file store is not. */
  ensureWorkspaceAccess: (access: AccessContext, runId: string) => void;
  /** The workspace is reachable only through the run's executor, wherever it is. */
  execute: SandboxServices["execute"];
  /** The file store is on the server and does not belong to the workspace. */
  documentsFor: (runId: string) => Promise<string>;
  /** What the root of a run is called, for example with the label of its workstation. */
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

/** After a running watch ends, for example because the workstation was gone, the channel retries at this interval. */
const WATCH_RETRY_MS = 5_000;

/** Watches the workspace at the run's executor until aborted; once the watch is established the channel is open, and when it ends, it starts a new one. */
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
          failed(error ?? new Error("The workspace watch ended before it was established"));
          return;
        }
        // When a running watch ends, the view reloads and shows the cause; once the next one is established, it reloads again.
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
