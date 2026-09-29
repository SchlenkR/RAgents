---
name: browser-testing
description: Test a running web application with real browser actions, visible results, and screenshots.
---

# Testing a web application

Use the TypeScript functions `browser_open`, `browser_snapshot`, `browser_click`,
`browser_fill`, `browser_select`, `browser_press`, `browser_check`, `browser_viewport`,
`browser_screenshot` and `browser_close`. Load their exact contracts with `typescript_api`.

1. Start the application with its actual services and wait until they are ready.
2. Open its HTTP address with `browser_open`. Every run has its own browser without an
   inherited sign-in. It runs on the machine of your workspace; you reach an application
   started there via `localhost`. Report missing services and browser prerequisites
   explicitly.
3. Read the snapshot and follow the actual user path. Choose targets by visible
   roles/names or field labels, for example `{ role: "button", name: "Save" }`.
   Resolution happens in the browser. Snapshot IDs are not copied.
4. Check success and relevant error cases with `browser_check`: visible result, target address
   and browser errors. A typecheck or screenshot alone does not prove a successful user path.
   Every action needs a new check. Do not invent results when the network is missing.
5. Create real screenshots with `browser_screenshot`. Put `url` or `markdown`
   programmatically into the result report or the mini-app. The image lives in the file storage
   of this run. The native tool `browser_view_screenshot` shows you the latest screenshot
   without a path; for that your model needs image support. The viewport defaults to
   1920 x 1080 (16:9); for narrow layouts or small screens you change it with
   `browser_viewport` and check again afterwards.
6. Name the checked steps and remaining limits. Close the browser when you are done;
   screenshots are kept. Stopping the run and shutting down the server close it as well.

The browser actions use Playwright locators with automatic waiting. Ambiguous targets
are errors that name the candidates; then pick one match with `nth` (0-based) or `first: true` in
the target, or check the number of visible matches with `count` in `browser_check`.
Visibility checks wait at most 5 seconds, actions longer; a missing element
therefore costs no long wait. Native selects use `browser_select`; custom dropdown menus are clicked.
With `target.frame` you choose an iframe by CSS. New windows are reported explicitly;
this flow operates one page. Hidden elements are not clicked via JavaScript.
