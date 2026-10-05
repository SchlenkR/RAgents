---
name: browser-testing
description: Test a running web application with real browser actions, visible results, and screenshots.
---

# Testing a web application

Use the TypeScript functions `browser_navigate`, `browser_snapshot`, `browser_click`,
`browser_type`, `browser_select_option`, `browser_press_key`, `browser_check`, `browser_resize`,
`browser_take_screenshot` and `browser_close`. Load their exact contracts with `typescript_api`.

A mini-app of an actor program is not an application you start: it is already open for the user as a
tab. Check it with `actor_view_snapshot`, which resolves the address itself; use the steps below for
applications you started.

1. Start the application with its actual services. Start a dev server or another service that
   must keep running with `bash` and `run_in_background: true`; the call returns an ID at once.
   Never detach it yourself with `nohup`, `&`, `setsid`, a detached spawn, or a service manager.
   Read its address and errors with `task_output`, and wait until it answers, for example with a
   short foreground `bash` that retries `curl` against its address.
2. Open its HTTP address with `browser_navigate`. Every run has its own browser without an
   inherited sign-in. It runs on the machine of your workspace; you reach an application
   started there via `localhost`. Report missing services and browser prerequisites
   explicitly.
3. Read the snapshot and follow the actual user path. Choose targets by visible
   roles/names or field labels, for example `{ role: "button", name: "Save" }`.
   Resolution happens in the browser. Snapshot IDs are not copied.
4. Check success and relevant error cases with `browser_check`: visible result, target address,
   or match count. Combine `target`, `count`, and `text` to count visible matches containing
   the text (case-insensitive substring); `count: 0` checks absence and warns if the unfiltered
   target has never matched since navigation. Verify a warned selector with a positive check.
   A pure text check can use `frame` to search inside an iframe; element targets use `target.frame`.
   With `target` and `measure: true` (without `count`), inspect the bounding box, client/scroll
   widths and `overflowX` in CSS pixels. Measure `{ css: "html" }` for page overflow or the
   relevant container for clipped fields and text. Page errors are reported
   as information by default. Set `noErrors: true` explicitly when browser and network errors
   since navigation must also fail the check. A typecheck or screenshot alone does not prove
   a successful user path.
   Every action needs a new check. Do not invent results when the network is missing.
5. Create real screenshots with `browser_take_screenshot`. Give each a `filename` next to the
   report that shows it, such as `@documents/<topic>/shots/home.png` for
   `@documents/<topic>/report.md`, and embed it there with a path relative to the report:
   `![Home](shots/home.png)`. Without `filename` it lands under `@documents/browser/`. The
   native tool `browser_view_screenshot` shows you the latest screenshot without a path; for
   that your model needs image support. The viewport defaults to 1920 x 1080 (16:9); for
   narrow layouts or small screens you change it with `browser_resize` and check again
   afterwards.
6. Name the checked steps and remaining limits. Close the browser and stop the services you
   started with `task_stop` when you are done; screenshots are kept. Stopping the run and shutting
   down the server end both as well.

The browser actions use Playwright locators with automatic waiting. Ambiguous targets
name up to five candidates; pick one with `target.nth` (0-based), `first: true`, or a more
specific text or role/name target. `count` in `browser_check` needs a target without `nth`
or `first`. Page error lists contain at most five errors, each cut to 300 characters,
and the number omitted. Timeout errors name the actionable cause in one or two lines.
Zero matches fail immediately with `0 matches for <target>`; other visibility checks wait
at most 5 seconds and actions wait longer for operability. Actions and resizing return short
snapshots, at most 2000 characters; `browser_snapshot` reads the full structure up to 40000.
Resizing discards prior check evidence. Native selects use `browser_select_option`; custom dropdown menus are clicked.
With `target.frame` you choose an iframe by CSS. New windows are reported explicitly;
this flow operates one page. Hidden elements are not clicked via JavaScript.
