import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";

export const processAlive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
};

export const watchOwnerLifetime = ({ detached = false, parents = [process.ppid], onStop, stdin = process.stdin, signals = process, alive = processAlive, intervalMs = 1000 }) => {
  const releases = [];
  const signalReleases = [];
  let stopped = false;
  const dispose = () => {
    for (const release of releases.splice(0)) release();
  };
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    dispose();
    onStop(reason);
  };
  const listen = (emitter, event, handler, keepDuringStop = false) => {
    emitter.on(event, handler);
    (keepDuringStop ? signalReleases : releases).push(() => emitter.off(event, handler));
  };
  listen(signals, "SIGINT", () => stop("SIGINT"), true);
  listen(signals, "SIGTERM", () => stop("SIGTERM"), true);
  listen(signals, "SIGHUP", () => { if (!detached) stop("SIGHUP"); }, true);
  if (!detached) {
    if (parents.some((pid) => !Number.isSafeInteger(pid) || pid <= 0)) throw new Error("The workspace owner PID must be a positive integer.");
    const check = () => {
      if (parents.some((pid) => !alive(pid))) stop("parent exited");
    };
    const timer = setInterval(check, intervalMs);
    timer.unref();
    releases.push(() => clearInterval(timer));
    listen(signals, "disconnect", () => stop("owner disconnected"));
    if (stdin) {
      listen(stdin, "end", () => stop("stdin closed"));
      listen(stdin, "close", () => stop("stdin closed"));
      listen(stdin, "error", () => stop("stdin failed"));
      stdin.resume();
      releases.push(() => stdin.pause());
      if (stdin.destroyed || stdin.readableEnded) queueMicrotask(() => stop("stdin closed"));
    }
    queueMicrotask(check);
  }
  return () => {
    stopped = true;
    dispose();
    for (const release of signalReleases.splice(0)) release();
  };
};

export const processChildren = (pid = process.pid) => {
  if (process.platform === "win32") {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${pid}' | ForEach-Object { $_.ProcessId }`], { encoding: "utf8", windowsHide: true, timeout: 5000 });
    if (result.status !== 0) throw new Error("Cannot inspect workspace child processes for shutdown.");
    return result.stdout.trim().split(/\s+/).map(Number).filter((child) => child > 0);
  }
  const rows = process.platform === "linux" ? readdirSync("/proc").filter((entry) => /^\d+$/.test(entry)).flatMap((entry) => {
    try {
      const stat = readFileSync(`/proc/${entry}/stat`, "utf8");
      return [[Number(entry), Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1])]];
    } catch (error) {
      if (["ENOENT", "ESRCH", "EACCES"].includes(error.code)) return [];
      throw error;
    }
  }) : (() => {
    const table = spawnSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" });
    if (table.status !== 0) throw new Error("Cannot inspect workspace child processes for shutdown.");
    return table.stdout.trim().split("\n").map((line) => line.trim().split(/\s+/).map(Number));
  })();
  const descendants = (parent) => rows.filter((row) => row[1] === parent).flatMap((row) => [...descendants(row[0]), row[0]]);
  return descendants(pid);
};

export const terminateProcessTree = (pid) => {
  if (process.platform === "win32") {
    const killed = spawnSync("taskkill", ["/T", "/F", "/PID", String(pid)], { stdio: "ignore", windowsHide: true, timeout: 5000 });
    if (killed.status !== 0 && processAlive(pid)) throw new Error(`Could not stop workspace child process ${pid}.`);
    return;
  }
  for (const child of [...processChildren(pid), pid]) {
    try { process.kill(child, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
  }
};

export const exitWorkspaceProcess = (code) => {
  for (const pid of processChildren()) {
    if (process.platform === "win32") terminateProcessTree(pid);
    else {
      try { process.kill(pid, "SIGKILL"); } catch (error) { if (error.code !== "ESRCH") throw error; }
    }
  }
  process.exit(code);
};
