import { PinIcon, MaximizeIcon } from "lucide-react";
import { createRoot } from "react-dom/client";
import { Badge, BadgeDisplayProvider, type BadgeTone } from "../src/ui/badge";
import { Button } from "../src/ui/button";
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuTrigger } from "../src/ui/dropdown-menu";
import { InteractiveItem } from "../src/ui/interactive-item";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../src/ui/select";
import { Table, TableBody, TableCell, TableRow } from "../src/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../src/ui/tabs";
import { Toggle } from "../src/ui/toggle";
import { ToggleGroup, ToggleGroupItem } from "../src/ui/toggle-group";
import "../src/ui/tailwind.css";

const tones: readonly BadgeTone[] = ["success", "warning", "danger", "info", "neutral", "active"];
const variants = ["default", "outline", "secondary", "ghost", "destructive", "link"] as const;

function Fixture() {
  return <main className="h-full overflow-auto bg-background p-6 text-foreground">
    <h1 className="text-lg font-semibold">Shared control states</h1>
    <div className="mt-4 grid grid-cols-2 gap-6">
      <section aria-label="Buttons" className="space-y-3">
        <h2>Buttons</h2>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => <Button key={variant} variant={variant}>Action {variant}</Button>)}
        </div>
        <div className="flex flex-wrap gap-2">
          {variants.map((variant) => <Button key={variant} variant={variant} aria-pressed="true">Pressed {variant}</Button>)}
          <Button variant="outline" aria-expanded="true">Expanded action</Button>
          <Button aria-label="Pin" aria-pressed="true" size="icon-xs" variant="ghost"><PinIcon /></Button>
          <Button aria-label="Maximize" aria-pressed="true" size="icon" variant="outline"><MaximizeIcon /></Button>
          <Button variant="outline" disabled>Disabled action</Button>
          <Button variant="outline" disabled aria-pressed="true">Disabled pressed action</Button>
        </div>
      </section>
      <section aria-label="Toggles" className="space-y-3">
        <h2>Toggles</h2>
        <div className="flex gap-2">
          <Toggle defaultPressed>Selected toggle</Toggle>
          <Toggle>Unselected toggle</Toggle>
          <Toggle variant="outline" defaultPressed>Selected outline toggle</Toggle>
          <Toggle disabled defaultPressed>Disabled toggle</Toggle>
        </div>
        <ToggleGroup multiple defaultValue={["read", "write"]} aria-label="Multiple options">
          <ToggleGroupItem value="read">Read option</ToggleGroupItem>
          <ToggleGroupItem value="write">Write option</ToggleGroupItem>
          <ToggleGroupItem value="share">Share option</ToggleGroupItem>
          <ToggleGroupItem value="disabled" disabled>Disabled option</ToggleGroupItem>
        </ToggleGroup>
        <ToggleGroup defaultValue={["list"]} aria-label="View mode">
          <ToggleGroupItem value="list">List mode</ToggleGroupItem>
          <ToggleGroupItem value="grid">Grid mode</ToggleGroupItem>
        </ToggleGroup>
      </section>
      <section aria-label="Tab styles" className="space-y-3">
        <h2>Tabs</h2>
        {(["default", "line"] as const).map((variant) => <Tabs key={variant} defaultValue="overview">
          <TabsList variant={variant} aria-label={`${variant} tabs`}>
            <TabsTrigger value="overview">Overview {variant}</TabsTrigger>
            <TabsTrigger value="details">Details {variant}</TabsTrigger>
            <TabsTrigger value="disabled" disabled>Disabled {variant}</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">Overview content</TabsContent>
          <TabsContent value="details">Details content</TabsContent>
        </Tabs>)}
      </section>
      <section aria-label="Rows" className="space-y-3">
        <h2>Rows</h2>
        <div className="flex gap-2">
          <InteractiveItem aria-current="page" className="border border-transparent px-3 py-2">Current page</InteractiveItem>
          <InteractiveItem className="border border-transparent px-3 py-2">Other page</InteractiveItem>
          <InteractiveItem aria-current={true} className="border border-transparent px-3 py-2">Current item</InteractiveItem>
          <InteractiveItem aria-current={false} className="border border-transparent px-3 py-2">Inactive item</InteractiveItem>
          <InteractiveItem disabled className="px-3 py-2">Disabled item</InteractiveItem>
        </div>
        <Table aria-label="Items">
          <TableBody>
            <TableRow aria-selected="true" tabIndex={0}><TableCell>Selected row</TableCell></TableRow>
            <TableRow tabIndex={0}><TableCell>Unselected row</TableCell></TableRow>
          </TableBody>
        </Table>
        <details>
          <InteractiveItem render={<summary />} className="border border-transparent px-3 py-2">Item details</InteractiveItem>
          <p>Expanded item information</p>
        </details>
      </section>
      <section aria-label="Menus" className="space-y-3">
        <h2>Select and menu items</h2>
        <div className="flex gap-2">
          <Select defaultValue="one" items={[{ value: "one", label: "First option" }, { value: "two", label: "Second option" }, { value: "disabled", label: "Disabled select option" }]}>
            <SelectTrigger aria-label="Single choice"><SelectValue /></SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value="one">First option</SelectItem>
              <SelectItem value="two">Second option</SelectItem>
              <SelectItem value="disabled" disabled>Disabled select option</SelectItem>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" />}>Display menu</DropdownMenuTrigger>
            <DropdownMenuContent>
              <DropdownMenuCheckboxItem defaultChecked>Checked item</DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem>Unchecked item</DropdownMenuCheckboxItem>
              <DropdownMenuRadioGroup defaultValue="compact">
                <DropdownMenuRadioItem value="compact">Compact item</DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="comfortable">Comfortable item</DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuItem disabled>Disabled menu item</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>
      <section aria-label="Status tones" className="space-y-3">
        <h2>Status tones</h2>
        <div className="flex gap-2">
          {tones.map((tone) => <Badge key={tone} tone={tone} role="status">Status {tone}</Badge>)}
        </div>
        <div className="flex gap-4">
          <BadgeDisplayProvider value="dot">
            {tones.map((tone) => <Badge key={tone} tone={tone} role="status">Dot {tone}</Badge>)}
          </BadgeDisplayProvider>
        </div>
        <div aria-label="Linked status tones" className="space-y-2">
          {(["default", "ghost", "destructive"] as const).map((variant) => <div key={variant} className="flex flex-wrap gap-2">
            {tones.map((tone) => <Badge key={tone} tone={tone} variant={variant} render={<a href="#status" />}>Linked {tone} {variant}</Badge>)}
          </div>)}
        </div>
      </section>
    </div>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
