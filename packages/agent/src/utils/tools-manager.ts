import { spawnSync } from "child_process";
import { existsSync } from "fs";
import { platform } from "os";
import { join } from "path";
import { getBinDir } from "../config.ts";

const TOOLS_DIR = getBinDir();

interface ToolConfig {
	name: string;
	binaryName: string;
	systemBinaryNames?: string[];
	installHint: string;
}

const TOOLS: Record<"fd" | "rg", ToolConfig> = {
	fd: {
		name: "fd",
		binaryName: "fd",
		systemBinaryNames: ["fd", "fdfind"],
		installHint: "brew install fd (macOS) bzw. apt install fd-find (Debian/Ubuntu)",
	},
	rg: {
		name: "ripgrep",
		binaryName: "rg",
		installHint: "brew install ripgrep (macOS) bzw. apt install ripgrep (Debian/Ubuntu)",
	},
};

function commandExists(cmd: string): boolean {
	try {
		const result = spawnSync(cmd, ["--version"], { stdio: "pipe" });
		return result.error === undefined || result.error === null;
	} catch {
		return false;
	}
}

export function getToolPath(tool: "fd" | "rg"): string | null {
	const config = TOOLS[tool];
	if (!config) return null;

	const localPath = join(TOOLS_DIR, config.binaryName + (platform() === "win32" ? ".exe" : ""));
	if (existsSync(localPath)) {
		return localPath;
	}

	const systemBinaryNames = config.systemBinaryNames ?? [config.binaryName];
	for (const systemBinaryName of systemBinaryNames) {
		if (commandExists(systemBinaryName)) {
			return systemBinaryName;
		}
	}

	return null;
}

export function requireToolPath(tool: "fd" | "rg"): string {
	const resolved = getToolPath(tool);
	if (resolved) return resolved;
	const config = TOOLS[tool];
	throw new Error(`${config.name} ist nicht installiert. Bitte einrichten: ${config.installHint}`);
}
