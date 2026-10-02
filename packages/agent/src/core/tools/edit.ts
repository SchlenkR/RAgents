import { createHash } from "node:crypto";
import { mkdir as fsMkdir, readFile as fsReadFile, writeFile as fsWriteFile } from "fs/promises";
import { dirname } from "path";
import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../tool-definition.ts";
import { applyEditToNormalizedContent, detectLineEnding, editOutcome, normalizeToLF, restoreLineEndings, stripBom } from "./edit-diff.ts";
import { withFileMutationQueue } from "./file-mutation-queue.ts";
import { resolveToCwd } from "./path-utils.ts";

const editSchema = Type.Object(
	{
		file_path: Type.String({
			description: "The path of the file to modify: relative to the working directory, absolute, or starting with a workspace alias such as @actors",
		}),
		old_string: Type.String({ description: "The text to replace" }),
		new_string: Type.String({ description: "The text to replace it with (must be different from old_string)" }),
		replace_all: Type.Optional(Type.Boolean({ description: "Replace all occurrences of old_string (default false)" })),
	},
	{ additionalProperties: false },
);

export type EditToolInput = Static<typeof editSchema>;

export interface EditToolDetails {
	contentHash: string;
}

/**
 * Pluggable operations for the edit tool.
 * Override these to delegate file editing to remote systems (for example SSH).
 */
export interface EditOperations {
	/** Read file contents as a Buffer; a missing file rejects with the code ENOENT */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Write content to a file */
	writeFile: (absolutePath: string, content: string) => Promise<void>;
	/** Create directory recursively */
	mkdir: (dir: string) => Promise<void>;
}

const defaultEditOperations: EditOperations = {
	readFile: (path) => fsReadFile(path),
	writeFile: (path, content) => fsWriteFile(path, content, "utf-8"),
	mkdir: (dir) => fsMkdir(dir, { recursive: true }).then(() => {}),
};

export interface EditToolOptions {
	/** Custom operations for file editing. Default: local filesystem */
	operations?: EditOperations;
}

const missingFile = (error: unknown): boolean => (error as NodeJS.ErrnoException | undefined)?.code === "ENOENT";

/** Whether an edit would apply to the current text of a file: old_string occurs once, or at least once with replace_all. */
export function editApplies(fileText: string, oldString: string, replaceAll: boolean): boolean {
	return oldString !== "" && editOutcome(normalizeToLF(stripBom(fileText).text), oldString, replaceAll) === "applies";
}

export function createEditToolDefinition(
	cwd: string,
	options?: EditToolOptions,
): ToolDefinition<typeof editSchema, EditToolDetails> {
	const ops = options?.operations ?? defaultEditOperations;
	return {
		name: "edit",
		label: "edit",
		description:
			"Perform an exact string replacement in a file. Read the file with read in this conversation first; editing a file you have not read fails. "
			+ "old_string must match the file exactly, including whitespace and indentation; copy it from the read output without the line number and tab before each line. "
			+ "The edit fails if old_string is not unique in the file: add surrounding lines to make it unique, or set replace_all to change every occurrence. "
			+ "One call makes one replacement; for several changes call edit several times. An empty old_string creates a new file with new_string as its content.",
		parameters: editSchema,
		async execute(_toolCallId, { file_path, old_string, new_string, replace_all }: EditToolInput, signal?: AbortSignal) {
			if (old_string === new_string) {
				throw new Error("No changes to make: old_string and new_string are exactly the same.");
			}
			const absolutePath = resolveToCwd(file_path, cwd);

			return withFileMutationQueue(absolutePath, async () => {
				// An abort listener must not reject here: that would release the queue while a file operation still runs.
				const throwIfAborted = (): void => {
					if (signal?.aborted) throw new Error("Operation aborted");
				};
				const written = async (content: string, text: string) => {
					await ops.writeFile(absolutePath, content);
					throwIfAborted();
					return {
						content: [{ type: "text" as const, text }],
						details: { contentHash: createHash("sha256").update(content).digest("hex") },
					};
				};

				throwIfAborted();
				const buffer = await ops.readFile(absolutePath).catch((error: unknown) => {
					if (missingFile(error)) return undefined;
					throw error;
				});
				throwIfAborted();

				if (buffer === undefined) {
					if (old_string !== "") throw new Error("File does not exist.");
					await ops.mkdir(dirname(absolutePath));
					throwIfAborted();
					return written(new_string, `File created successfully at: ${file_path}`);
				}

				const { bom, text } = stripBom(buffer.toString("utf-8"));
				if (old_string === "") {
					if (text.trim() !== "") throw new Error("Cannot create new file - file already exists.");
					return written(new_string, `The file ${file_path} has been updated successfully.`);
				}

				const newContent = applyEditToNormalizedContent(normalizeToLF(text), old_string, new_string, replace_all === true);
				throwIfAborted();
				return written(
					bom + restoreLineEndings(newContent, detectLineEnding(text)),
					replace_all === true
						? `The file ${file_path} has been updated. All occurrences were successfully replaced.`
						: `The file ${file_path} has been updated successfully.`,
				);
			});
		},
	};
}
