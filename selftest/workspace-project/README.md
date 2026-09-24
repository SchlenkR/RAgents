# Arbeitsplatz-Testprojekt

Ein absichtlich winziges Projekt für den Ende-zu-Ende-Test des Arbeitsplatz-Executors
(`docs/concepts/workspace-tools-proxy.md`). Der kopflose Arbeitsplatz
(`pnpm workspace-client`) bietet genau diesen Ordner an; ein Run mit Bindung `client` führt
`read`, `edit`, `write`, `bash` und die Sprachserver darin aus.

Das Kennwort für den Lesetest lautet `Dachsbau`.

## Inhalt

- `src/greeter.ts` - fehlerfrei, Ziel für `edit`.
- `src/broken.ts` - enthält einen absichtlichen Typfehler (`number` an ein `string`-Argument),
  den `typescript_diagnostics` melden muss.
- `csharp/MiniProject.csproj`, `csharp/Program.cs` - Mini-C#-Projekt mit einem absichtlichen
  Fehler (`int` an einen `string`-Parameter), den Roslyn melden muss.
- `csharp2/SecondProject.csproj`, `csharp2/Counter.cs` - ein zweites, unabhängiges C#-Projekt mit
  einem eigenen absichtlichen Fehler (`string` an einen `int`-Parameter). Die beiden C#-Projekte
  sind der Testfall für mehrere Roslyn-Instanzen im selben Run: `roslyn_open` auf beide, dann
  `roslyn_diagnostics` ohne `paths`, dann `roslyn_close` für eines davon.
- `pixel.png` - ein 1x1-Bild als Probe für `read` mit Bildinhalt.

Der Ordner wird vom Test beschrieben und danach über `git checkout`/`git clean` wieder
hergestellt; er enthält nichts, was verloren gehen könnte.
