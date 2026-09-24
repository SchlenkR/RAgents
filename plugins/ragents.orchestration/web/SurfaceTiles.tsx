import { useAccess } from "@ragents/web/AccessContext";
import type { SurfaceElementContribution, CardSectionContribution, EntityReference, SessionContext, SessionNavigation } from "@ragents/web/PluginRegistry";
import { surfaceTileChatInput, type SurfaceTileNode } from "../tiled-layout";
import { ActorTile } from "./ActorTile";
import { FlowInspector } from "./FlowInspector";
import { TiledSurface, type SurfaceTileItem } from "./TiledSurface";
import { actorTone, type RunView } from "@ragents/web/run-view";

export function SurfaceTiles({ root, onChange, surfaceElements, cardSections, session, view, navigation, onSelect, selected }: {
  root: SurfaceTileNode | null;
  onChange: (root: SurfaceTileNode | null) => void;
  surfaceElements: readonly SurfaceElementContribution[];
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
  const items: SurfaceTileItem[] = [
    ...actors.map((actor): SurfaceTileItem => ({
      entity: `@${actor.handle}`,
      title: `${actor.displayName || actor.handle} (@${actor.handle})`,
      tone: actorTone(view, actor),
      content: actor.kind === "agent"
        ? <ActorTile actor={actor} view={view} cardSections={cardSections} chatInput={surfaceTileChatInput(root, `@${actor.handle}`)} session={session} navigation={navigation} onSelect={onSelect} />
        : <FlowInspector view={view} selection={{ type: "actor", id: actor.id }} canGoBack={false} chatDisplay="surface"
          composerVisible={false} onNavigate={onSelect} onBack={() => {}} primaryMessages={session.messages}
          actorConversations={session.actorConversations} conversationError={session.conversationError} primaryRunning={session.running} />,
    })),
    ...surfaceElements.flatMap(({ Element, select }) => select(session)
      .filter((definition) => definition.visible !== false)
      .map((definition): SurfaceTileItem => ({
        entity: `app:${definition.id}`,
        title: definition.title ?? definition.id,
        tone: "app",
        content: <Element definition={definition} navigation={navigation} session={session} />,
      }))),
  ];
  const selectedEntity = selected?.type === "run-app" ? `app:${selected.id}`
    : selected?.type === "actor" ? actors.find((actor) => actor.id === selected.id)?.handle : undefined;
  return <TiledSurface root={root} onChange={onChange} items={items} canArrange={inspect}
    selectedEntity={selected?.type === "actor" && selectedEntity ? `@${selectedEntity}` : selectedEntity} />;
}
