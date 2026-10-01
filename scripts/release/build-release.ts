import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout } from "node:timers/promises";
import { run } from "./publish-release.ts";

interface WorkflowRun {
  readonly databaseId: number;
  readonly displayTitle: string;
}

interface BuildTools {
  readonly run: typeof run;
  readonly watch: (id: number) => void;
  readonly pause: () => Promise<void>;
  readonly request: () => string;
}

const watch = (id: number): void => {
  const result = spawnSync("gh", ["run", "watch", String(id), "--exit-status", "--interval", "10"], { stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`Release build ${id} failed. Nothing was published; inspect it with gh run view ${id}.`);
};

export const findRequestedRun = (runs: readonly WorkflowRun[], title: string): number | undefined => {
  const matching = runs.filter((candidate) => candidate.displayTitle === title);
  if (matching.length > 1) throw new Error(`Multiple workflow runs match ${title}`);
  const id = matching[0]?.databaseId;
  if (id !== undefined && (!Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid workflow run ID");
  return id;
};

export const buildRelease = async (version: string, source: string, directory: string, tools: BuildTools = {
  run,
  watch,
  pause: async () => { await setTimeout(2000); },
  request: randomUUID,
}): Promise<void> => {
  const remote = tools.run("gh", ["api", `repos/{owner}/{repo}/commits/${source}`, "--jq", ".sha"]);
  if (remote !== source) throw new Error("Push the release commit to GitHub before building the native archives.");
  const branch = tools.run("gh", ["repo", "view", "--json", "defaultBranchRef", "--jq", ".defaultBranchRef.name"]);
  if (!branch) throw new Error("The repository has no default branch for the release workflow.");
  const request = tools.request();
  const title = `Build release ${version} (${request})`;
  tools.run("gh", ["workflow", "run", "release.yml", "--ref", branch, "-f", `version=${version}`, "-f", `source=${source}`, "-f", `request=${request}`]);
  console.log(`== Building all release artifacts for ${version} from ${source}. Publishing will run locally after the checks pass.`);
  for (let attempt = 0; attempt < 30; attempt++) {
    const runs = JSON.parse(tools.run("gh", ["run", "list", "--workflow", "release.yml", "--event", "workflow_dispatch", "--limit", "100", "--json", "databaseId,displayTitle"])) as WorkflowRun[];
    const id = findRequestedRun(runs, title);
    if (id === undefined) { await tools.pause(); continue; }
    tools.watch(id);
    const result = JSON.parse(tools.run("gh", ["run", "view", String(id), "--json", "displayTitle,conclusion,status"])) as { displayTitle: string; conclusion: string; status: string };
    if (result.displayTitle !== title || result.status !== "completed" || result.conclusion !== "success") throw new Error(`Release build ${id} did not complete successfully. Nothing was published.`);
    tools.run("gh", ["run", "download", String(id), "--name", "release-assets", "--dir", directory]);
    return;
  }
  throw new Error(`The build request ${request} did not appear in GitHub Actions. Inspect gh run list --workflow release.yml before retrying.`);
};
