import { createRoot } from "react-dom/client";
import { WordGameView } from "../../plugins/ragents.reference/run-scripts/word-game/src/view";
import { documentFrom, participants, targetCount, type WordGameState } from "../../plugins/ragents.reference/run-scripts/word-game/src/state";
import { PreviewControls, useSamplePreview } from "./sample-preview";
import "../../plugins/ragents.actor-programs/client-ui/flow-diagram.css";

const exampleWords = ["Wärme", "Sommer", "Eis", "Wasser", "Meer", "Welle", "Wind", "Segel", "Boot", "Hafen", "Reise", "Entdeckung"];

function Preview() {
  const { step, select } = useSamplePreview(targetCount + 1);
  const entries = exampleWords.slice(0, Math.max(0, step - 1)).map((word, index) => ({ participant: index % participants.length, word }));
  const state: WordGameState = {
    status: step === 0 ? "ready" : entries.length === targetCount ? "completed" : "running",
    entries,
    ...(entries.length === targetCount ? { document: `Beispieldaten aus der lokalen Homepage-Vorschau. Keine KI-Ausgabe.\n\n${documentFrom(entries)}` } : {}),
  };
  return <>
    <PreviewControls step={step} lastStep={targetCount + 1} onSelect={select} />
    <WordGameView state={state} onStart={() => select(1)} preview />
  </>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
