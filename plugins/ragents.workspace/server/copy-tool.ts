import { Type } from "typebox";
import { defineRunFunction, type RunFunction } from "@ragents/engine";
import { BYTE_OPERATIONS, FILE_BYTES_LIMIT, FILE_COUNT_LIMIT, type FileBytes } from "@ragents/workspace-executor";
import { alwaysAvailable } from "@ragents/host/plugin-support/tool-availability.js";
import type { SandboxServices } from "@ragents/host/plugin-support/workspace-sandbox-host.js";

const reference = "named exactly as read names a file: relative to the working directory, absolute in a root of the run, or starting with an alias such as @documents";

/** Reads at the machine of the source and writes at the machine of the destination; the bytes travel through the server, never through the model. */
export const createCopyTool = (sandbox: Pick<SandboxServices, "execute">): RunFunction =>
  defineRunFunction({
    name: "copy",
    label: "Copy",
    description: "Copy a file or a folder within the roots of the run, unchanged and binary-safe, also between the workstation and the server.",
    longDescription: "Use it to move evidence and reports between the working directory and @documents instead of retyping files. "
      + "The destination names the copy itself, not a folder to put it in; a folder is copied with everything in it, and existing "
      + `files at the destination are overwritten. One call carries at most ${FILE_BYTES_LIMIT / 1024 / 1024} MiB and ${FILE_COUNT_LIMIT} files.`,
    schema: Type.Object({
      source: Type.String({ minLength: 1, description: `The file or folder to copy, ${reference}` }),
      destination: Type.String({ minLength: 1, description: `Where the copy goes, ${reference}; only a writable root, never @skills` }),
    }, { additionalProperties: false }),
    resultSchema: Type.String(),
    available: alwaysAvailable,
    executionMode: "sequential",
    run: async ({ caller, signal }, toolCallId, input) => {
      const call = { toolCallId, ...(signal ? { signal } : {}) };
      const content = await sandbox.execute(caller.runId, BYTE_OPERATIONS.read, { path: input.source, recursive: true }, call) as FileBytes;
      await sandbox.execute(caller.runId, BYTE_OPERATIONS.write, { path: input.destination, content }, call);
      const count = content.kind === "file" ? 1 : content.files.length;
      return `Copied ${count} ${count === 1 ? "file" : "files"}.`;
    },
  });
