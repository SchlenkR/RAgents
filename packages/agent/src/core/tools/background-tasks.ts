import { type Static, Type } from "typebox";
import type { ToolDefinition } from "../tool-definition.ts";
import { BASH_MAX_BYTES, BASH_MAX_LINE_CHARS } from "./bash.ts";
import { DEFAULT_MAX_LINES, formatSize } from "./truncate.ts";

/** Running, or ended: with an exit code, by a signal, and whether task_stop ended it. */
export type BackgroundTaskStatus =
	| { readonly state: "running" }
	| { readonly state: "exited"; readonly exitCode: number | null; readonly signal: string | null; readonly stopped: boolean };

/** What a command wrote since the last read: at most the requested bytes from its end, starting at a line, and how many bytes were left out before them. */
export interface BackgroundTaskOutput {
	readonly text: string;
	readonly skippedBytes: number;
	readonly status: BackgroundTaskStatus;
}

/** Where the background commands of bash live; the host keeps them, the tools only name them by ID. */
export interface BackgroundTaskOperations {
	output: (id: string, options: { maxBytes: number }) => Promise<BackgroundTaskOutput>;
	stop: (id: string) => Promise<BackgroundTaskStatus>;
}

const taskIdSchema = Type.String({ minLength: 1, description: "The ID of the background command, as bash returned it" });

const taskOutputSchema = Type.Object({ task_id: taskIdSchema }, { additionalProperties: false });

const taskStopSchema = Type.Object({ task_id: taskIdSchema }, { additionalProperties: false });

export type TaskOutputToolInput = Static<typeof taskOutputSchema>;

export type TaskStopToolInput = Static<typeof taskStopSchema>;

const unavailable = (name: string): Error =>
	new Error(`${name} is not available: these operations know no background commands of bash.`);

/** The status line that ends every task_output result. */
export const backgroundStatusText = (status: BackgroundTaskStatus): string => {
	if (status.state === "running") return "running";
	if (status.stopped) return "stopped with task_stop";
	return status.exitCode === null ? `ended by signal ${status.signal ?? "unknown"}` : `exited with code ${status.exitCode}`;
};

const shortened = (line: string): string => line.length > BASH_MAX_LINE_CHARS
	? `${line.slice(0, BASH_MAX_LINE_CHARS)} [line shortened, ${line.length - BASH_MAX_LINE_CHARS} more characters]`
	: line;

/** The last lines of the new output with long lines shortened, and how many bytes stayed out in total. */
const visibleOutput = ({ text, skippedBytes }: BackgroundTaskOutput): { text: string; skippedBytes: number } => {
	const lines = (text.endsWith("\n") ? text.slice(0, -1) : text).split("\n");
	const dropped = lines.length > DEFAULT_MAX_LINES ? lines.slice(0, lines.length - DEFAULT_MAX_LINES) : [];
	const kept = lines.slice(dropped.length);
	const droppedBytes = dropped.reduce((sum, line) => sum + Buffer.byteLength(line, "utf-8") + 1, 0);
	return { text: text === "" ? "" : kept.map(shortened).join("\n"), skippedBytes: skippedBytes + droppedBytes };
};

export function createTaskOutputToolDefinition(
	operations?: BackgroundTaskOperations,
): ToolDefinition<typeof taskOutputSchema, undefined> {
	return {
		name: "task_output",
		label: "task_output",
		description: "Read what a background command of bash wrote since the last task_output call, followed by its status: "
			+ "running, or how it ended. Every call returns only new output; if there is more than "
			+ `${BASH_MAX_BYTES / 1024}KB or ${DEFAULT_MAX_LINES} lines, only its end is shown and the result says how much was left out. `
			+ `Lines longer than ${BASH_MAX_LINE_CHARS} characters are shortened. The call does not wait for new output.`,
		parameters: taskOutputSchema,
		async execute(_toolCallId, { task_id }: TaskOutputToolInput) {
			if (!operations) throw unavailable("task_output");
			const output = await operations.output(task_id, { maxBytes: BASH_MAX_BYTES });
			const visible = visibleOutput(output);
			const parts = [
				...visible.skippedBytes > 0 ? [`[${formatSize(visible.skippedBytes)} of earlier output left out]`] : [],
				visible.text === "" ? "(no new output)" : visible.text,
				"",
				`Status: ${backgroundStatusText(output.status)}`,
			];
			return { content: [{ type: "text", text: parts.join("\n") }], details: undefined };
		},
	};
}

export function createTaskStopToolDefinition(
	operations?: BackgroundTaskOperations,
): ToolDefinition<typeof taskStopSchema, undefined> {
	return {
		name: "task_stop",
		label: "task_stop",
		description: "Stop a background command of bash together with everything it started. "
			+ "Stop the dev servers and watchers you started once you no longer need them.",
		parameters: taskStopSchema,
		async execute(_toolCallId, { task_id }: TaskStopToolInput) {
			if (!operations) throw unavailable("task_stop");
			const status = await operations.stop(task_id);
			const text = status.state === "exited" && status.stopped
				? `Stopped background command ${task_id}.`
				: `Background command ${task_id} had already ${backgroundStatusText(status)}.`;
			return { content: [{ type: "text", text }], details: undefined };
		},
	};
}
