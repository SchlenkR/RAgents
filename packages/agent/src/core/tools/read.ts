import { createHash } from "node:crypto";
import type { ImageContent, TextContent } from "@ragents/ai";
import { constants } from "fs";
import { access as fsAccess, readFile as fsReadFile } from "fs/promises";
import { type Static, Type } from "typebox";
import { processImage } from "../../utils/image-process.ts";
import { detectSupportedImageMimeTypeFromFile } from "../../utils/mime.ts";
import type { ToolDefinition } from "../tool-definition.ts";
import { resolveReadPathAsync, type FilePathResolver } from "./path-utils.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, truncateHead } from "./truncate.ts";

export const READ_MAX_LINE_CHARS = 2000;

const readSchema = Type.Object(
	{
		file_path: Type.String({
			description: "The path of the file to read: relative to the working directory, absolute, or starting with a workspace alias such as @actors",
		}),
		offset: Type.Optional(Type.Integer({
			minimum: 0,
			description: "The line number to start reading from (1-based). Only provide if the file is too large to read at once",
		})),
		limit: Type.Optional(Type.Integer({
			minimum: 1,
			description: "The number of lines to read. Only provide if the file is too large to read at once",
		})),
	},
	{ additionalProperties: false },
);

export type ReadToolInput = Static<typeof readSchema>;

export interface ReadToolDetails {
	contentHash: string;
	imageMimeType?: string;
}

/**
 * Pluggable operations for the read tool.
 * Override these to delegate file reading to remote systems (for example SSH).
 */
export interface ReadOperations {
	/** Read file contents as a Buffer */
	readFile: (absolutePath: string) => Promise<Buffer>;
	/** Check if file is readable (throw if not) */
	access: (absolutePath: string) => Promise<void>;
	/** Detect image MIME type, return null or undefined for non-images */
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

const defaultReadOperations: ReadOperations = {
	readFile: (path) => fsReadFile(path),
	access: (path) => fsAccess(path, constants.R_OK),
	detectImageMimeType: detectSupportedImageMimeTypeFromFile,
};

export interface ReadToolOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Custom operations for file reading. Default: local filesystem */
	operations?: ReadOperations;
	resolvePath?: FilePathResolver;
}

/** The lines of a text; a final line break ends the last line instead of starting an empty one. */
const linesOf = (text: string): string[] => {
	if (text === "") return [];
	const lines = text.split("\n").map((line) => line.endsWith("\r") ? line.slice(0, -1) : line);
	return text.endsWith("\n") ? lines.slice(0, -1) : lines;
};

const shortened = (line: string): string =>
	line.length > READ_MAX_LINE_CHARS ? `${line.slice(0, READ_MAX_LINE_CHARS)}... (line truncated to ${READ_MAX_LINE_CHARS} chars)` : line;

/** The selected lines in cat -n style (number, tab, line), at most DEFAULT_MAX_LINES lines and DEFAULT_MAX_BYTES, with a note on how to continue. */
const numberedText = (text: string, offset: number | undefined, limit: number | undefined): string => {
	const lines = linesOf(text);
	if (lines.length === 0) return "Warning: the file exists but the contents are empty.";
	const start = Math.max(1, offset ?? 1);
	if (start > lines.length) {
		return `Warning: the file exists but is shorter than the provided offset (${start}). The file has ${lines.length} lines.`;
	}
	const end = Math.min(lines.length, start - 1 + Math.min(limit ?? DEFAULT_MAX_LINES, DEFAULT_MAX_LINES));
	const numbered = lines.slice(start - 1, end).map((line, index) => `${start + index}\t${shortened(line)}`).join("\n");
	const truncation = truncateHead(numbered);
	const last = start - 1 + truncation.outputLines;
	if (last >= lines.length) return truncation.content;
	const limitNote = truncation.truncatedBy === "bytes" ? ` (${formatSize(DEFAULT_MAX_BYTES)} limit)` : "";
	return `${truncation.content}\n\n[Showing lines ${start}-${last} of ${lines.length}${limitNote}. Use offset=${last + 1} to continue.]`;
};

export function createReadToolDefinition(
	cwd: string,
	options?: ReadToolOptions,
): ToolDefinition<typeof readSchema, ReadToolDetails> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const ops = options?.operations ?? defaultReadOperations;
	const resolvePath = options?.resolvePath ?? resolveReadPathAsync;
	return {
		name: "read",
		label: "read",
		description:
			"Read a file. Results are returned in cat -n format: each line is its line number starting at 1, a tab, then the line as it is in the file. "
			+ `By default it reads up to ${DEFAULT_MAX_LINES} lines from the start of the file; offset and limit read a specific part, and a note names the offset to continue with. `
			+ `Lines longer than ${READ_MAX_LINE_CHARS} characters are truncated, and the output stops at ${DEFAULT_MAX_BYTES / 1024}KB. `
			+ "Images (jpg, png, gif, webp, bmp) are returned as attachments. Do not re-read a file you just edited or wrote to check it: edit and write fail if their change did not apply.",
		parameters: readSchema,
		async execute(
			_toolCallId,
			{ file_path, offset, limit }: ReadToolInput,
			signal?: AbortSignal,
		) {
			return new Promise<{ content: (TextContent | ImageContent)[]; details: ReadToolDetails }>(
				(resolve, reject) => {
					if (signal?.aborted) {
						reject(new Error("Operation aborted"));
						return;
					}
					let aborted = false;
					const onAbort = () => {
						aborted = true;
						reject(new Error("Operation aborted"));
					};
					signal?.addEventListener("abort", onAbort, { once: true });

					(async () => {
						try {
							const absolutePath = await resolvePath(file_path, cwd);
							if (aborted) return;
							await ops.access(absolutePath);
							if (aborted) return;
							const mimeType = ops.detectImageMimeType ? await ops.detectImageMimeType(absolutePath) : undefined;
							const buffer = await ops.readFile(absolutePath);
							const contentHash = createHash("sha256").update(buffer).digest("hex");
							const content: (TextContent | ImageContent)[] = await (async () => {
								if (!mimeType) return [{ type: "text", text: numberedText(buffer.toString("utf-8"), offset, limit) }];
								const processed = await processImage(buffer, mimeType, { autoResizeImages });
								if (!processed.ok) return [{ type: "text", text: `Read image file [${mimeType}]\n${processed.message}` }];
								const note = [`Read image file [${processed.mimeType}]`, ...processed.hints].join("\n");
								return [
									{ type: "text", text: note },
									{ type: "image", data: processed.data, mimeType: processed.mimeType },
								];
							})();

							if (aborted) return;
							signal?.removeEventListener("abort", onAbort);
							resolve({ content, details: { contentHash, ...(mimeType ? { imageMimeType: mimeType } : {}) } });
						} catch (error: any) {
							signal?.removeEventListener("abort", onAbort);
							if (!aborted) reject(error);
						}
					})();
				},
			);
		},
	};
}
