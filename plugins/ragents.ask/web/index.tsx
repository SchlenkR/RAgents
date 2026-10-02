import {
  type SessionContext,
  type WebPlugin,
  type WebPluginDescriptor,
} from "@ragents/web/PluginRegistry";
import { actorAddress, runViewFrom, type RunAction, type RunView } from "@ragents/web/run-view";
import { askPayloadComplaints, ASK_PLUGIN_ID, type AskPayload } from "../ask-payload";
import { AskActionView } from "./AskActionView";

const pendingQuestions = (view: RunView) =>
  view.actions.filter((action) => action.owner === ASK_PLUGIN_ID && action.status === "pending");

const askerHandle = (view: RunView, askedBy: string): string => {
  const asker = view.actors.find((actor) => actor.id === askedBy);
  return asker ? actorAddress(asker) : askedBy;
};

/** The card itself reports a payload it cannot read; the note then counts the call as one question of its asker. */
const readable = (action: RunAction): AskPayload | undefined =>
  askPayloadComplaints(action.payload).length === 0 ? action.payload as unknown as AskPayload : undefined;

const attentionFor = (session: SessionContext) => {
  const view = runViewFrom(session.runView);
  if (!view) return undefined;
  const [first, ...rest] = pendingQuestions(view);
  if (!first) return undefined;
  const count = [first, ...rest].reduce((sum, action) => sum + (readable(action)?.questions.length ?? 1), 0);
  return {
    active: true as const,
    label: rest.length === 0
      ? `@${askerHandle(view, readable(first)?.recipient ?? first.askedBy)} asks`
      : `${count} open questions`,
  };
};

const configuredPlugin = (descriptor: WebPluginDescriptor): WebPlugin => ({
  ...descriptor,
  needsRunView: true,
  actionViews: [{
    owner: ASK_PLUGIN_ID,
    View: AskActionView,
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
