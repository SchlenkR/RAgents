import { createRoot } from "react-dom/client";
import type { SessionContext } from "../src/PluginRegistry";
import { ActorProgramsProvider, useActorPrograms } from "../../../plugins/ragents.actor-programs/web/AppsPanel";
import { ActorProgramSurfaceElement } from "../../../plugins/ragents.actor-programs/web/EmbeddedApps";
import type { ActorProgramsApi, ActorProgramsListing, RunAppInvocation } from "../../../plugins/ragents.actor-programs/web/api";
import type { ActorProgramsContextValue } from "../../../plugins/ragents.actor-programs/web/context";

const actor = {id: "counter", handle: "counter", kind: "agent", lifecycle: {kind: "idle"}};
const program = {pluginId: "ragents.actor-programs", scope: {kind: "actor", actorId: actor.id},
  state: {version: 1, program: {name: "counter", actorId: actor.id, actorHandle: actor.handle, revision: "build",
    views: [{id: "counter--board", title: "Board"}]}}};
const view = (id: string) => ({id, ownerId: "owner", primaryActorId: null, actors: [actor], inputs: [], turns: [],
  subscriptions: [], actions: [], artifacts: [], pluginStates: [fixture.extraView ? {...program, state: {...program.state,
    program: {...program.state.program, views: [...program.state.program.views, {id: "counter--details", title: "Details"}]}}} : program]});
const invocation = (id: string): RunAppInvocation => ({id, appId: "counter--board", actorId: actor.id, actorHandle: actor.handle,
  revision: "build", actionId: "step", requestId: id, output: [], createdAt: "now", status: "queued"});
const listing = (runId: string, source: string): ActorProgramsListing => {
  const app = {id: "counter--board", title: "Board",
  actorId: actor.id, actorHandle: actor.handle, revision: "build", actions: [], visible: true,
  invocations: fixture.polling ? [invocation("first"), invocation("second")] : [], state: {version: 1, revision: 0, values: {runId, source}}};
  return {apps: [app, ...fixture.extraView ? [{...app, id: "counter--details", title: "Details", invocations: []}] : []], tools: []};
};

type PendingList = {runId: string; source: string; signal?: AbortSignal; resolve: () => void; reject: () => void};
const fixture = {
  runId: "run", connected: true, source: "primary", mode: "fail" as "fail" | "success" | "defer",
  polling: false, extraView: false, listCalls: [] as {runId: string; source: string; time: number}[], pollCalls: [] as string[],
  pendingLists: [] as PendingList[], mutationCalls: 0, mutationPending: false,
  completeMutation: undefined as (() => void) | undefined,
  rejectMutation: undefined as (() => void) | undefined,
  current: undefined as ActorProgramsContextValue | undefined,
  render() {}, unmount() {},
};
const apiFor = (source: string): ActorProgramsApi => ({
  list: async (runId, signal) => {
    fixture.listCalls.push({runId, source, time: Date.now()});
    if (fixture.mode === "fail") throw new Error("Temporary list outage");
    if (fixture.mode === "defer") return new Promise((resolve, reject) => {
      fixture.pendingLists.push({runId, source, signal, resolve: () => resolve(listing(runId, source)), reject: () => reject(new Error("Delayed list failure"))});
    });
    return listing(runId, source);
  },
  frameUrl: () => "about:blank",
  source: async () => [],
  invoke: async (_runId, _appId, _revision, _action, requestId) => {
    fixture.mutationCalls += 1;
    if (!fixture.mutationPending) throw new Error("Mutation failed");
    return new Promise((resolve, reject) => {
      fixture.completeMutation = () => resolve({...invocation(requestId), status: "succeeded", startedAt: "now", finishedAt: "later", result: {}});
      fixture.rejectMutation = () => reject(new Error("Delayed mutation failure"));
    });
  },
  invocation: async (_runId, _appId, id) => {
    fixture.pollCalls.push(id);
    return id === "first" ? {...invocation(id), status: "succeeded", startedAt: "now", finishedAt: "later", result: {}} : invocation(id);
  },
  functionInvocation: async () => { throw new Error("Unexpected function poll"); },
  invokeFunction: async () => { throw new Error("Unexpected function mutation"); },
});
const apis = {primary: apiFor("primary"), secondary: apiFor("secondary")};
const navigation = {activeTabId: "board", openTab: () => undefined, revealEntity: () => false, selectionFor: () => undefined};
function Probe({session}: {session: SessionContext}) {
  const provider = useActorPrograms();
  fixture.current = provider;
  return <>
    <output aria-label="Provider run">{provider.runId}</output>
    <output aria-label="Provider error">{provider.error ?? ""}</output>
    <output aria-label="Provider data">{JSON.stringify(provider.listing ?? null)}</output>
    {!provider.listing && provider.error && <ActorProgramSurfaceElement session={session} navigation={navigation} definition={{id: "counter--board", title: "Board"}} />}
  </>;
}
const root = createRoot(document.getElementById("root")!);
fixture.render = () => {
  const session = {session: {id: fixture.runId}, connected: fixture.connected, runView: view(fixture.runId)} as SessionContext;
  root.render(<ActorProgramsProvider api={apis[fixture.source as keyof typeof apis]} session={session}><Probe session={session} /></ActorProgramsProvider>);
};
fixture.unmount = () => root.unmount();
declare global { interface Window { actorProgramProviderFixture: typeof fixture; } }
window.actorProgramProviderFixture = fixture;
fixture.render();
