import assert from "node:assert/strict";
import test from "node:test";
import { inheritedProcessEnvironment, isolatedWorkstationEnvironment, secretFreeProcessEnvironment, withoutProcessStartupHooks } from "../src/safe-environment.ts";
import { workspaceProcessContext } from "../src/context.ts";

const secrets = [
  "KEY", "KEYS", "TOKEN", "TOKENS", "SECRET", "SECRETS", "PASSWORD", "PASSWD", "PASS", "PAT",
  "CREDENTIAL", "CREDENTIALS", "AUTH", "SESSION", "COOKIE", "PRIVATE",
];

test("isolated launcher environments remove startup code and loader hooks after server additions", () => {
  const source = { NODE_OPTIONS: "--require /project/hook.cjs", LD_PRELOAD: "/project/hook.so", DYLD_INSERT_LIBRARIES: "/project/hook.dylib",
    OPENSSL_CONF: "/project/openssl.cnf", NODE_COMPILE_CACHE: "/outside/cache", PATH: "/usr/bin", LANG: "en_US.UTF-8" };
  assert.deepEqual(withoutProcessStartupHooks(source), { PATH: "/usr/bin", LANG: "en_US.UTF-8" });
  const options = { runId: "startup-run", root: "/project", cwd: "/project", home: { home: "/run/home" }, logDirectory: "/run/tmp", hostRoot: undefined,
    source, additions: { NODE_OPTIONS: "--import /project/added.mjs", LD_AUDIT: "/project/audit.so" }, baseEnvironment: "inherited" as const };
  const isolated = workspaceProcessContext({ ...options, access: { level: "isolated" } });
  assert.equal(isolated.env.NODE_OPTIONS, undefined);
  assert.equal(isolated.env.LD_AUDIT, undefined);
  assert.equal(isolated.env.PATH, "/usr/bin");
  const full = workspaceProcessContext({ ...options, access: { level: "full" } });
  assert.equal(full.env.NODE_OPTIONS, "--import /project/added.mjs");
  assert.equal(full.env.LD_AUDIT, "/project/audit.so");
  assert.equal(source.NODE_OPTIONS, "--require /project/hook.cjs");
});

test("isolated workstation environments remove secret name segments without mutating their source", () => {
  for (const segment of secrets) {
    for (const name of [segment, `${segment}_VALUE`, `EXAMPLE_${segment}`, `example_${segment.toLowerCase()}_value`]) {
      const source = { PATH: "/usr/bin", [name]: "sensitive", SAFE: "normal" };
      assert.deepEqual(secretFreeProcessEnvironment(source), { PATH: "/usr/bin", SAFE: "normal" }, name);
      assert.equal(source[name], "sensitive");
    }
  }
});

test("secret names use underscore boundaries and ignore case, including repeated separators", () => {
  const source = {
    PATH: "/usr/bin", KEYCHAIN_PATH: "/home/user/keychains", MONKEY: "ordinary", TOKENSIZE: "20",
    PASSWORD_STORE_DIR: "/home/user/passwords", npm_config__auth: "sensitive", SSH_AUTH_SOCK: "/tmp/agent.sock",
    GPG_AGENT_INFO: "/tmp/gpg.sock", gpg_agent_info: "/tmp/gpg.sock", PATHEXT: ".EXE", SESSION_ID: "sensitive",
    EMPTY: "", MISSING: undefined,
  };
  assert.deepEqual(secretFreeProcessEnvironment(source), {
    PATH: "/usr/bin", KEYCHAIN_PATH: "/home/user/keychains", MONKEY: "ordinary", TOKENSIZE: "20",
    PATHEXT: ".EXE", EMPTY: "", MISSING: undefined,
  });
});

test("credentials in URLs are removed for every variable and scheme, including within a larger value", () => {
  for (const value of [
    "postgres://u:p@host/db", "https://user:password@host/", "HTTPS://u:p@host", "redis+tls://u:p@host:123/",
    "prefix postgres://u:p@host/db suffix", "https://encoded%40user:p%40ss@host/", "https://u:@host/", "https://:credential@host/",
  ]) {
    assert.deepEqual(secretFreeProcessEnvironment({ DATABASE_URL: value, PATH: "/usr/bin" }), { PATH: "/usr/bin" }, value);
  }
  for (const value of ["postgres://host/db", "https://host:123/path", "https://host/path?user=test", "ordinary:user@example"]) {
    assert.deepEqual(secretFreeProcessEnvironment({ DATABASE_URL: value }), { DATABASE_URL: value });
  }
});

test("isolated workstations keep only toolchain, locale and terminal variables, so secrets with arbitrary names stay out", () => {
  const source = {
    PATH: "/usr/bin", Path: "C:\\Windows", LANG: "en_US.UTF-8", LC_ALL: "C", TERM: "xterm", SHELL: "/bin/zsh", USER: "alice",
    JAVA_HOME: "/opt/java", DOTNET_ROOT: "/opt/dotnet", DOTNET_NOLOGO: "1", FNM_DIR: "/home/alice/.fnm", HOMEBREW_PREFIX: "/opt/homebrew",
    HTTPS_PROXY: "http://proxy:8080", https_proxy: "http://u:p@proxy:8080", HOMEBREW_GITHUB_API_TOKEN: "sensitive",
    EXAMPLE_APIKEY: "sensitive", TEAM_DATABASE_PW: "sensitive", EXAMPLE_SERVICE: "sensitive", MONKEY: "ordinary", SSH_AUTH_SOCK: "/tmp/agent.sock",
  };
  assert.deepEqual(isolatedWorkstationEnvironment(source), {
    PATH: "/usr/bin", Path: "C:\\Windows", LANG: "en_US.UTF-8", LC_ALL: "C", TERM: "xterm", SHELL: "/bin/zsh", USER: "alice",
    JAVA_HOME: "/opt/java", DOTNET_ROOT: "/opt/dotnet", DOTNET_NOLOGO: "1", FNM_DIR: "/home/alice/.fnm", HOMEBREW_PREFIX: "/opt/homebrew",
    HTTPS_PROXY: "http://proxy:8080",
  });
});

test("isolated filtering composes with inherited editor and shell startup filtering while full access keeps credentials", () => {
  const source = { PATH: "/usr/bin", EXAMPLE_TOKEN: "sensitive", VSCODE_IPC_HOOK: "editor", BASH_ENV: "/home/user/startup", ENV: "startup", SAFE: "value" };
  assert.deepEqual(inheritedProcessEnvironment(secretFreeProcessEnvironment(source)), { PATH: "/usr/bin", SAFE: "value" });
  assert.deepEqual(inheritedProcessEnvironment(source), { PATH: "/usr/bin", EXAMPLE_TOKEN: "sensitive", SAFE: "value" });
});
