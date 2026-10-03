# Services inside the server's process sandbox

Status: Idea

## Finding

Verified on 03.10.2026 with `@anthropic-ai/sandbox-runtime` 0.0.77 and the server's real sandbox
host (`ServerProcessSandbox`, `WorkspaceSandboxHost`), the `bash` tool, `processes.snapshot`,
`processes.forward`, and the browser module with Chromium; Linux in a Debian container with
bubblewrap 0.8.0, macOS with Seatbelt. A Node service listens on `127.0.0.1:<port>`.

- Linux: every sandboxed process start gets its own network and PID namespace, and the service
  listens on the loopback of its own command only. There `curl --noproxy '*'` reaches it; a plain
  `curl` goes through the proxy, because `NO_PROXY` is empty, and gets "Connection blocked by
  network allowlist", with an explicit `127.0.0.1:<port>` entry "Bad Gateway", because the proxy
  dials the server's loopback. When the command ends, the service ends too, also when started
  detached in its own session: the PID namespace ends (bwrap with `--unshare-net` alone keeps such
  a child). While the command runs, the rail lists the service without a port, because the process
  table reads listeners from the executor's `/proc/net/tcp` while the socket is only in
  `/proc/<pid>/net/tcp`, and lists the sandbox's inner bwrap, its shell, and two socat relays as
  background processes (`--new-session`). Forwarding fails with `forward-port-unknown`, the browser
  and the server get "connection refused", and so does a later command in its new namespace.
- macOS: the profile allows binding only on the proxy ports, because the host does not set the
  library's `allowLocalBinding`; `listen` fails with `EPERM`.
- Both: `nohup cmd &` ends with the process group of its call anyway; only a detached start, and
  since 03.10.2026 `bash` with `run_in_background`, can outlive a call. With the sandbox off, such a
  service survives on Linux and all four paths work: the rail shows `127.0.0.1:<port>`, a later
  `bash` reaches it, forwarding answers 200,
  `browser_navigate` loads it. On macOS the same holds with `allowLocalBinding: true` set by hand,
  except that a later `bash` needs `curl --noproxy '*'`.

With the sandbox on, the default, no dev server of a server-side run can be opened, and the
showcase walkthrough "Open a short-lived local preview" cannot pass. Workstations have no sandbox.

## Goal

A service a run starts detached on the server keeps running until it ends or the run stops. The
rail shows its port, later processes of the same run reach it on `127.0.0.1:<port>` with a plain
`curl`, and forwarding and the run's browser open it. Other runs and the server's other loopback
ports stay unreachable, and the allowlist for everything else stays.

## Linux: one sandbox per run

- The sandbox host starts per run, at its first process, one long-lived sandbox from the library:
  `wrapWithSandbox` around a small exec agent instead of a command. Every process of the run
  (`bash`, `commands.run`, language servers, the TypeScript platform) starts through the agent and
  thereby in the run's network and PID namespace; stdio, exit code, and signals to the process
  group of a call travel over the agent's Unix socket in the run storage.
- A port bridge in the same sandbox listens on a Unix socket in the run storage and connects to
  `127.0.0.1:<port>` inside. `processes.forward` dials through it; `ProcessSandbox` gets a
  `connect(port)` for that, and without a sandbox the module keeps dialing loopback.
- The Linux process table reads listeners from `/proc/<pid>/net/tcp` and `tcp6` of each marked
  process. Agent, bridge, and relays carry no run marker and stay out of the rail.
- `NO_PROXY` lists loopback, so a plain `curl` to a service stays inside; the own server gets a
  relay inside that tunnels through the proxy (socat `PROXY:`), so its calls stay filtered.
- Browser, two options. Chrome starts through the agent inside the run's namespace with the proxy
  relay as `--proxy-server`, its debugging endpoint reached through the bridge: it reaches the
  run's services directly and everything else under the allowlist, which also narrows the Open
  limit that the browser runs without the sandbox. Or Chrome stays outside and the executor opens
  a loopback listener per opened port that dials the bridge: simpler, but every unsandboxed
  process of the server machine, other runs' browsers included, then reaches the service.
- The sandbox ends on run stop and server shutdown (`--die-with-parent`), with everything in its
  PID namespace; two runs may use the same port number.

A shell prototype confirmed the primitive: two commands sent into one bwrap share its network
namespace, a detached service survives the first, the second reaches it on `127.0.0.1`, the server
reaches it only with `curl --unix-socket` through the bridge, and it ends with the bwrap.

Trade-offs: processes of one run see each other (same trust). Folder rules are computed once per
sandbox, so a folder created later beside a blocked one appears only after the run's sandbox
restarts, unless every command gets a nested bwrap with fresh rules; the library's command for that
would unshare the network again. One more long-lived process per active run, and a process start
becomes a call to the agent instead of a direct spawn.

## macOS

- `allowLocalBinding: true` (library, global) makes all four paths work, verified, but opens
  outbound connections to every loopback port of the machine: the server's own port beside the
  proxy, other runs' services, local databases and tools. Today loopback is closed.
- Narrower: a block of ports per run from a pool of the server, named to the model and allowed
  per command for bind, inbound, and outbound, plus the server's own port, with `NO_PROXY` listing
  loopback as on Linux. Seatbelt can name single ports; the library cannot. A dev server with a
  fixed port outside its block fails with `EPERM`.

## What the library offers

It offers `wrapWithSandbox` per call with its own folder rules, one network policy with proxy and
callback, the paths of the Linux bridge sockets (`getLinuxHttpSocketPath`,
`getLinuxSocksSocketPath`), `allowLocalBinding` (macOS only, one boolean for all calls), and
`allowAllUnixSockets`. It lacks reusing namespaces between calls (every Linux call gets
`--unshare-net`, `--unshare-pid`, `--unshare-user`, `--die-with-parent`, `--new-session`, and its
own socat relays), running a command inside an existing sandbox, and local ports per call on macOS.
bwrap takes `--userns FD` and `--pidns FD` but no network namespace, and starting bwrap after
`nsenter` into a running sandbox failed in both variants tried. The host can build the per-run
sandbox today, because `wrapWithSandbox` wraps any command; fresh folder rules per command inside
it and ports per run on macOS need library changes: a session (create once, run many commands with
their own folder rules) and local ports as a per-call option.

## Alternative: a bridge per service

`bash` with `run_in_background` starts a service in its own bwrap that lives as long as the
service (since 03.10.2026, without a bridge); a relay there would expose its ports as Unix sockets
in the run storage for forwarding, browser, and rail, and the host would start relays from
`127.0.0.1:<port>` to these sockets in every later command it wraps. No library change, but every
service is an island: a frontend reaches its API only through relays that exist before its command
starts, and ports that appear during a command are not relayed into it.

## Open decisions

- One sandbox per run or a bridge per service; a library change upstream or a host-built sandbox.
- macOS: `allowLocalBinding` with its loopback exposure, or a port block per run.
- Whether the browser moves into the run's network namespace.

## Acceptance

On Linux and macOS with the sandbox on: a service started with `run_in_background` keeps
running, its port appears in the rail, a second `bash` call reaches it with a plain `curl`,
`processes.forward` answers 200, and `browser_navigate` loads it; another run does not reach it,
the server's other loopback ports stay blocked, and the run's stop ends it.
