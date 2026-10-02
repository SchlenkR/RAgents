import { constants } from "node:fs";
import { access as fsAccess } from "node:fs/promises";
import { spawn } from "child_process";
import { type Static, Type } from "typebox";
import { waitForChildProcess } from "../../utils/child-process.ts";
import { resolvePath } from "../../utils/paths.ts";
import { getShellConfig, killProcessTree } from "../../utils/shell.ts";
import type { ToolDefinition } from "../tool-definition.ts";
import { OutputAccumulator } from "./output-accumulator.ts";
import { DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./truncate.ts";

export const BASH_MAX_BYTES = 20 * 1024;
export const BASH_MAX_LINE_CHARS = 1000;
export const BASH_DEFAULT_TIMEOUT_MS = 120_000;
export const BASH_MAX_TIMEOUT_MS = 3_600_000;

function checkedTimeoutMs(timeout: number, label: string): number {
	if (!Number.isFinite(timeout) || timeout <= 0) {
		throw new Error(`Invalid ${label} ${timeout}: must be a positive number of milliseconds`);
	}
	if (timeout > BASH_MAX_TIMEOUT_MS) {
		throw new Error(`Invalid ${label} ${timeout}: the maximum is ${BASH_MAX_TIMEOUT_MS} milliseconds`);
	}
	return timeout;
}

const bashSchemaFor = (defaultTimeoutMs: number) => Type.Object({
	command: Type.String({ description: "The command to execute" }),
	timeout: Type.Optional(Type.Number({
		exclusiveMinimum: 0,
		maximum: BASH_MAX_TIMEOUT_MS,
		default: defaultTimeoutMs,
		description: `Optional timeout in milliseconds (default ${defaultTimeoutMs}, max ${BASH_MAX_TIMEOUT_MS})`,
	})),
	description: Type.Optional(Type.String({
		description: "Clear, concise description of what this command does in active voice, 5-10 words, for example \"List files in current directory\"; the user reads it, often without seeing the command",
	})),
	run_in_background: Type.Optional(Type.Boolean({
		description: "Not available here: true is rejected, because a call ends with its command. Run long commands in the foreground with a larger timeout",
	})),
	cwd: Type.Optional(Type.String({ description: "Folder to run the command in: relative to the working directory or starting with a workspace alias such as @actors/<name>; defaults to the working directory" })),
}, { additionalProperties: false });

type BashSchema = ReturnType<typeof bashSchemaFor>;

export type BashToolInput = Static<BashSchema>;

const backgroundUnavailable = `run_in_background is not available: a bash call ends with its command, and the processes left in its process group end with it. Run the command in the foreground with a timeout of up to ${BASH_MAX_TIMEOUT_MS} ms, or split it into shorter steps.`;

const timeoutNotice = (milliseconds: number): string => milliseconds < BASH_MAX_TIMEOUT_MS
	? `Command stopped after ${milliseconds} ms (timeout). Narrow the command, for example search with rg instead of grep -r, or pass a larger timeout, up to ${BASH_MAX_TIMEOUT_MS} ms.`
	: `Command stopped after ${milliseconds} ms, the maximum timeout. Narrow the command, for example search with rg instead of grep -r, or split it into shorter steps.`;


export interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

/**
 * Pluggable operations for the bash tool.
 * Override these to delegate command execution to remote systems (for example SSH).
 */
export interface BashOperations {
	/**
	 * Execute a command and stream output.
	 * @param command The command to execute
	 * @param cwd Working directory
	 * @param options Execution options
	 * @returns Promise resolving to exit code (null if killed)
	 */
	exec: (
		command: string,
		cwd: string,
		options: {
			onData: (data: Buffer) => void;
			signal?: AbortSignal;
			/** Milliseconds until the command is stopped. */
			timeoutMs: number;
			env?: NodeJS.ProcessEnv;
		},
	) => Promise<{ exitCode: number | null }>;
}

/** Bash operations on the built-in local shell. */
export function createLocalBashOperations(options?: { shellPath?: string }): BashOperations {
	return {
		exec: async (command, cwd, { onData, signal, timeoutMs, env }) => {
			if (signal?.aborted) {
				throw new Error("aborted");
			}
			const shellConfig = getShellConfig(options?.shellPath);
			try {
				await fsAccess(cwd, constants.F_OK);
			} catch {
				throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
			}

			const child = spawn(shellConfig.shell, [...shellConfig.args, command], {
				cwd,
				detached: process.platform !== "win32",
				env: env ?? process.env,
				stdio: ["ignore", "pipe", "pipe"],
				windowsHide: true,
			});
			let timedOut = false;
			const onAbort = () => {
				if (child.pid) killProcessTree(child.pid);
			};
			const timeoutHandle = setTimeout(() => {
				timedOut = true;
				if (child.pid) killProcessTree(child.pid);
			}, timeoutMs);

			try {
				// Stream stdout and stderr.
				child.stdout?.on("data", onData);
				child.stderr?.on("data", onData);
				// Handle abort signal by killing the entire process tree.
				if (signal) {
					if (signal.aborted) onAbort();
					else signal.addEventListener("abort", onAbort, { once: true });
				}
				// Handle shell spawn errors and wait for the process to terminate without hanging
				// on inherited stdio handles held by detached descendants.
				const exitCode = await waitForChildProcess(child);
				if (signal?.aborted) {
					throw new Error("aborted");
				}
				if (timedOut) {
					throw new Error(`timeout:${timeoutMs}`);
				}
				return { exitCode };
			} finally {
				clearTimeout(timeoutHandle);
				if (signal) signal.removeEventListener("abort", onAbort);
			}
		},
	};
}

export interface BashSpawnContext {
	command: string;
	cwd: string;
	env: NodeJS.ProcessEnv;
}

export type BashSpawnHook = (context: BashSpawnContext) => BashSpawnContext;

function resolveSpawnContext(command: string, cwd: string, spawnHook?: BashSpawnHook): BashSpawnContext {
	const baseContext: BashSpawnContext = { command, cwd, env: { ...process.env } };
	return spawnHook ? spawnHook(baseContext) : baseContext;
}

export interface BashToolOptions {
	/** Custom operations for command execution. Default: local shell */
	operations?: BashOperations;
	/** Command prefix prepended to every command (for example shell setup commands) */
	commandPrefix?: string;
	/** Optional explicit shell path from settings */
	shellPath?: string;
	/** Hook to adjust command, cwd, or env before execution */
	spawnHook?: BashSpawnHook;
	/** Timeout in milliseconds for a call without one, at most BASH_MAX_TIMEOUT_MS. Default: BASH_DEFAULT_TIMEOUT_MS */
	defaultTimeoutMs?: number;
}

const BASH_UPDATE_THROTTLE_MS = 100;

export function createBashToolDefinition(
	cwd: string,
	options?: BashToolOptions,
): ToolDefinition<BashSchema, BashToolDetails | undefined> {
	const ops = options?.operations ?? createLocalBashOperations({ shellPath: options?.shellPath });
	const commandPrefix = options?.commandPrefix;
	const spawnHook = options?.spawnHook;
	const defaultTimeoutMs = checkedTimeoutMs(options?.defaultTimeoutMs ?? BASH_DEFAULT_TIMEOUT_MS, "default timeout");
	return {
		name: "bash",
		label: "bash",
		description: "Execute a bash command in the working directory, or in the folder given as cwd. Every call starts there; a cd does not carry over to the next call. "
			+ "Returns stdout and stderr; a nonzero exit code is reported at the end of the result (for example grep without a match), not as a tool error. "
			+ `Output is truncated to the last ${DEFAULT_MAX_LINES} lines or ${BASH_MAX_BYTES / 1024}KB (whichever is hit first), and lines longer than ${BASH_MAX_LINE_CHARS} characters are shortened. If anything was cut, the full output is saved to a temp file. `
			+ "rg searches recursively by default; its -r flag means replace and rewrites every match, it does not mean recursive. "
			+ `A command is stopped after ${defaultTimeoutMs} ms unless you pass a larger timeout in milliseconds (at most ${BASH_MAX_TIMEOUT_MS}); builds, test runs, installs and other long commands need one. `
			+ "Commands cannot run in the background: a call returns when its command has finished.",
		parameters: bashSchemaFor(defaultTimeoutMs),
		async execute(
			_toolCallId,
			{ command, timeout, run_in_background, cwd: folder }: BashToolInput,
			signal?: AbortSignal,
			onUpdate?,
		) {
			if (run_in_background === true) throw new Error(backgroundUnavailable);
			const timeoutMs = timeout === undefined ? defaultTimeoutMs : checkedTimeoutMs(timeout, "timeout");
			const resolvedCommand = commandPrefix ? `${commandPrefix}\n${command}` : command;
			const spawnContext = resolveSpawnContext(resolvedCommand, folder === undefined ? cwd : resolvePath(folder, cwd), spawnHook);
			const output = new OutputAccumulator({ maxBytes: BASH_MAX_BYTES, maxLineChars: BASH_MAX_LINE_CHARS, tempFilePrefix: "agent-bash" });
			let acceptingOutput = true;
			let updateTimer: NodeJS.Timeout | undefined;
			let updateDirty = false;
			let lastUpdateAt = 0;

			const emitOutputUpdate = () => {
				if (!onUpdate || !updateDirty) return;
				updateDirty = false;
				lastUpdateAt = Date.now();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				onUpdate({
					content: [{ type: "text", text: snapshot.content || "" }],
					details: {
						truncation: snapshot.truncation.truncated ? snapshot.truncation : undefined,
						fullOutputPath: snapshot.fullOutputPath,
					},
				});
			};

			const clearUpdateTimer = () => {
				if (updateTimer) {
					clearTimeout(updateTimer);
					updateTimer = undefined;
				}
			};

			const scheduleOutputUpdate = () => {
				if (!onUpdate) return;
				updateDirty = true;
				const delay = BASH_UPDATE_THROTTLE_MS - (Date.now() - lastUpdateAt);
				if (delay <= 0) {
					clearUpdateTimer();
					emitOutputUpdate();
					return;
				}
				updateTimer ??= setTimeout(() => {
					updateTimer = undefined;
					emitOutputUpdate();
				}, delay);
			};

			if (onUpdate) {
				onUpdate({ content: [], details: undefined });
			}

			const handleData = (data: Buffer) => {
				if (!acceptingOutput) return;
				output.append(data);
				scheduleOutputUpdate();
			};

			const finishOutput = async () => {
				acceptingOutput = false;
				output.finish();
				clearUpdateTimer();
				emitOutputUpdate();
				const snapshot = output.snapshot({ persistIfTruncated: true });
				await output.closeTempFile();
				return snapshot;
			};

			const formatOutput = (snapshot: Awaited<ReturnType<typeof finishOutput>>, emptyText = "(no output)") => {
				const truncation = snapshot.truncation;
				let text = snapshot.content || emptyText;
				let details: BashToolDetails | undefined;
				if (truncation.truncated) {
					details = { truncation, fullOutputPath: snapshot.fullOutputPath };
					const startLine = truncation.totalLines - truncation.outputLines + 1;
					const endLine = truncation.totalLines;
					if (truncation.lastLinePartial) {
						const lastLineSize = formatSize(output.getLastLineBytes());
						text += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${snapshot.fullOutputPath}]`;
					} else if (truncation.truncatedBy === "lines") {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${snapshot.fullOutputPath}]`;
					} else {
						text += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(BASH_MAX_BYTES)} limit). Full output: ${snapshot.fullOutputPath}]`;
					}
				} else if (output.hasShortenedLines()) {
					details = { fullOutputPath: snapshot.fullOutputPath };
					text += `\n\n[Lines longer than ${BASH_MAX_LINE_CHARS} characters are shortened. Full output: ${snapshot.fullOutputPath}]`;
				}
				return { text, details };
			};

			const appendStatus = (text: string, status: string) => `${text ? `${text}\n\n` : ""}${status}`;

			try {
				let exitCode: number | null;
				try {
					const result = await ops.exec(spawnContext.command, spawnContext.cwd, {
						onData: handleData,
						signal,
						timeoutMs,
						env: spawnContext.env,
					});
					exitCode = result.exitCode;
				} catch (err) {
					const snapshot = await finishOutput();
					const { text } = formatOutput(snapshot, "");
					if (err instanceof Error && err.message === "aborted") {
						throw new Error(appendStatus(text, "Command aborted"));
					}
					if (err instanceof Error && err.message.startsWith("timeout:")) {
						throw new Error(appendStatus(text, timeoutNotice(timeoutMs)));
					}
					throw err;
				}

				const snapshot = await finishOutput();
				const { text: outputText, details } = formatOutput(snapshot);
				const text = exitCode !== 0 && exitCode !== null ? appendStatus(outputText, `Command exited with code ${exitCode}`) : outputText;
				return { content: [{ type: "text", text }], details };
			} finally {
				clearUpdateTimer();
			}
		},

	};
}
