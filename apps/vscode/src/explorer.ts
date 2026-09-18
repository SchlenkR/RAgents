import * as vscode from "vscode";
import { childNodes, parentId, rootNodes, type ExplorerNode, type ExplorerState } from "./explorer-model";

const commandFor = (node: ExplorerNode): vscode.Command | undefined => {
  switch (node.kind) {
    case "notice":
      return node.command ? { command: node.command, title: node.label } : undefined;
    case "run":
    case "actor":
      return { command: "ragents.openRun", title: "Run öffnen", arguments: [node.kind === "run" ? node.run.id : node.runId] };
    case "app":
      return { command: "ragents.openAppInCenter", title: "Mini-App in die Mitte", arguments: [node.runId, node.app.id, node.app.title] };
    case "artifact":
      return { command: "ragents.openArtifact", title: "Datei öffnen", arguments: [node.runId, node.artifact.id, node.artifact.title, node.artifact.mediaType] };
    case "journal":
      return { command: "ragents.openJournal", title: "Journal öffnen", arguments: [node.runId] };
    case "section":
      return undefined;
  }
};

const contextValueFor = (node: ExplorerNode): string => node.kind === "app" ? `app-${node.placement}` : node.kind;

const collapsibleStateFor = (node: ExplorerNode, selectedRunId: string | undefined): vscode.TreeItemCollapsibleState => {
  if (node.kind === "run") return node.run.id === selectedRunId ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  if (node.kind === "section") return node.runId === selectedRunId && node.section === "actors" ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed;
  return vscode.TreeItemCollapsibleState.None;
};

/** Der native Baum: Runs mit Zustand, darunter Actors, Mini-Apps, Dateien und Journal aus derselben Laufansicht wie im Web. */
export class ExplorerProvider implements vscode.TreeDataProvider<ExplorerNode> {
  readonly #changed = new vscode.EventEmitter<ExplorerNode | undefined>();
  readonly onDidChangeTreeData = this.#changed.event;
  readonly #nodes = new Map<string, ExplorerNode>();
  #timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly state: () => ExplorerState) {}

  refresh(): void {
    if (this.#timer !== undefined) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      this.#changed.fire(undefined);
    }, 50);
  }

  node(id: string): ExplorerNode | undefined {
    return this.#nodes.get(id);
  }

  getTreeItem(node: ExplorerNode): vscode.TreeItem {
    const item = new vscode.TreeItem(node.label, collapsibleStateFor(node, this.state().selectedRunId));
    item.id = node.id;
    item.description = node.description;
    item.tooltip = "tooltip" in node ? node.tooltip : undefined;
    const color = "color" in node && node.color !== undefined ? new vscode.ThemeColor(node.color) : undefined;
    item.iconPath = new vscode.ThemeIcon(node.icon, color);
    item.contextValue = contextValueFor(node);
    item.command = commandFor(node);
    return item;
  }

  getChildren(node?: ExplorerNode): ExplorerNode[] {
    const nodes = node === undefined ? rootNodes(this.state()) : childNodes(this.state(), node);
    for (const entry of nodes) this.#nodes.set(entry.id, entry);
    return nodes;
  }

  getParent(node: ExplorerNode): ExplorerNode | undefined {
    const parent = parentId(node);
    return parent === undefined ? undefined : this.#nodes.get(parent);
  }

  dispose(): void {
    if (this.#timer !== undefined) clearTimeout(this.#timer);
    this.#changed.dispose();
  }
}
