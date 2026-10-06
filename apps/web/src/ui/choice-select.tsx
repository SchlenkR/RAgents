import type { ControlSize } from "./control-size"
import { cn } from "cn"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./select"
import { segmentedOptionLimit, ToggleGroup, ToggleGroupItem } from "./toggle-group"

export interface ChoiceSelectProps<Value extends string = string> {
  readonly label: string
  readonly options: readonly {
    readonly value: Value
    readonly label: string
    readonly disabled?: boolean
  }[]
  readonly value: Value
  readonly onValueChange: (value: Value) => void
  readonly size?: ControlSize
  readonly disabled?: boolean
  readonly className?: string
}

function ChoiceSelect<Value extends string>({ label, options, value, onValueChange, size = "default", disabled, className }: ChoiceSelectProps<Value>) {
  if (options.length > 0 && options.length <= segmentedOptionLimit) return <ToggleGroup aria-label={label} className={cn("max-w-full", className)} disabled={disabled} size={size} value={[value]}
    onValueChange={([next]) => { if (next !== undefined) onValueChange(next) }}>
    {options.map((option) => <ToggleGroupItem disabled={option.disabled} key={option.value} value={option.value} title={option.label}><span className="min-w-0 truncate">{option.label}</span></ToggleGroupItem>)}
  </ToggleGroup>
  return <Select disabled={disabled} items={options} value={value} onValueChange={(next) => { if (next !== null) onValueChange(next) }}>
    <SelectTrigger aria-label={label} className={className} size={size}><SelectValue /></SelectTrigger>
    <SelectContent>{options.map((option) => <SelectItem disabled={option.disabled} key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
  </Select>
}

export { ChoiceSelect }
