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
  const step = status === "running" ? `${participants[active]!.name} chooses word ${entries.length + 1}.`
    : status === "completed" ? "Done. All twelve words are in the document."
      : status === "error" ? "The game was stopped."
        : status === "ready" ? (preview ? "Ready for the next example step." : "Ready. Start sends the first model task.") : "Setting up participants.";

  return <main className="mx-auto max-w-[760px] text-base">
    <header className="flex items-center justify-between gap-4">
      <div><p className="mb-1.5 text-xs text-muted-foreground">TypeScript controls the flow, LLMs choose words</p><h1 className="text-[1.75rem] leading-[1.2] font-semibold">Word game</h1></div>
      <strong className="text-[1.7rem] tabular-nums" aria-label={`${entries.length} of ${targetCount} entries`}>{entries.length}/{targetCount}</strong>
    </header>
    <p className="my-5">Red, Yellow, Blue, and Green take turns. Three rounds, twelve new words. Starting word: <strong>{initialWord}</strong>.</p>
    <ol className="my-5 grid grid-cols-4 gap-2" aria-label="Participant order">
      {participants.map((participant, index) => <li key={participant.handle} aria-current={status === "running" && active === index ? "step" : undefined}
        className={`flex flex-wrap items-center justify-center gap-1.5 rounded-lg border border-border px-1.5 py-3 max-[420px]:text-[0.75rem] aria-[current=step]:border-(--word-game-color) aria-[current=step]:bg-muted aria-[current=step]:ring-1 aria-[current=step]:ring-(--word-game-color) ${participantColor[participant.handle]}`}>
        <span className={dot} aria-hidden="true" /><strong>{participant.name}</strong><small className="w-full text-center text-muted-foreground">LLM</small>
      </li>)}
    </ol>
    <progress className="block h-1.5 w-full [accent-color:#408561]" value={entries.length} max={targetCount} aria-label="Completed entries" />
    <p className="my-3" role="status">{step}</p>
    {status === "ready" && <Button disabled={busy || !onStart} onClick={() => void onStart?.()}>{busy ? "Sending start..." : preview ? "Show example" : "Start word game"}</Button>}
    {(state.error || actionError) && <p className="border-l-[3px] border-destructive bg-destructive-soft p-3" role="alert">{state.error || actionError}{status === "error" ? " Start a new word-game run. The current state remains available." : ""}</p>}
    <section className="mt-6 border-t border-border pt-4" aria-label="Collected words">
      <h2 className="mb-3 text-lg font-semibold">{status === "completed" ? "Completed document" : "Word sequence"}</h2>
      {state.document && status === "completed" ? <DocumentViewer content={state.document} format="markdown" filename="word-game.md" /> : entries.length === 0 ? <p className="text-muted-foreground">{preview ? "The word sequence grows here from labeled example data." : "No model response yet. The shared word sequence grows here."}</p> : <ol className="mb-5 grid grid-cols-2 gap-x-5 max-[420px]:grid-cols-1">
        {entries.map((entry, index) => <li key={index} className={`flex min-h-9 items-center gap-2 border-b border-border ${participantColor[participants[entry.participant]!.handle]}`}>
          <span className="w-[22px] text-muted-foreground tabular-nums">{index + 1}.</span><span className={dot} aria-hidden="true" /><strong className="[overflow-wrap:anywhere]">{entry.word}</strong><small className="ml-auto text-muted-foreground">{participants[entry.participant]!.name}</small></li>)}
      </ol>}
    </section>
  </main>;
}
