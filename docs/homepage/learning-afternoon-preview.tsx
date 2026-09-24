import { createRoot } from "react-dom/client";
import { LearningAfternoonView } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/view";
import { initialState, type LearningState } from "../../plugins/ragents.reference/run-scripts/learning-afternoon/src/state";
import { PreviewControls, useSamplePreview } from "./sample-preview";
import "../../apps/web/src/actor-programs/client-ui/flow-diagram.css";

const exampleIdeas = [
  "Example idea: Explore together. Which objects float in water? Predict first, then test and compare the observations.",
  "Example idea: Play a short quiz. The children create questions about animals and explain the answer together after each round.",
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
