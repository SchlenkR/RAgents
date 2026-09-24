import { ArrowLeftIcon } from "lucide-react";
import { Button } from "../ui";
import type { PanelAction } from "./contract";

/** Die Kopfzeile der Seiten Runs und Umgebungen: der Weg zurück auf Start und der Seitentitel; die Aktionen stehen in der Titelzeile von VS Code. */
export function PanelHeader({ title, send }: { title: string; send: (action: PanelAction) => void }) {
  return <div className="flex items-center gap-1.5">
    <Button aria-label="Zur Start-Seite" onClick={() => send({ action: "page", page: "start" })} size="icon-sm" title="Zur Start-Seite" variant="ghost"><ArrowLeftIcon /></Button>
    <h1 className="min-w-0 flex-1 text-[1.1rem] font-semibold">{title}</h1>
  </div>;
}
