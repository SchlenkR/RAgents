import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SearchIcon } from "lucide-react";
import { DockButtonMenu } from "../src/run-panel/DockButtonMenu";
import {
  Button, Combobox, ComboboxContent, ComboboxItem, ComboboxTrigger, ComboboxValue,
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, FilterSelect, Input,
  Popover, PopoverContent, PopoverTrigger, Select, SelectContent, SelectGroup, SelectItem, SelectLabel,
  SelectTrigger, SelectValue, Textarea, Toggle, ToggleGroup, ToggleGroupItem,
} from "../src/ui";
import "../src/ui/tailwind.css";

const sizes = ["xs", "sm", "default", "lg"] as const;
const priorities = [{ value: "priority", label: "Priority, then date" }, { value: "date", label: "Date, then priority" }];
const choices = ["First choice", "Second choice"];
const options = [
  { value: "alpha", label: "Alpha research", color: "#4d8799", count: 12 },
  { value: "beta", label: "Beta follow-up", color: "#9a6c9e", count: 7 },
  { value: "gamma", label: "Gamma planning", count: 4 },
  { value: "delta", label: "Delta review", count: 2 },
  { value: "epsilon", label: "Epsilon drafting", count: 9 },
  { value: "zeta", label: "Zeta delivery", count: 3 },
  { value: "eta", label: "Eta validation", count: 5 },
  { value: "theta", label: "Theta archive", count: 1, disabled: true },
  { value: "iota", label: "Iota review", count: 6 },
];

function SizeRow({ size }: { size: typeof sizes[number] }) {
  const [selected, setSelected] = useState<string[]>([]);
  return <div className="space-y-2">
    <h2 className="text-sm text-muted-foreground">{size}</h2>
    <div role="toolbar" aria-label={`${size} controls`} className="flex w-max items-center gap-2">
      <Button size={size} variant="outline" aria-label={`${size} button`}>Button</Button>
      <Button size={size === "default" ? "icon" : `icon-${size}`} variant="outline" aria-label={`${size} icon button`}><SearchIcon /></Button>
      <Toggle size={size} variant="outline" aria-label={`${size} toggle`}>Toggle</Toggle>
      <ToggleGroup size={size} spacing={0} variant="outline" defaultValue={["list"]} aria-label={`${size} view`}>
        <ToggleGroupItem value="list">List</ToggleGroupItem>
        <ToggleGroupItem value="lanes">Lanes</ToggleGroupItem>
      </ToggleGroup>
      <Select items={priorities} defaultValue={priorities[0].value}>
        <SelectTrigger size={size} aria-label={`${size} select`}><SelectValue /></SelectTrigger>
        <SelectContent>{priorities.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <Input size={size} aria-label={`${size} input`} className="w-40" defaultValue="Assigned person..." />
      <Combobox items={choices} defaultValue={choices[0]}>
        <ComboboxTrigger size={size} aria-label={`${size} combobox`}><ComboboxValue /></ComboboxTrigger>
        <ComboboxContent>{choices.map((value) => <ComboboxItem key={value} value={value}>{value}</ComboboxItem>)}</ComboboxContent>
      </Combobox>
      <FilterSelect label="Status" size={size} options={options} value={selected} onValueChange={setSelected} />
      <Textarea size={size} rows={1} aria-label={`${size} textarea`} className="w-28" defaultValue="Notes..." />
    </div>
  </div>;
}

function Fixture() {
  const [selected, setSelected] = useState("gamma");
  const [filters, setFilters] = useState<string[]>([]);
  const [multiple, setMultiple] = useState<string[]>(["alpha"]);
  const [expanded, setExpanded] = useState(false);
  return <main className="min-h-screen overflow-x-auto bg-background p-6 text-foreground">
    <h1 className="mb-5 text-lg font-semibold">Shared controls</h1>
    <section aria-label="Control sizes" className="space-y-5">{sizes.map((size) => <SizeRow key={size} size={size} />)}</section>
    <section aria-label="Dropdown behavior" className="mt-8 space-y-4">
      <h2 className="font-semibold">Search and filtering</h2>
      <div className="flex items-center gap-3">
        <Select items={options} value={selected} onValueChange={(value) => { if (value) setSelected(value); }}>
          <SelectTrigger aria-label="Searchable select" className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectGroup><SelectLabel>Project stages</SelectLabel>{options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectGroup>
          </SelectContent>
        </Select>
        <Select items={options.slice(0, 8)} defaultValue="alpha">
          <SelectTrigger aria-label="Eight option select" className="w-72"><SelectValue /></SelectTrigger>
          <SelectContent alignItemWithTrigger>{options.slice(0, 8).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select items={options.slice(0, 2)} searchable defaultValue="alpha">
          <SelectTrigger aria-label="Search forced on"><SelectValue /></SelectTrigger>
          <SelectContent>{options.slice(0, 2).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select items={options} searchable={false} defaultValue="alpha">
          <SelectTrigger aria-label="Search forced off"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <Select multiple items={options} value={multiple} onValueChange={setMultiple}>
          <SelectTrigger aria-label="Multiple stages select"><SelectValue /></SelectTrigger>
          <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value} disabled={option.disabled}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
        <output aria-label="Selected select values">{multiple.join(",")}</output>
      </div>
      <output aria-label="Selected option">{selected}</output>
      <div className="flex items-center gap-3">
        <FilterSelect label="Stages" options={options} value={filters} onValueChange={setFilters} />
        <FilterSelect label="Unfiltered stages" options={options} value={filters} onValueChange={setFilters} searchable={false} />
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button variant="outline" />}>Actions</DropdownMenuTrigger>
          <DropdownMenuContent><DropdownMenuItem>Review</DropdownMenuItem><DropdownMenuItem>Archive</DropdownMenuItem></DropdownMenuContent>
        </DropdownMenu>
        <Popover>
          <PopoverTrigger render={<Button variant="outline" />}>Details</PopoverTrigger>
          <PopoverContent aria-label="Item details">Project details</PopoverContent>
        </Popover>
        <DockButtonMenu destination="sidebar" onMove={() => {}}><Button variant="outline">Window actions</Button></DockButtonMenu>
      </div>
      <output aria-label="Selected filters">{filters.join(",") || "All"}</output>
      <div className="flex items-center gap-3">
        <Button variant="outline" onClick={() => setExpanded(!expanded)}>{expanded ? "Use eight options" : "Use nine options"}</Button>
        <Select items={options.slice(0, expanded ? 9 : 8)} defaultValue="alpha">
          <SelectTrigger aria-label="Changing options select"><SelectValue /></SelectTrigger>
          <SelectContent>{options.slice(0, expanded ? 9 : 8).map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
        </Select>
      </div>
    </section>
    <section aria-label="Bottom dropdown" className="mt-[900px] flex gap-3 pb-2">
      <Select items={options} defaultValue="iota" searchable={false}>
        <SelectTrigger aria-label="Bottom select" className="w-72"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
      <Select items={options} defaultValue="iota">
        <SelectTrigger aria-label="Bottom searchable select" className="w-72"><SelectValue /></SelectTrigger>
        <SelectContent>{options.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
      </Select>
    </section>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
