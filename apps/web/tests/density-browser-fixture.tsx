import { createRoot } from "react-dom/client";
import { ThemeSettings } from "../src/ThemeSettings";
import { getThemeStore, initializeTheme } from "../src/theme";
import { initializeZoom } from "../src/zoom";
import { createBrowserHost, RunPanelHostProvider } from "../src/run-panel/host";
import { DataGrid, type DataGridColumn } from "../src/ui/data-grid";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../src/ui/table";
import "../src/ui/tailwind.css";

interface Item {
  id: string;
  title: string;
  status: string;
}

const items: readonly Item[] = Array.from({ length: 20 }, (_, index) => ({ id: `item-${index + 1}`, title: `Work item ${index + 1}`, status: "Ready" }));
const columns: readonly DataGridColumn<Item>[] = [
  { id: "title", label: "Title", value: (row) => row.title, width: 240, minWidth: 100, flex: true },
  { id: "status", label: "Status", value: (row) => row.status, width: 140, minWidth: 80 },
];

initializeTheme(window);
initializeZoom(window);
declare global { interface Window { densityFixture: { store: ReturnType<typeof getThemeStore> } } }
window.densityFixture = { store: getThemeStore() };

function Samples() {
  return <section aria-label="Table samples" className="grid min-w-0 content-start gap-6">
    <Table aria-label="Simple work items">
      <TableHeader><TableRow><TableHead>Title</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
      <TableBody>{items.slice(0, 3).map((item) => <TableRow key={item.id}><TableCell>{item.title}</TableCell><TableCell>{item.status}</TableCell></TableRow>)}</TableBody>
    </Table>
    <DataGrid id="density-work-items" aria-label="Virtual work items" rows={items} columns={columns} rowKey={(row) => row.id} />
  </section>;
}

createRoot(document.getElementById("root")!).render(<RunPanelHostProvider value={createBrowserHost(window)}><main className="grid min-h-screen grid-cols-2 gap-6 bg-app p-6">
  <ThemeSettings />
  <Samples />
</main></RunPanelHostProvider>);
