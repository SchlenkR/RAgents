import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../ui";
import type { PanelAction } from "./contract";

/** The header of the Runs and Server pages: the way back to Start and the page title; the actions are in the VS Code title bar. */
export function PanelHeader({ title, send }: { title: string; send: (action: PanelAction) => void }) {
  return <div className="flex items-center gap-1.5">
    <Button aria-label="Back to Start" onClick={() => send({ action: "page", page: "start" })} size="icon-sm" title="Back to Start" variant="ghost"><ArrowLeftIcon /></Button>
    <h1 className="min-w-0 flex-1 text-[1.1rem] font-semibold">{title}</h1>
  </div>;
}
