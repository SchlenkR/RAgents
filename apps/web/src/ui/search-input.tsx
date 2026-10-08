import { SearchIcon, XIcon } from "lucide-react";
import { useImperativeHandle, useRef, type ComponentProps, type Ref } from "react";
import { cn } from "cn";
import { Button } from "./button";
import { Input } from "./input";

/** A search field with the product's own clear button in place of the browser's. */
export function SearchInput({ className, icon = false, inputRef, onValueChange, value, ...props }: Omit<ComponentProps<typeof Input>, "className" | "onChange" | "ref" | "type" | "value"> & {
  className?: string;
  /** A magnifier at the start of the field. */
  icon?: boolean;
  inputRef?: Ref<HTMLInputElement>;
  onValueChange: (value: string) => void;
  value: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => input.current!, []);
  return <div className={cn("relative min-w-0", className)}>
    {icon && <SearchIcon aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />}
    <Input {...props} className={cn("[&::-webkit-search-cancel-button]:appearance-none", icon && "pl-8", value !== "" && "pr-8")}
      onChange={(event) => onValueChange(event.target.value)} ref={input} type="search" value={value} />
    {value !== "" && <Button aria-label="Clear search" className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
      onClick={() => { onValueChange(""); input.current?.focus(); }} size="icon-xs" type="button" variant="ghost"><XIcon /></Button>}
  </div>;
}
