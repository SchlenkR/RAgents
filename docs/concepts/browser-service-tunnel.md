# Services of a run for viewers with only a browser

Status: Idea

A port in the process rail opens the service on the machine the run works on. A browser reaches
only the machine of its page: it links a port of a run on the server to the same host name and shows
a port on a workstation without a link, and only the VS Code extension forwards such a port, as one
byte stream per connection through the server (`spec/plugins.md`, section Workspace, sandbox tools,
and processes). This concept describes how a viewer with only a browser could open such a service,
on a workstation as well as behind the reverse proxy of a central server, where the port of a run on
the server is not reachable either.

## Proxy per run and port on its own origin

The server would offer an opt-in proxy per run and port under its own origin, a host name such as
`<port>-<run>.<host>`. A request to that host is an ordinary HTTP request or WebSocket upgrade to
the server; the server checks the viewer's access as for `ragents.processes.tunnel` (`runs.read`,
`runs.inspect`, `ragents.processes.read`, workspace access) and opens a stream with the existing
dial-back: the run's executor connects to the port and opens its leg, and instead of a second leg
the server itself pipes the browser's connection into the stream. For a WebSocket upgrade the server
passes the raw connection after the request head, for plain HTTP the request line and headers as
they arrived. Nothing new is needed on the workstation or in the executor.

`*.localhost` resolves to the own machine without DNS in current browsers, so a local server works
as `5173-<run>.localhost:4710` without configuration. A remote server needs a wildcard DNS entry and
a wildcard certificate for its host, which a Cloudflare tunnel or a reverse proxy with DNS validation
can provide; the profile names the host pattern and turns the proxy on, and without it the rail stays
as it is.

## Sign-in on another origin

The service's origin must not receive the RAgents session cookie: an app an agent built runs there,
and its scripts could otherwise call the RAgents API with the viewer's session. The proxy would
therefore accept a short-lived grant per run and port that the RAgents page hands over through a
redirect with a one-time code and that the proxy exchanges for its own cookie on the service's
origin, scoped to that host. A grant names its user and is checked again against the run's sharing
on every new connection.

## Why not a path prefix on the RAgents origin

A path such as `/services/<run>/<port>/` on the RAgents origin needs no DNS, but it breaks every app
that builds absolute addresses (`/assets/app.js`, `/@vite/client`, a WebSocket to `/`), and an
agent-built app served on the RAgents origin could read the RAgents API with the viewer's session.
Rewriting HTML and scripts to repair addresses is never complete.

## Open questions

- Whether a CLI workstation should forward ports like the extension, as a client for people who do
  not use VS Code; it would reuse the extension's listener and stream code.
- How a grant ends when the run stops or its sharing changes while the browser holds the cookie.
- Whether the proxy needs a limit on parallel streams per viewer.
