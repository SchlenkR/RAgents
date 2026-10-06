import { Button } from "./button"
import { cn } from "cn"
import { Combobox, ComboboxContent, ComboboxItem, ComboboxTrigger } from "./combobox"
import type { ControlSize } from "./control-size"
import { segmentedOptionLimit, ToggleGroup, ToggleGroupItem } from "./toggle-group"

export interface FilterSelectOption {
  readonly value: string
  readonly label: string
  readonly color?: string
  readonly count?: number
  readonly disabled?: boolean
}

export interface FilterSelectProps {
  readonly label: string
  readonly options: readonly FilterSelectOption[]
  readonly value: readonly string[]
  readonly onValueChange: (value: string[]) => void
  readonly size?: ControlSize
  readonly searchable?: boolean
  readonly disabled?: boolean
  readonly className?: string
}

function FilterSelect({ label, options, value, onValueChange, size = "default", searchable = true, disabled, className }: FilterSelectProps) {
  if (options.length > 0 && options.length <= segmentedOptionLimit) return <div className={cn("flex min-w-0 max-w-full flex-wrap items-center gap-2", className)} data-slot="filter-select-segments">
    <span className="text-sm text-muted-foreground">{label}</span>
    <ToggleGroup aria-label={label} className="max-w-full" disabled={disabled} multiple size={size} value={value} onValueChange={onValueChange}>
      {options.map((option) => <ToggleGroupItem disabled={option.disabled} key={option.value} value={option.value} title={option.label}>
        {option.color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />}
        <span className="min-w-0 truncate">{option.label}</span>
        {option.count !== undefined && <span className="text-muted-foreground tabular-nums">{option.count}</span>}
      </ToggleGroupItem>)}
    </ToggleGroup>
    <Button disabled={disabled || value.length === 0} onClick={() => onValueChange([])} size={size} variant="ghost" aria-label={`Clear ${label}`}>Clear</Button>
  </div>
  const labels = new Map(options.map((option) => [option.value, option.label]))
  return <Combobox multiple disabled={disabled} items={options.map((option) => option.value)} value={[...value]} onValueChange={onValueChange}
    itemToStringLabel={(item) => labels.get(item) ?? item}>
    <ComboboxTrigger aria-label={`${label}: ${value.length === 0 ? "All" : value.length}`} className={className} data-slot="filter-select-trigger" size={size}>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      <span className="text-muted-foreground tabular-nums">{value.length === 0 ? "All" : value.length}</span>
    </ComboboxTrigger>
    <ComboboxContent data-slot="filter-select-content" searchable={searchable} footer={<div className="shrink-0 border-t border-border p-1">
      <Button disabled={value.length === 0} onClick={() => onValueChange([])} size="sm" variant="ghost">Clear</Button>
    </div>}>
      {options.map((option) => <ComboboxItem disabled={option.disabled} indicator="checkbox" key={option.value} label={option.label} value={option.value}>
        {option.color && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: option.color }} />}
        <span className="min-w-0 flex-1 truncate">{option.label}</span>
        {option.count !== undefined && <span className="ml-4 text-muted-foreground tabular-nums">{option.count}</span>}
      </ComboboxItem>)}
    </ComboboxContent>
  </Combobox>
}

export { FilterSelect }
