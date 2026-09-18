import React from "react";
import { Button, DocumentViewer } from "@ragents/client/ui";
import { initialWord, participants, targetCount, type WordGameState } from "./state.js";

export type WordGameViewProps = {
  state: WordGameState;
  onStart?: () => void | Promise<void>;
  busy?: boolean;
  actionError?: string | undefined;
  preview?: boolean;
};

const participantColor: Record<string, string> = {
  red: "[--word-game-color:#c84f58]",
  yellow: "[--word-game-color:#b48716]",
  blue: "[--word-game-color:#487ccc]",
  green: "[--word-game-color:#408561]",
};
const dot = "inline-block size-[9px] shrink-0 rounded-full bg-(--word-game-color)";

export function WordGameView({ state, onStart, busy = false, actionError, preview = false }: WordGameViewProps) {
  const entries = state.entries ?? [];
  const active = entries.length % participants.length;
  const status = state.status ?? "setup";
  const step = status === "running" ? `${participants[active]!.name} wählt Wort ${entries.length + 1}.`
    : status === "completed" ? "Fertig. Alle zwölf Wörter sind im Dokument."
      : status === "error" ? "Das Spiel wurde angehalten."
        : status === "ready" ? (preview ? "Bereit für den nächsten Beispielschritt." : "Bereit. Der Start beauftragt das erste Modell.") : "Die Teilnehmer werden eingerichtet.";

  return <main className="mx-auto max-w-[760px] text-base">
    <header className="flex items-center justify-between gap-4">
      <div><p className="mb-1.5 text-xs text-muted-foreground">TypeScript steuert, LLMs wählen Wörter</p><h1 className="text-[1.75rem] leading-[1.2] font-semibold">Wortspiel</h1></div>
      <strong className="text-[1.7rem] tabular-nums" aria-label={`${entries.length} von ${targetCount} Beiträgen`}>{entries.length}/{targetCount}</strong>
    </header>
    <p className="my-5">Rot, Gelb, Blau und Grün sind nacheinander dran. Drei Runden, zwölf neue Wörter. Ausgangswort: <strong>{initialWord}</strong>.</p>
    <ol className="my-5 grid grid-cols-4 gap-2" aria-label="Reihenfolge der Teilnehmer">
      {participants.map((participant, index) => <li key={participant.handle} aria-current={status === "running" && active === index ? "step" : undefined}
        className={`flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border px-1.5 py-3 max-[420px]:text-[0.75rem] aria-[current=step]:border-(--word-game-color) aria-[current=step]:bg-muted aria-[current=step]:ring-1 aria-[current=step]:ring-(--word-game-color) ${participantColor[participant.handle]}`}>
        <span className={dot} aria-hidden="true" /><strong>{participant.name}</strong><small className="w-full text-center text-muted-foreground">LLM</small>
      </li>)}
    </ol>
    <progress className="block h-1.5 w-full [accent-color:#408561]" value={entries.length} max={targetCount} aria-label="Abgeschlossene Beiträge" />
    <p className="my-3" role="status">{step}</p>
    {status === "ready" && <Button disabled={busy || !onStart} onClick={() => void onStart?.()}>{busy ? "Start wird gesendet..." : preview ? "Beispiel zeigen" : "Wortspiel starten"}</Button>}
    {(state.error || actionError) && <p className="border-l-[3px] border-destructive bg-destructive-soft p-3" role="alert">{state.error || actionError}{status === "error" ? " Bitte einen neuen Wortspiel-Run starten. Der bisherige Stand bleibt erhalten." : ""}</p>}
    <section className="mt-6 border-t border-border pt-4" aria-label="Gesammelte Wörter">
      <h2 className="mb-3 text-lg font-semibold">{status === "completed" ? "Das fertige Dokument" : "Die Wortfolge"}</h2>
      {state.document && status === "completed" ? <DocumentViewer content={state.document} format="markdown" filename="word-game.md" /> : entries.length === 0 ? <p className="text-muted-foreground">{preview ? "Hier wächst die Wortfolge aus beschrifteten Beispieldaten." : "Noch keine Modellantwort. Hier wächst die gemeinsame Wortfolge."}</p> : <ol className="mb-5 grid grid-cols-2 gap-x-5 max-[420px]:grid-cols-1">
        {entries.map((entry, index) => <li key={index} className={`flex min-h-9 items-center gap-2 border-b border-border ${participantColor[participants[entry.participant]!.handle]}`}>
          <span className="w-[22px] text-muted-foreground tabular-nums">{index + 1}.</span><span className={dot} aria-hidden="true" /><strong className="[overflow-wrap:anywhere]">{entry.word}</strong><small className="ml-auto text-muted-foreground">{participants[entry.participant]!.name}</small></li>)}
      </ol>}
    </section>
  </main>;
}
