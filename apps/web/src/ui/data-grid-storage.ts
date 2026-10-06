import { createLocalStorageSetting } from "../lib/local-storage-setting";
import { parseTableColumnWidths, type TableColumnWidths } from "./table-widths";

export type GridWidthSetting = { widths: TableColumnWidths; error?: string };
export const gridWidthsKey = (id: string) => `ragents.grid.widths:${encodeURIComponent(id)}`;
export const gridWidthSetting = createLocalStorageSetting<GridWidthSetting>({
  changeEvent: "ragents-grid-widths-change",
  matchesKey: (key) => key.startsWith("ragents.grid.widths:"),
  parse: (raw) => {
    try { return { widths: parseTableColumnWidths(raw) }; }
    catch (error) { return { widths: {}, error: `Could not read grid column widths: ${String(error)}` }; }
  },
  serialize: ({ widths }) => {
    const raw = JSON.stringify(widths);
    parseTableColumnWidths(raw);
    return raw;
  },
});
