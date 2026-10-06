import { createRoot } from "react-dom/client";
import { DataTable } from "../src/actor-programs/client-ui/DataTable";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow, type TableColumnDefinition } from "../src/ui/table";
import "../src/ui/tailwind.css";

const columns: readonly TableColumnDefinition[] = [
  { id: "name", label: "Name", width: 240, minWidth: 100 },
  { id: "status", label: "Status", width: 160, minWidth: 80 },
  { id: "count", label: "Count", width: 90, minWidth: 60, resizable: false },
];
const description = "A longer work item description that should remain available when its column is narrow";

function WorkTable({ label }: { label: string }) {
  return <Table aria-label={label} id="work-items" columns={columns}>
    <TableHeader><TableRow>
      {columns.map((column) => <TableHead key={column.id}>{column.label}</TableHead>)}
    </TableRow></TableHeader>
    <TableBody>
      <TableRow><TableCell>{description}</TableCell><TableCell>In progress</TableCell><TableCell>14</TableCell></TableRow>
      <TableRow><TableCell>Review notes</TableCell><TableCell>Ready</TableCell><TableCell>3</TableCell></TableRow>
    </TableBody>
  </Table>;
}

createRoot(document.getElementById("root")!).render(<main className="min-h-screen space-y-6 bg-background p-6 text-foreground">
  <h1 className="text-lg font-semibold">Resizable tables</h1>
  <WorkTable label="Work items" />
  <WorkTable label="Work items mirror" />
  <DataTable id="mini-app-items" title="Mini-app table" rows={[{ id: "entry", name: description, count: 14 }]} rowKey={(row) => row.id}
    columns={[{ id: "name", label: "Name", value: (row) => row.name, width: 200, minWidth: 90, sortable: true }, { id: "count", label: "Count", value: (row) => row.count, width: 90 }]}
    selectedKeys={[]} onSelectionChange={() => {}} actions={[{ id: "open", label: "Open", onClick: () => {} }]} />
</main>);
