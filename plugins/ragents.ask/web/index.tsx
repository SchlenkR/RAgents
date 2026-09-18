import {
  pluginRoutePrefixFrom,
  type SessionContext,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@aicontainer/web/PluginRegistry";
import { runViewFrom, type RunView } from "@aicontainer/plugins/ragents.orchestration/web/contract";
import { answerQuestion } from "./api";
import { QuestionSection } from "./QuestionSection";

const pendingQuestions = (view: RunView) =>
  view.actions.filter((action) => action.kind === "question" && action.status === "pending");

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
      ? `@${askerHandle(view, first.askedBy)} fragt`
      : `${rest.length + 1} Rückfragen offen`,
  };
};

const configuredPlugin = (descriptor: WebPluginDescriptor, routePrefix: string): WebPlugin => ({
  ...descriptor,
  needsRunView: true,
  questionResponder: (session, callId, payload) =>
    answerQuestion(routePrefix, session.id, callId, typeof payload === "string" ? payload : JSON.stringify(payload)),
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

const descriptor: WebPluginDescriptor = { id: "ragents.ask" };

export const webPlugin: WebPlugin = {
  ...descriptor,
  activate: (config) => configuredPlugin(descriptor, pluginRoutePrefixFrom(descriptor.id, config)),
};
