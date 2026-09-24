import { useAccess } from "@ragents/web/AccessContext";
import type { CanvasElementContribution, CardSectionContribution, EntityReference, SessionContext, SessionNavigation } from "@ragents/web/PluginRegistry";
import { canvasTileChatInput, type CanvasTileNode } from "../tiled-layout";
import { ActorTile } from "./ActorTile";
import { FlowInspector } from "./FlowInspector";
import { TiledCanvas, type CanvasTileItem } from "./TiledCanvas";
import { actorSurface, type RunView } from "@ragents/web/run-view";

export function CanvasTiles({ root, onChange, canvasElements, cardSections, session, view, navigation, onSelect, selected }: {
  root: CanvasTileNode | null;
  onChange: (root: CanvasTileNode | null) => void;
  canvasElements: readonly CanvasElementContribution[];
  cardSections: readonly CardSectionContribution[];
  session: SessionContext;
  view: RunView;
  navigation: SessionNavigation;
  onSelect: (selection: EntityReference) => void;
  selected?: EntityReference;
}) {
  const inspect = useAccess().can("runs.inspect");
  const actors = view.actors.filter((actor) => actor.kind !== "human" && actor.lifecycle?.kind !== "stopped"
    && (inspect || actor.kind === "agent"));
  const items: CanvasTileItem[] = [
    ...actors.map((actor): CanvasTileItem => ({
      entity: `@${actor.handle}`,
      title: `${actor.displayName || actor.handle} (@${actor.handle})`,
      surface: actorSurface(view, actor),
      content: actor.kind === "agent"
        ? <ActorTile actor={actor} view={view} cardSections={cardSections} chatInput={canvasTileChatInput(root, `@${actor.handle}`)} session={session} navigation={navigation} onSelect={onSelect} />
        : <FlowInspector view={view} selection={{ type: "actor", id: actor.id }} canGoBack={false} chatSurface="canvas"
          composerVisible={false} onNavigate={onSelect} onBack={() => {}} primaryMessages={session.messages}
          actorConversations={session.actorConversations} conversationError={session.conversationError} primaryRunning={session.running} />,
    })),
    ...canvasElements.flatMap(({ Element, select }) => select(session)
      .filter((definition) => definition.visible !== false)
      .map((definition): CanvasTileItem => ({
        entity: `app:${definition.id}`,
        title: definition.title ?? definition.id,
        surface: "app",
        content: <Element definition={definition} navigation={navigation} session={session} />,
      }))),
  ];
  const selectedEntity = selected?.type === "run-app" ? `app:${selected.id}`
    : selected?.type === "actor" ? actors.find((actor) => actor.id === selected.id)?.handle : undefined;
  return <TiledCanvas root={root} onChange={onChange} items={items} canArrange={inspect}
    selectedEntity={selected?.type === "actor" && selectedEntity ? `@${selectedEntity}` : selectedEntity} />;
}
