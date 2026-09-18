import { createRoot } from "react-dom/client";
import { LearningAfternoonView } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/view";
import { initialState, type LearningState } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/state";
import { PreviewControls, useSamplePreview } from "./sample-preview";
import "../../plugins/ragents.actor-programs/client-ui/flow-diagram.css";

const exampleIdeas = [
  "Beispielidee: Gemeinsam experimentieren. Welche Gegenstände schwimmen im Wasser? Erst vermuten, dann ausprobieren und die Beobachtungen vergleichen.",
  "Beispielidee: Ein kleines Quiz spielen. Die Kinder denken sich Fragen zu Tieren aus und erklären nach jeder Runde gemeinsam die Antwort.",
];

function Preview() {
  const { step, select } = useSamplePreview(3);
  const state: LearningState = {
    phase: step === 0 ? "ready" : step === 3 ? "complete" : "working",
    helpers: initialState.helpers.map((helper, index) => ({
      ...helper,
      status: step === 0 ? "waiting" : step > index + 1 ? "complete" : "working",
      text: step > index + 1 ? exampleIdeas[index]! : "",
    })),
  };
  return <>
    <PreviewControls step={step} lastStep={3} onSelect={select} />
    <LearningAfternoonView state={state} onStart={() => select(1)} preview />
  </>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
