# Workspace test project

A deliberately tiny project for the end-to-end test of the workspace executor
(`docs/concepts/workspace-tools-proxy.md`). The headless workspace
(`pnpm workspace-client`) offers exactly this folder; a run with binding `client` executes
`read`, `edit`, `write`, `bash`, and the language servers in it.

The password for the read test is `Badgersett`.

## Contents

- `src/greeter.ts` - error-free, target for `edit`.
- `src/broken.ts` - contains a deliberate type error (`number` passed to a `string` argument)
  that `typescript_diagnostics` must report.
- `csharp/MiniProject.csproj`, `csharp/Program.cs` - mini C# project with a deliberate
  error (`int` passed to a `string` parameter) that Roslyn must report.
- `csharp2/SecondProject.csproj`, `csharp2/Counter.cs` - a second, independent C# project with
  its own deliberate error (`string` passed to an `int` parameter). The two C# projects
  are the test case for several Roslyn instances in the same run: `roslyn_open` on both, then
  `roslyn_diagnostics` without `paths`, then `roslyn_close` for one of them.
- `pixel.png` - a 1x1 image as a probe for `read` with image content.

The folder is written to by the test and restored afterwards via `git checkout`/`git clean`;
it contains nothing that could be lost.
