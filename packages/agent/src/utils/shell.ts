import { existsSync } from "node:fs";
import { spawn, spawnSync } from "child_process";

export interface ShellConfig {
	shell: string;
	args: string[];
}

/** No startup file of the user reaches a command; BASH_ENV, the one file `bash -c` reads, is the caller's business. */
const BASH_ARGS: readonly string[] = ["--noprofile", "--norc", "-c"];

function findBashOnPath(): string | null {
	try {
		const result = spawnSync("which", ["bash"], { encoding: "utf-8", timeout: 5000 });
		if (result.status === 0 && result.stdout) {
			const firstMatch = result.stdout.trim().split(/\r?\n/)[0];
			if (firstMatch) {
				return firstMatch;
			}
		}
	} catch {
		// Ignore errors
	}
	return null;
}

/**
 * Resolve the bash to run commands with.
 * Resolution order:
 * 1. The explicit shell path
 * 2. On Windows: nothing, the caller brings its own bash and names it
 * 3. On Unix: /bin/bash, then bash on PATH
 */
export function getShellConfig(customShellPath?: string, platform: NodeJS.Platform = process.platform): ShellConfig {
	if (customShellPath) {
		if (existsSync(customShellPath)) {
			return { shell: customShellPath, args: [...BASH_ARGS] };
		}
		throw new Error(`Custom shell path not found: ${customShellPath}`);
	}
	if (platform === "win32") {
		throw new Error("No bash path given. On Windows the bash is never searched for; the caller has to name the bash it brings along.");
	}
	if (existsSync("/bin/bash")) {
		return { shell: "/bin/bash", args: [...BASH_ARGS] };
	}
	const bashOnPath = findBashOnPath();
	if (bashOnPath) {
		return { shell: bashOnPath, args: [...BASH_ARGS] };
	}
	throw new Error("No bash found: neither /bin/bash nor bash on the PATH.");
}

/**
 * Kill a process and all its children (cross-platform)
 */
export function killProcessTree(pid: number): void {
	if (process.platform === "win32") {
		// Use taskkill on Windows to kill process tree
		try {
			spawn("taskkill", ["/F", "/T", "/PID", String(pid)], {
				stdio: "ignore",
				detached: true,
				windowsHide: true,
			});
		} catch {
			// Ignore errors if taskkill fails
		}
	} else {
		// Use SIGKILL on Unix/Linux/Mac
		try {
			process.kill(-pid, "SIGKILL");
		} catch {
			// Fallback to killing just the child if process group kill fails
			try {
				process.kill(pid, "SIGKILL");
			} catch {
				// Process already dead
			}
		}
	}
}
