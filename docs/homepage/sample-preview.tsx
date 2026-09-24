import { useState } from "react";
import { Button } from "../../apps/web/src/ui";
import "./preview-size";

export function useSamplePreview(lastStep: number) {
  const [step, select] = useState(lastStep);
  return { step, select };
}

export function PreviewControls({ step, lastStep, onSelect }: { step: number; lastStep: number; onSelect: (step: number) => void }) {
  return <nav className="sample-preview-controls" aria-label="Control example data">
    <Button disabled={step >= lastStep} onClick={() => onSelect(step + 1)} variant="outline">Next example step</Button>
    <Button onClick={() => onSelect(0)} variant="outline">Reset preview</Button>
  </nav>;
}
