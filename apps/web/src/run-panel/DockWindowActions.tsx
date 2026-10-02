import { useState, type ReactNode } from "react";
import { MenuIcon, RotateCcwIcon } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "../ui";

const MAX_DIRECT_WINDOWS = 5;

export function DockWindowActions({ items, onOpen, onReset }: {
  items: readonly { id: string; title: string; icon: ReactNode; visible?: boolean }[];
  onOpen: (id: string) => void;
  onReset?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const content = (item: typeof items[number]) => <>{item.icon}<span className="min-w-0 truncate">{item.title}</span></>;
  return <div aria-label="Layout actions" className="flex min-w-0 items-center gap-1" role="group">
    {items.length > MAX_DIRECT_WINDOWS ? <Popover onOpenChange={setOpen} open={open}>
      <PopoverTrigger render={<Button aria-label="All windows" size="icon-lg" title="All windows" variant="ghost" />}><MenuIcon /></PopoverTrigger>
      <PopoverContent align="end" aria-label="All windows" className="max-h-[70vh] w-64 gap-1 overflow-auto p-1" role="menu">
        {items.map((item) => <Button aria-checked={item.visible} className="w-full justify-start aria-checked:bg-accent aria-checked:text-foreground" key={item.id} onClick={() => { onOpen(item.id); setOpen(false); }}
          role={item.visible === undefined ? "menuitem" : "menuitemcheckbox"} variant="ghost">{content(item)}</Button>)}
      </PopoverContent>
    </Popover> : items.map((item) => <Button aria-label={item.title} aria-pressed={item.visible} className="min-w-11 shrink aria-pressed:bg-accent aria-pressed:text-foreground" key={item.id}
      onClick={() => onOpen(item.id)} title={item.visible ? item.title : `Show ${item.title}`} variant="ghost">{content(item)}</Button>)}
    {onReset && <Button aria-label="Reset layout" onClick={onReset} size="icon-lg" title="Reset layout" variant="ghost"><RotateCcwIcon /></Button>}
  </div>;
}
