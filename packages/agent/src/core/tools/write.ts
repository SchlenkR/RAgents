import { constants } from "node:fs";
import { access as fsAccess, mkdir as fsMkdir, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../tool-definition.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";

const writeSchema = Type.Object(
	{
		file_path: Type.String({
			description: "The path of the file to write: relative to the working directory, absolute, or starting with a workspace alias such as @actors",
		}),
		content: Type.String({ description: "The content to write to the file" }),
	},
	{ additionalProperties: false },
);

export type WriteToolInput = Static<typeof writeSchema>;

/**
 * Pluggable operations for the write tool.
 * Override these to delegate file writing to remote systems (for example SSH).
 */
export interface WriteOperations {
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
	/** Whether a file exists at the path */
	exists: (absolutePath: string) => Promise<boolean>;
}

const defaultWriteOperations: WriteOperations = {
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
	exists: (path) => fsAccess(path, constants.F_OK).then(() => true, () => false),
};

export interface WriteToolOptions {
	/** Custom operations for file writing. Default: local filesystem */
	operations?: WriteOperations;
}

export function createWriteToolDefinition(
	cwd: string,
	options?: WriteToolOptions,
): ToolDefinition<typeof writeSchema, undefined> {
	const ops = options?.operations ?? defaultWriteOperations;
	return {
		name: "write",
		label: "write",
		description:
			"Write a file, overwriting it if one exists, and create its parent folders. Overwriting an existing file you have not read with read in this conversation fails. "
			+ "Prefer edit for changes to an existing file; use write for new files or complete rewrites.",
		parameters: writeSchema,
		async execute(_toolCallId, { file_path, content }: WriteToolInput, signal?: AbortSignal) {
			const absolutePath = resolveToCwd(file_path, cwd);
			return withFileMutationQueue(absolutePath, async () => {
				// An abort listener must not reject here: that would release the queue while a file operation still runs.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};

				throwIfAborted();
				const existed = await ops.exists(absolutePath);
				await ops.mkdir(dirname(absolutePath));
				throwIfAborted();
				await ops.writeFile(absolutePath, content);
				throwIfAborted();

				return {
					content: [{
						type: "text",
						text: existed ? `The file ${file_path} has been updated successfully.` : `File created successfully at: ${file_path}`,
					}],
					details: undefined,
				};
			});
		},
	};
}
