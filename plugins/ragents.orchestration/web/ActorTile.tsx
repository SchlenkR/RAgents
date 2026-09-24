import type { CardSectionContribution, EntityReference, SessionContext, SessionNavigation } from "@ragents/web/PluginRegistry";
import { ActorChatPreview } from "./ActorChatPreview";
import { cardSectionsClass } from "./constants";
import type { RunActor, RunView } from "@ragents/web/run-view";

export function ActorTile({ actor, view, cardSections, chatInput, session, navigation, onSelect }: {
  actor: RunActor;
  view: RunView;
  cardSections: readonly CardSectionContribution[];
  chatInput?: boolean;
  session: SessionContext;
  navigation: SessionNavigation;
  onSelect: (selection: EntityReference) => void;
}) {
  return <div className="flex flex-col overflow-hidden has-[>[data-slot=card-sections]:not(:empty)]:min-h-[260px]">
    <ActorChatPreview actor={actor} view={view} chatInput={chatInput} running={actor.lifecycle?.kind === "running"}
      conversation={session.actorConversations?.[actor.id]} historyError={session.conversationError}
      onNavigate={onSelect} primaryMessages={actor.id === view.primaryActorId ? session.messages : undefined} />
    <div className={`${cardSectionsClass} max-h-[45%] flex-[0_1_auto] overflow-auto overscroll-contain`} data-slot="card-sections">
      {cardSections.map(({ id, Section }) => <Section actor={actor} key={id} navigation={navigation} session={session} />)}
    </div>
  </div>;
}
