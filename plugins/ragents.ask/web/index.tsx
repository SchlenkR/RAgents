import {
  type SessionContext,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@ragents/web/PluginRegistry";
import { runViewFrom, type RunView } from "@ragents/web/run-view";
import { askPayloadOf, ASK_PLUGIN_ID } from "../ask-payload";
import { AskActionView } from "./AskActionView";
import { QuestionSection } from "./QuestionSection";

const pendingQuestions = (view: RunView) =>
  view.actions.filter((action) => action.owner === ASK_PLUGIN_ID && action.status === "pending");

const askerHandle = (view: RunView, askedBy: string): string =>
  view.actors.find((actor) => actor.id === askedBy)?.handle ?? askedBy;

const attentionFor = (session: SessionContext) => {
  const view = runViewFrom(session.runView);
  if (!view) return undefined;
  const [first, ...rest] = pendingQuestions(view);
  if (!first) return undefined;
  return {
    active: true as const,
    label: rest.length === 0
      ? `@${askerHandle(view, askPayloadOf(first.payload)?.recipient ?? first.askedBy)} fragt`
      : `${rest.length + 1} Rückfragen offen`,
  };
};

const configuredPlugin = (descriptor: WebPluginDescriptor): WebPlugin => ({
  ...descriptor,
  needsRunView: true,
  actionViews: [{
    owner: ASK_PLUGIN_ID,
    View: AskActionView,
  }],
  cardSections: [{
    id: "ragents.ask.questions",
    order: 100,
    Section: QuestionSection,
  }],
  attention: [{
    id: "ragents.ask.pending-questions",
    assess: attentionFor,
  }],
});

const descriptor: WebPluginDescriptor = { id: ASK_PLUGIN_ID };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: () => configuredPlugin(descriptor),
};
