import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../ui";
import type { PanelAction } from "./contract";

export function PanelHeader({ title, send }: { title: string; send: (action: PanelAction) => void }) {
  return <div className="flex items-center gap-2">
    <Button aria-label="Back to home" onClick={() => send({ action: "page", page: "start" })} size="icon-sm" variant="ghost"><ArrowLeftIcon /></Button>
    <h1 className="min-w-0 flex-1 type-title">{title}</h1>
  </div>;
}
