import { useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { DataGrid, type DataGridColumn } from "../src/ui/data-grid";
import { Badge } from "../src/ui/badge";
import "../src/ui/tailwind.css";

interface WorkItem {
  id: string;
  name: string;
  status: string;
  notes: string;
}

declare global {
  interface Window {
    dataGridFixture: {
      appendRows: () => void;
      setLoading: (loading: boolean) => void;
      endCalls: number;
      clicked: string | null;
      opened: string | null;
      selected: readonly string[];
    };
  }
}

const columns: readonly DataGridColumn<WorkItem>[] = [
  { id: "name", label: "Name", value: (row) => row.name, width: 260, minWidth: 100, sortable: true },
  { id: "status", label: "Status", value: (row) => row.status, render: (row) => <Badge variant="secondary">{row.status}</Badge>, width: 112, minWidth: 72, sortable: true },
  { id: "notes", label: "Notes", value: (row) => row.notes, width: 320, minWidth: 100, flex: true, wrap: true },
];

const items: readonly WorkItem[] = Array.from({ length: 10_400 }, (_, index) => ({
  id: `item-${index}`,
  name: `Work item ${String(index).padStart(5, "0")} - Review the implementation details and the complete supporting documentation`,
  status: index % 2 === 0 ? "Ready" : "In progress",
  notes: index % 31 === 0 ? "This row has a longer note that wraps onto several lines as the available width changes. Its measured height must keep later rows in the correct position. The reviewer also needs enough context to understand the expected behavior, the supporting evidence, and the remaining work before opening the item." : "Review pending",
}));
const mode = new URLSearchParams(location.search).get("mode") ?? "page";
const labels: Record<string, string> = {
  page: "Work items",
  bounded: "Panel work items",
  grouped: "Grouped work items",
  ancestor: "Scrollable work items",
  unbounded: "Unbounded work items",
};

function Fixture() {
  const [rowCount, setRowCount] = useState(mode === "grouped" ? 80 : 10_000);
  const [loading, setLoading] = useState(false);
  const [endCalls, setEndCalls] = useState(0);
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [clicked, setClicked] = useState<string | null>(null);
  const [opened, setOpened] = useState<string | null>(null);
  const rows = useMemo(() => items.slice(0, rowCount), [rowCount]);
  window.dataGridFixture = { appendRows: () => setRowCount((count) => count + 200), setLoading, endCalls, clicked, opened, selected };
  const grid = <DataGrid id={`browser-${mode}-items`} aria-label={labels[mode]} rows={rows} columns={columns} rowKey={(row) => row.id}
    stickyOffset={mode === "bounded" ? 0 : 52} height={mode === "bounded" ? 360 : undefined}
    grouping={mode === "grouped" ? ["status"] : undefined} selection={selected} onSelectionChange={setSelected}
    onRowClick={(row) => setClicked(row.id)} onOpen={(row) => setOpened(row.id)}
    onEndReached={() => setEndCalls((count) => count + 1)} endReachedThreshold={180} loading={loading}
    footer={<div role="status" aria-label="Loading status" className="type-meta py-4">{rowCount.toLocaleString("en-US")} items; end reached {endCalls} times</div>} />;
  const content = <>
    <div role="toolbar" aria-label="Work item controls" className="sticky top-0 z-30 flex h-[52px] items-center justify-between border-b border-border-soft bg-background">
      <h1 className="type-title">Work items</h1>
      <span className="type-meta">{rowCount.toLocaleString("en-US")} items</span>
    </div>
    <p className="type-body py-6 text-muted-foreground">Review the list, resize a column, or open an item.</p>
    {mode === "unbounded" ? <section aria-label="Unbounded list wrapper" className="overflow-x-hidden">{grid}</section> : grid}
    <output aria-label="Last clicked item">{clicked ?? "None"}</output>
    <output aria-label="Last opened item">{opened ?? "None"}</output>
    <output aria-label="Selected item count">{selected.length}</output>
  </>;
  return <main className="min-h-screen bg-background px-4 text-foreground">
    {mode === "ancestor" ? <section aria-label="Scrollable list panel" className="h-[520px] overflow-y-auto">{content}</section> : content}
  </main>;
}

createRoot(document.getElementById("root")!).render(<Fixture />);
