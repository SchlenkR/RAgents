import { ArrowLeftIcon, WrenchIcon } from "lucide-react";
import { useAccess } from "@ragents/web/AccessContext";
import { Badge, Button, Empty, EmptyDescription, EmptyHeader, EmptyTitle, Input, Tabs, TabsContent, TabsList, TabsTrigger } from "@ragents/web/ui";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { ActorChat } from "./ActorChat";
import { ChatViewSwitches, useChatViewSettings } from "@ragents/web/chat-view-settings";
import { ActorChatControls } from "./ActorChatControls";
import type { Message } from "quassel/events";
import {
  isPendingRunActorInput,
  runArtifactContentUrl,
  type RunAction,
  type RunActor,
  type RunActorInput,
  type RunArtifact,
  type RunCapabilityGrant,
  type RunSubscription,
  type RunTurn,
  type RunUsage,
  type RunView,
} from "@ragents/web/run-view";
import { actorInputLabel } from "@ragents/web/actor-conversation";
import { resolveAction, restartActor, stopActor } from "./api";
import { formatBytes } from "@ragents/web/lib/format";
import { SourceCode } from "@ragents/web/SourceCode";
import { thinkingLabel } from "@ragents/web/lib/labels";
import { formatTime } from "./format";
import { useProgramSlot } from "./program-slot";

export interface FlowSelection {
  type: "actor" | "input" | "turn" | "subscription" | "action" | "artifact";
  id: string;
}

interface FlowInspectorProps {
  view: RunView | undefined;
  selection: FlowSelection | undefined;
  canGoBack: boolean;
  composerVisible: boolean;
  onNavigate: (selection: FlowSelection) => void;
  onBack: () => void;
  primaryMessages: Message[];
  actorConversations?: Readonly<Record<string, readonly Message[]>>;
  conversationError?: string;
  primaryRunning: boolean;
}

const inspectorClass = "flex h-full min-h-0 flex-col bg-inherit";

const headClass = "flex flex-shrink-0 items-start gap-2.5 border-b border-border-soft px-workspace-inset pt-3 pb-2 [&_h2]:text-[0.95rem] [&_h2]:leading-[1.3]";

const subtitleClass = "block truncate text-[0.72rem] text-muted-foreground";

const statusClass = "flex flex-shrink-0 flex-wrap items-center gap-x-2.5 gap-y-0.5 border-b border-border-soft px-workspace-inset py-1.5 text-[0.72rem] text-muted-foreground";

const scrollClass = "min-h-0 flex-1 overflow-y-auto px-workspace-inset py-2.5";

const sectionClass = "mb-4 [&>h3]:mb-1.5 [&>h3]:text-[0.72rem] [&>h3]:font-semibold [&>h3]:tracking-[0.05em] [&>h3]:uppercase [&>h3]:text-muted-foreground";

const rowsClass = "flex flex-col gap-1 py-1.5";

const rowClass = "flex cursor-pointer items-center gap-2 rounded-lg border border-border-soft px-2 py-1.5 text-left hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-primary/6 [&_strong]:truncate [&_strong]:text-[0.76rem] [&_small]:text-[0.66rem] [&_small]:text-muted-foreground";

const rowCopyClass = "flex min-w-0 flex-1 flex-col";

const mutedClass = "text-[0.74rem] text-muted-foreground";

const errorClass = "my-1.5 text-[0.72rem] text-destructive";

const propertiesClass = "my-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[0.74rem] [&_dt]:text-muted-foreground [&_dd]:[overflow-wrap:anywhere]";

const textBlockClass = "my-1.5 rounded-lg bg-foreground/4 p-2 text-[0.72rem] whitespace-pre-wrap [overflow-wrap:anywhere]";

const linkClass = "cursor-pointer text-[0.74rem] text-primary underline";

const pillClass = "h-auto rounded-full bg-foreground/8 px-2 py-0.5 text-[0.66rem] font-semibold text-muted-foreground";

const pillToneClass: Readonly<Record<string, string>> = {
  running: "bg-accent text-primary",
  active: "bg-success-soft text-success",
  approved: "bg-success-soft text-success",
  completed: "bg-success-soft text-success",
  idle: "bg-success-soft text-success",
  pending: "bg-success-soft text-success",
  waiting: "bg-success-soft text-success",
  queued: "bg-success-soft text-success",
  failed: "bg-destructive-soft text-destructive",
  interrupted: "bg-destructive-soft text-destructive",
};

const tabClass = "grid size-6 flex-none place-items-center p-0";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  approved: "Approved",
  completed: "Completed",
  dismissed: "Dismissed",
  failed: "Failed",
  idle: "Ready",
  interrupted: "Interrupted",
  pending: "Open",
  removed: "Removed",
  running: "Running",
  stopped: "Stopped",
};

const ACTOR_KIND_LABELS: Record<RunActor["kind"], string> = {
  human: "Person",
  agent: "Agent",
  script: "Logic actor",
};

const STOP_REASON = "Stopped by the operator";

const shortId = (id: string) => (id.length > 12 ? `${id.slice(0, 12)}...` : id);

const turnUsageOf = (turn: RunTurn): Partial<RunUsage> | undefined => {
  const usage: Partial<RunUsage> | undefined = turn.usage;
  return usage;
};

const runCostUsd = (view: RunView): number | undefined => {
  const costs = view.turns
    .map((turn) => turnUsageOf(turn)?.costUsd)
    .filter((cost): cost is number => typeof cost === "number" && Number.isFinite(cost));
  return costs.length > 0 ? costs.reduce((sum, cost) => sum + cost, 0) : undefined;
};

const formatCostUsd = (value: number) =>
  `${value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: value > 0 && value < 0.005 ? 4 : 2 })} USD`;

interface RunIndex {
  view: RunView;
  actorById: Map<string, RunActor>;
  inputById: Map<string, RunActorInput>;
  turnById: Map<string, RunTurn>;
  subscriptionById: Map<string, RunSubscription>;
  actionById: Map<string, RunAction>;
  artifactById: Map<string, RunArtifact>;
}

const indexOf = (view: RunView): RunIndex => ({
  view,
  actorById: new Map(view.actors.map((entry) => [entry.id, entry])),
  inputById: new Map(view.inputs.map((entry) => [entry.id, entry])),
  turnById: new Map(view.turns.map((entry) => [entry.id, entry])),
  subscriptionById: new Map(view.subscriptions.map((entry) => [entry.id, entry])),
  actionById: new Map(view.actions.map((entry) => [entry.id, entry])),
  artifactById: new Map(view.artifacts.map((entry) => [entry.id, entry])),
});

const actorLabel = (index: RunIndex, actorId: string) =>
  `@${index.actorById.get(actorId)?.handle ?? shortId(actorId)}`;

const inputDeliveryLabel = (index: RunIndex, input: RunActorInput) =>
  actorInputLabel(index.view, input);

export function FlowInspector(props: FlowInspectorProps) {
  const inspect = useAccess().can("runs.inspect");
  const view = props.view;
  const index = useMemo(() => (view ? indexOf(view) : undefined), [view]);

  if (!view || !index) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No flow yet</EmptyTitle>
          <EmptyDescription>As soon as actors are started, the detail view appears here.</EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const selection = props.selection;
  const actor = selection?.type === "actor" ? index.actorById.get(selection.id) : undefined;
  const input = selection?.type === "input" ? index.inputById.get(selection.id) : undefined;
  const turn = selection?.type === "turn" ? index.turnById.get(selection.id) : undefined;
  const subscription = selection?.type === "subscription" ? index.subscriptionById.get(selection.id) : undefined;
  const action = selection?.type === "action" ? index.actionById.get(selection.id) : undefined;
  const artifact = selection?.type === "artifact" ? index.artifactById.get(selection.id) : undefined;
  const fallbackActor = index.actorById.get(view.primaryActorId ?? view.ownerId) ?? view.actors[0];

  if (!inspect) {
    const conversationActor = actor ?? fallbackActor;
    return conversationActor?.kind === "agent" ? <ActorView actor={conversationActor} index={index} key={conversationActor.id} {...props} /> : null;
  }

  if (input) return <InputView index={index} input={input} key={input.id} {...props} />;
  if (turn) return <TurnView index={index} key={turn.id} turn={turn} {...props} />;
  if (subscription) return <SubscriptionView index={index} key={subscription.id} subscription={subscription} {...props} />;
  if (action) return <ActionView action={action} index={index} key={action.id} {...props} />;
  if (artifact) return <ArtifactView artifact={artifact} index={index} key={artifact.id} {...props} />;
  if (actor) return <ActorView actor={actor} index={index} key={actor.id} {...props} />;
  if (fallbackActor) return <ActorView actor={fallbackActor} index={index} key={fallbackActor.id} {...props} />;

  return <Empty><EmptyHeader><EmptyTitle>No actors</EmptyTitle></EmptyHeader></Empty>;
}

function BackButton({ canGoBack, onBack }: { canGoBack: boolean; onBack: () => void }) {
  if (!canGoBack) return null;
  return <Button aria-label="Back" className="rounded-full" onClick={onBack} size="icon" variant="outline"><ArrowLeftIcon /></Button>;
}

function StatusPill({ status }: { status: string }) {
  return <Badge className={`${pillClass} ${pillToneClass[status] ?? ""}`}>{STATUS_LABELS[status] ?? status}</Badge>;
}

type SectionTab = {
  id: string;
  label: string;
  count?: number;
  icon: ReactNode;
  content: ReactNode;
};

const sectionIconPaths = {
  chat: "M21 11a8 8 0 0 1-8 8H7l-5 3V11a8 8 0 0 1 8-8h3a8 8 0 0 1 8 8ZM7 9h9M7 13h6",
  info: "M12 11v6M12 7h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
  prompt: "M6 3h12v18H6zM9 7h6M9 11h6M9 15h4",
  source: "m8 5-6 7 6 7m8-14 6 7-6 7m-3-15-2 16",
  settings: "M4 6h16M4 12h16M4 18h16M8 3v6M16 9v6M10 15v6",
  inputs: "M12 3v12m-4-4 4 4 4-4M4 14v7h16v-7",
  turns: "M20 7v5h-5M4 17v-5h5M6 7a7 7 0 0 1 12-2l2 3M4 16l2 3a7 7 0 0 0 12-2",
  subscriptions: "M12 3v6M4 15v-3h16v3M12 12v3M2 15h4v6H2zM10 15h4v6h-4zM18 15h4v6h-4z",
  actions: "m13 2-9 12h7l-1 8 10-13h-7z",
  artifacts: "M3 6h7l2 3h9v12H3zM3 6V3h7l2 3h7v3",
  capabilities: "m12 2 9 4v6c0 5-9 10-9 10S3 17 3 12V6zM8 12l3 3 5-6",
};

function SectionIcon({ kind }: { kind: keyof typeof sectionIconPaths }) {
  return <svg aria-hidden="true" fill="none" height="15" width="15" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={sectionIconPaths[kind]} /></svg>;
}

function SectionTabs({ sections, children, toolbar }: { sections: SectionTab[]; children: ReactNode; toolbar?: ReactNode }) {
  const id = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const open = sections.find((section) => section.id === openId);
  if (sections.length === 0) return <><div className="flex h-8 flex-none items-center gap-1 overflow-x-auto border-b border-border-soft px-1">{toolbar}</div>{children}</>;

  return (
    <Tabs className="contents" onValueChange={(value) => setOpenId(value === "chat" ? null : String(value))} value={open?.id ?? "chat"}>
      <div aria-label="Actor toolbar" className="flex h-8 flex-none items-center gap-1 overflow-x-auto border-b border-border-soft px-1">
        {toolbar}
        <TabsList aria-label="Actor views" className="flex h-7 w-auto flex-none flex-nowrap justify-start gap-0 rounded-none p-0" variant="line">
          <TabsTrigger aria-label="Show chat" className={tabClass} id={`${id}-chat-tab`} title="Show chat" value="chat">
            <SectionIcon kind="chat" />
          </TabsTrigger>
          {sections.map((section) => (
            <TabsTrigger
              aria-label={section.count === undefined ? section.label : `${section.label} (${section.count})`}
              className={tabClass}
              id={`${id}-${section.id}-tab`}
              key={section.id}
              title={section.count === undefined ? section.label : `${section.label} (${section.count})`}
              value={section.id}
            >
              {section.icon}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {open && <TabsContent className="min-h-0 flex-1 overflow-y-auto border-b border-border-soft px-workspace-inset py-1.5 text-[0.76rem]" id={`${id}-details`} tabIndex={0} value={open.id}>{open.content}</TabsContent>}
      <TabsContent className="flex min-h-0 flex-1 flex-col" id={`${id}-chat`} keepMounted value="chat">{children}</TabsContent>
    </Tabs>
  );
}

function CapabilityList({ grants }: { grants: RunCapabilityGrant[] }) {
  if (grants.length === 0) return <Badge className={pillClass}>No capabilities</Badge>;
  return (
    <div className="flex flex-wrap gap-1 py-1.5">
      {grants.map((grant, position) => {
        const scope = grant.scope.kind === "workspace" ? grant.scope.path : "Run";
        const suffix = [
          grant.delegable ? "delegable" : undefined,
          grant.usable === false ? "pass on only" : undefined,
        ].filter(Boolean).join(", ");
        return (
          <span className="rounded-full border border-border-soft px-2 py-0.5 text-[0.68rem] [&>small]:text-muted-foreground" key={`${grant.capability}-${position}`} title={scope}>
            {grant.capability}
            {suffix && <small> {suffix}</small>}
          </span>
        );
      })}
    </div>
  );
}

const actionClass = "my-1.5 rounded-lg border border-[color-mix(in_srgb,var(--primary)_35%,var(--border))] bg-primary/5 px-2.5 py-2 [&>p]:my-1 [&>p]:text-[0.72rem] [&>p]:text-muted-foreground";

function ActionCard({ action, runId, onError }: { action: RunAction; runId: string; onError: (message: string) => void }) {
  const writable = useAccess().can("runs.write");
  const [response, setResponse] = useState("");
  const [busy, setBusy] = useState(false);

  const resolve = async (decision: "approved" | "dismissed", answer: string | undefined) => {
    if (busy) return;
    setBusy(true);
    try {
      await resolveAction(runId, action.id, decision, answer);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={actionClass}>
      <strong>{action.title}</strong>
      {action.description && <p>{action.description}</p>}
      {action.owner && <p>waiting for input - {action.owner}</p>}
      {action.input && (
        <Input
          className="my-1.5 text-[0.76rem]"
          disabled={!writable}
          onChange={(event) => setResponse(event.target.value)}
          placeholder={action.input.placeholder ?? action.input.label}
          type="text"
          value={response}
        />
      )}
      <div className="mt-1 flex justify-end gap-1.5">
        <Button disabled={!writable || busy} onClick={() => void resolve("dismissed", undefined)} size="sm" variant="outline">
          Dismiss
        </Button>
        <Button
          disabled={!writable || busy || (action.input?.required === true && response.trim() === "")}
          onClick={() => void resolve("approved", response.trim() || undefined)}
          size="sm"
        >
          Acknowledge
        </Button>
      </div>
    </div>
  );
}

function SourceListing({ handle, source }: { handle: string; source: string }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border-soft bg-border-soft/22">
      <SourceCode content={source} language="typescript" lineNumbers path={`${handle}.ts`} />
    </div>
  );
}

function ActorView({ actor, index, ...props }: FlowInspectorProps & { actor: RunActor; index: RunIndex }) {
  const access = useAccess();
  const programs = useProgramSlot();
  const writable = access.can("runs.write");
  const chatView = useChatViewSettings(index.view.id, actor.id, "agents", "inspector");
  const inspect = access.can("runs.inspect");
  const view = index.view;
  const programSource = inspect && programs?.runId === view.id ? programs.source(view, actor.id) : undefined;
  const [error, setError] = useState<string>();
  const inputs = view.inputs.filter((entry) => entry.actorId === actor.id).sort((left, right) => left.sequence - right.sequence);
  const turns = view.turns.filter((entry) => entry.actorId === actor.id).sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const subscriptions = view.subscriptions.filter((entry) => entry.subscriberId === actor.id);
  const actions = view.actions.filter((entry) => entry.askedBy === actor.id);
  const artifacts = view.artifacts.filter((entry) => entry.createdBy === actor.id);
  const pendingInputCount = inputs.filter(isPendingRunActorInput).length;
  const primary = actor.id === view.primaryActorId;
  const runCost = primary ? runCostUsd(view) : undefined;
  const active = actor.kind !== "human" && actor.lifecycle?.kind !== "stopped";
  const lifecycle = actor.kind === "human" ? undefined : actor.lifecycle?.kind ?? "idle";
  const inputsConfig = Object.entries(actor.inputs ?? {});
  const driver = actor.execution?.driver;
  const driverLabel = actor.kind === "script"
    ? "TypeScript"
    : !driver || driver.kind === "manual"
      ? "Manual"
      : [driver.kind, driver.config.provider].filter(Boolean).join(" - ");

  const config = driver && driver.kind !== "manual" ? driver.config : undefined;
  const sections: SectionTab[] = [
    { id: "info", label: "Info: model and run details", icon: <SectionIcon kind="info" />, content: (
      <div className={statusClass}>
        {lifecycle && <StatusPill status={lifecycle} />}
        <span>{primary ? "Primary actor" : ACTOR_KIND_LABELS[actor.kind]}</span>
        <span>{driverLabel}</span>
        {config?.model && <span className="max-w-[220px] truncate" title={config.model}>{config.model}</span>}
        {config?.thinking && <span>Thinking level {thinkingLabel(config.thinking)}</span>}
        <span>{pendingInputCount} open</span>
        <span>{turns.length} Turns</span>
        {primary && runCost !== undefined && (
          <span title="Total cost of the run across all turns">{formatCostUsd(runCost)}</span>
        )}
      </div>
    ) },
    ...(actor.prompt ? [{
      id: "prompt",
      label: "Task",
      icon: <SectionIcon kind="prompt" />,
      content: <pre className={textBlockClass}>{actor.prompt}</pre>,
    }] : []),
    ...(programSource ? [{
      id: "source",
      label: "Source code",
      icon: <SectionIcon kind="source" />,
      content: programSource,
    }] : actor.source ? [{
      id: "source",
      label: "Source code",
      icon: <SectionIcon kind="source" />,
      count: actor.source.replace(/\n$/, "").split("\n").length,
      content: <SourceListing handle={actor.handle} source={actor.source} />,
    }] : []),
    ...(inputsConfig.length > 0 ? [{
      id: "settings",
      label: "Settings",
      icon: <SectionIcon kind="settings" />,
      count: inputsConfig.length,
      content: (
        <dl className={propertiesClass}>
          {inputsConfig.map(([name, value]) => <span key={name}><dt>{name}</dt><dd>{value}</dd></span>)}
        </dl>
      ),
    }] : []),
    {
      id: "inputs",
      label: "Inputs",
      icon: <SectionIcon kind="inputs" />,
      count: inputs.length,
      content: (
        <div className={rowsClass}>
          {inputs.map((input) => (
            <button className={rowClass} key={input.id} onClick={() => props.onNavigate({ type: "input", id: input.id })} type="button">
              <span className={rowCopyClass}><strong>{input.content}</strong><small>{inputDeliveryLabel(index, input)} - {formatTime(input.enqueuedAt)}</small></span>
              <StatusPill status={input.lifecycle.kind === "discarded" ? "dismissed" : input.lifecycle.kind === "claimed" ? index.turnById.get(input.lifecycle.turnId)?.status ?? "completed" : "pending"} />
            </button>
          ))}
        </div>
      ),
    },
    {
      id: "turns",
      label: "Turns",
      icon: <SectionIcon kind="turns" />,
      count: turns.length,
      content: (
        <div className={rowsClass}>
          {turns.map((turn) => (
            <button className={rowClass} key={turn.id} onClick={() => props.onNavigate({ type: "turn", id: turn.id })} type="button">
              <span className={rowCopyClass}><strong>{shortId(turn.id)}</strong><small>{formatTime(turn.startedAt)}</small></span>
              <StatusPill status={turn.status} />
            </button>
          ))}
        </div>
      ),
    },
    {
      id: "subscriptions",
      label: "Subscriptions",
      icon: <SectionIcon kind="subscriptions" />,
      count: subscriptions.length,
      content: (
        <div className={rowsClass}>
          {subscriptions.map((subscription) => (
            <button className={rowClass} key={subscription.id} onClick={() => props.onNavigate({ type: "subscription", id: subscription.id })} type="button">
              <span className={rowCopyClass}><strong>{subscription.eventTypes.join(", ")}</strong><small>{shortId(subscription.id)}</small></span>
              <StatusPill status={subscription.status} />
            </button>
          ))}
        </div>
      ),
    },
    ...(actions.length > 0 ? [{
      id: "actions",
      label: "Actions",
      icon: <SectionIcon kind="actions" />,
      count: actions.length,
      content: (
        <div className={rowsClass}>
          {actions.map((action) => (
            <button className={rowClass} key={action.id} onClick={() => props.onNavigate({ type: "action", id: action.id })} type="button">
              <span className={rowCopyClass}><strong>{action.title}</strong><small>{formatTime(action.proposedAt)}</small></span>
              <StatusPill status={action.status} />
            </button>
          ))}
        </div>
      ),
    }] : []),
    ...(artifacts.length > 0 ? [{
      id: "artifacts",
      label: "Artifacts",
      icon: <SectionIcon kind="artifacts" />,
      count: artifacts.length,
      content: (
        <div className={rowsClass}>
          {artifacts.map((artifact) => (
            <button className={rowClass} key={artifact.id} onClick={() => props.onNavigate({ type: "artifact", id: artifact.id })} type="button">
              <span className={rowCopyClass}><strong>{artifact.title}</strong><small>{formatBytes(artifact.size)} - {artifact.mediaType}</small></span>
            </button>
          ))}
        </div>
      ),
    }] : []),
    {
      id: "capabilities",
      label: "Capabilities",
      icon: <SectionIcon kind="capabilities" />,
      count: actor.grants.length,
      content: <CapabilityList grants={actor.grants} />,
    },
    {
      id: "tools",
      label: "Tools",
      icon: <WrenchIcon size={15} />,
      ...(actor.toolNames ? { count: actor.toolNames.length } : {}),
      content: (
        <p className={mutedClass}>
          {actor.toolNames === null ? "All available tools" : actor.toolNames?.join(", ") || "No tools"}
        </p>
      ),
    },
  ];

  return (
    <div className={inspectorClass}>
      {error && <p className={errorClass}>{error}</p>}
      <SectionTabs sections={inspect ? sections : []} toolbar={<>
        <BackButton canGoBack={props.canGoBack} onBack={props.onBack} />
        <span className="max-w-28 flex-none truncate text-xs font-semibold" title={`${actor.displayName} @${actor.handle}${inspect && actor.createdBy ? ` - created by ${actorLabel(index, actor.createdBy)}` : ""}`}>{actor.displayName}</span>
        {active && writable && (
          <Button
            className="flex-shrink-0"
            onClick={() => void stopActor(view.id, actor.id, STOP_REASON).catch((caught: Error) => setError(caught.message))}
            size="sm"
            title={`Stop @${actor.handle} and its assigned children permanently; the chat input, in contrast, only interrupts the running turn`}
            variant="destructive"
          >
            Stop
          </Button>
        )}
        {inspect && writable && actor.lifecycle?.kind === "stopped" && actor.kind !== "human" && (
          <Button
            onClick={() => void restartActor(view.id, actor.id).catch((caught: Error) => setError(caught.message))}
            size="sm"
            variant="outline"
          >
            Restart
          </Button>
        )}
        {!props.composerVisible && <ChatViewSwitches className="size-6 flex-none" settings={chatView} />}
      </>}>
        <ActorChat
          actor={actor}
          view={view}
          presentation="inspector"
          display="inspector"
          className="min-h-0 flex-1 [--qsl-chat-message-gap:10px]"
          primaryMessages={props.primaryMessages}
          conversation={props.actorConversations?.[actor.id]}
          historyError={props.conversationError}
          onNavigate={props.onNavigate}
          running={primary ? props.primaryRunning : lifecycle === "running"}
        />
        {props.composerVisible && <ActorChatControls actor={actor} view={view} composerVisible={props.composerVisible} display="inspector"
          running={primary ? props.primaryRunning : lifecycle === "running"} />}
      </SectionTabs>
    </div>
  );
}

function DetailHeader({ eyebrow, title, subtitle, ...props }: {
  eyebrow: string;
  title: string;
  subtitle: string;
  canGoBack: boolean;
  onBack: () => void;
}) {
  return (
    <header className={headClass}>
      <BackButton canGoBack={props.canGoBack} onBack={props.onBack} />
      <div className="min-w-0 flex-1"><p className="mb-0.5 text-[0.66rem] font-semibold tracking-[0.08em] uppercase text-muted-foreground">{eyebrow}</p><h2>{title}</h2><span className={subtitleClass}>{subtitle}</span></div>
    </header>
  );
}

function InputView({ index, input, ...props }: FlowInspectorProps & { index: RunIndex; input: RunActorInput }) {
  const artifacts = input.artifactIds.flatMap((id) => {
    const artifact = index.artifactById.get(id);
    return artifact ? [artifact] : [];
  });
  return (
    <div className={inspectorClass}>
      <DetailHeader canGoBack={props.canGoBack} eyebrow="ActorInput" onBack={props.onBack} subtitle={formatTime(input.enqueuedAt)} title={shortId(input.id)} />
      <div className={scrollClass}>
        <section className={sectionClass}><h3>Content</h3><pre className={textBlockClass}>{input.content}</pre></section>
        <section className={sectionClass}>
          <h3>Routing</h3>
          <dl className={propertiesClass}>
            <dt>Actor</dt><dd><EntityLink id={input.actorId} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Enqueued by</dt><dd><EntityLink id={input.enqueuedBy} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Turn</dt><dd>{input.lifecycle.kind === "claimed" ? <SelectionLink label={shortId(input.lifecycle.turnId)} onNavigate={props.onNavigate} selection={{ type: "turn", id: input.lifecycle.turnId }} /> : input.lifecycle.kind === "discarded" ? "dismissed" : "waiting"}</dd>
            <dt>Subscription</dt><dd>{input.subscriptionId ? <SelectionLink label={shortId(input.subscriptionId)} onNavigate={props.onNavigate} selection={{ type: "subscription", id: input.subscriptionId }} /> : "none"}</dd>
            {input.lifecycle.kind === "discarded" && <>
              <dt>Dismissed</dt><dd>{formatTime(input.lifecycle.at)}</dd>
              <dt>Reason</dt><dd>{input.lifecycle.reason}</dd>
            </>}
          </dl>
        </section>
        {input.sourceEventIds.length > 0 && <section className={sectionClass}><h3>Source events</h3><p className={mutedClass}>{input.sourceEventIds.join(", ")}</p></section>}
        {artifacts.length > 0 && <ArtifactRows artifacts={artifacts} onNavigate={props.onNavigate} />}
      </div>
    </div>
  );
}

function TurnView({ index, turn, ...props }: FlowInspectorProps & { index: RunIndex; turn: RunTurn }) {
  const usage = turnUsageOf(turn);
  return (
    <div className={inspectorClass}>
      <DetailHeader canGoBack={props.canGoBack} eyebrow="Turn" onBack={props.onBack} subtitle={formatTime(turn.startedAt)} title={shortId(turn.id)} />
      <div className={statusClass}><StatusPill status={turn.status} /></div>
      <div className={scrollClass}>
        <section className={sectionClass}>
          <h3>Details</h3>
          <dl className={propertiesClass}>
            <dt>Actor</dt><dd><EntityLink id={turn.actorId} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Input</dt><dd><SelectionLink label={shortId(turn.inputId)} onNavigate={props.onNavigate} selection={{ type: "input", id: turn.inputId }} /></dd>
            <dt>Ended</dt><dd>{turn.finishedAt ? formatTime(turn.finishedAt) : "running"}</dd>
            {turn.reason && <><dt>Reason</dt><dd>{turn.reason}</dd></>}
          </dl>
        </section>
        {usage && (
          <section className={sectionClass}>
            <h3>Usage</h3>
            <dl className={propertiesClass}>
              <dt>Input tokens</dt><dd>{usage.inputTokens ?? 0}</dd>
              <dt>Output tokens</dt><dd>{usage.outputTokens ?? 0}</dd>
              <dt>Cache read</dt><dd>{usage.cacheReadTokens ?? 0}</dd>
              <dt>Cache written</dt><dd>{usage.cacheWriteTokens ?? 0}</dd>
              <dt>Cost</dt><dd>{(usage.costUsd ?? 0).toFixed(6)} USD</dd>
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}

function SubscriptionView({ index, subscription, ...props }: FlowInspectorProps & { index: RunIndex; subscription: RunSubscription }) {
  return (
    <div className={inspectorClass}>
      <DetailHeader canGoBack={props.canGoBack} eyebrow="Subscription" onBack={props.onBack} subtitle={formatTime(subscription.createdAt)} title={shortId(subscription.id)} />
      <div className={statusClass}><StatusPill status={subscription.status} /></div>
      <div className={scrollClass}>
        <section className={sectionClass}>
          <h3>Filter</h3>
          <dl className={propertiesClass}>
            <dt>Subscriber</dt><dd><EntityLink id={subscription.subscriberId} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Source actors</dt><dd>{subscription.sourceActorIds?.map((id) => actorLabel(index, id)).join(", ") ?? "all"}</dd>
            <dt>Actor kinds</dt><dd>{subscription.sourceActorKinds?.join(", ") ?? "all"}</dd>
            <dt>Event types</dt><dd>{subscription.eventTypes.join(", ")}</dd>
            <dt>Own events</dt><dd>{subscription.includeSelf ? "yes" : "no"}</dd>
            <dt>Created by</dt><dd><EntityLink id={subscription.createdBy} index={index} onNavigate={props.onNavigate} /></dd>
            {subscription.status !== "active" && <><dt>Reason</dt><dd>{subscription.reason}</dd></>}
            {subscription.status === "failed" && <><dt>Error event</dt><dd>{subscription.sourceEventId}</dd></>}
          </dl>
        </section>
        {subscription.sourceActorIds && <section className={sectionClass}><h3>Source actors</h3><ActorRows actorIds={subscription.sourceActorIds} index={index} onNavigate={props.onNavigate} /></section>}
      </div>
    </div>
  );
}

function ActionView({ action, index, ...props }: FlowInspectorProps & { action: RunAction; index: RunIndex }) {
  const [error, setError] = useState<string>();
  return (
    <div className={inspectorClass}>
      <DetailHeader canGoBack={props.canGoBack} eyebrow="Action" onBack={props.onBack} subtitle={actorLabel(index, action.askedBy)} title={action.title} />
      <div className={statusClass}><StatusPill status={action.status} /></div>
      <div className={scrollClass}>
        {action.status === "pending" && <ActionCard action={action} onError={setError} runId={index.view.id} />}
        {action.description && <section className={sectionClass}><h3>Description</h3><p>{action.description}</p></section>}
        <section className={sectionClass}>
          <h3>Details</h3>
          <dl className={propertiesClass}>
            <dt>Asked by</dt><dd><EntityLink id={action.askedBy} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Proposed</dt><dd>{formatTime(action.proposedAt)}</dd>
            {action.resolvedAt && <><dt>Resolved</dt><dd>{formatTime(action.resolvedAt)}</dd></>}
            {action.owner && <><dt>Owner</dt><dd>{action.owner}</dd></>}
            {action.result !== null && action.result !== undefined && <><dt>Result</dt><dd>{typeof action.result === "string" ? action.result : JSON.stringify(action.result)}</dd></>}
          </dl>
        </section>
        {Object.keys(action.parameters).length > 0 && <section className={sectionClass}><h3>Parameters</h3><pre className={textBlockClass}>{JSON.stringify(action.parameters, null, 2)}</pre></section>}
        {action.payload !== null && action.payload !== undefined && <section className={sectionClass}><h3>Payload</h3><pre className={textBlockClass}>{JSON.stringify(action.payload, null, 2)}</pre></section>}
        {error && <p className={errorClass}>{error}</p>}
      </div>
    </div>
  );
}

function SelectionLink({ label, onNavigate, selection }: {
  label: string;
  onNavigate: (selection: FlowSelection) => void;
  selection: FlowSelection;
}) {
  return <button className={linkClass} onClick={() => onNavigate(selection)} type="button">{label}</button>;
}

function EntityLink({ id, index, onNavigate }: { id: string; index: RunIndex; onNavigate: (selection: FlowSelection) => void }) {
  return <SelectionLink label={actorLabel(index, id)} onNavigate={onNavigate} selection={{ type: "actor", id }} />;
}

function ActorRows({ actorIds, index, onNavigate }: {
  actorIds: string[];
  index: RunIndex;
  onNavigate: (selection: FlowSelection) => void;
}) {
  return (
    <div className={rowsClass}>
      {actorIds.map((id) => {
        const actor = index.actorById.get(id);
        return (
          <button className={rowClass} key={id} onClick={() => onNavigate({ type: "actor", id })} type="button">
            <span className={rowCopyClass}><strong>{actor?.displayName ?? shortId(id)}</strong><small>{actorLabel(index, id)}</small></span>
            {actor && <Badge className={pillClass}>{ACTOR_KIND_LABELS[actor.kind]}</Badge>}
          </button>
        );
      })}
    </div>
  );
}

function ArtifactRows({ artifacts, onNavigate }: { artifacts: RunArtifact[]; onNavigate: (selection: FlowSelection) => void }) {
  return (
    <section className={sectionClass}>
      <h3>Artifacts</h3>
      <div className={rowsClass}>
        {artifacts.map((artifact) => (
          <button className={rowClass} key={artifact.id} onClick={() => onNavigate({ type: "artifact", id: artifact.id })} type="button">
            <span className={rowCopyClass}><strong>{artifact.title}</strong><small>{formatBytes(artifact.size)} - {artifact.mediaType}</small></span>
          </button>
        ))}
      </div>
    </section>
  );
}

type ArtifactContent =
  | { kind: "loading" }
  | { kind: "image" }
  | { kind: "download" }
  | { kind: "text"; text: string }
  | { kind: "error"; message: string };

const isTextMedia = (mediaType: string) => {
  const lower = mediaType.toLowerCase();
  return lower.startsWith("text/") || lower.includes("json") || lower.includes("xml") || lower.includes("yaml");
};

interface ArtifactContentHandle {
  content: ArtifactContent | undefined;
  retry: () => void;
}

function useArtifactContent(runId: string, artifact: RunArtifact | undefined): ArtifactContentHandle {
  const cacheRef = useRef(new Map<string, ArtifactContent>());
  const [version, setVersion] = useState(0);
  const artifactId = artifact?.id;

  const retry = () => {
    if (artifactId) cacheRef.current.delete(artifactId);
    setVersion((value) => value + 1);
  };

  useEffect(() => {
    if (!artifact || cacheRef.current.has(artifact.id)) return;
    if (artifact.mediaType.toLowerCase().startsWith("image/")) {
      cacheRef.current.set(artifact.id, { kind: "image" });
      setVersion((value) => value + 1);
      return;
    }
    if (!isTextMedia(artifact.mediaType)) {
      cacheRef.current.set(artifact.id, { kind: "download" });
      setVersion((value) => value + 1);
      return;
    }
    cacheRef.current.set(artifact.id, { kind: "loading" });
    setVersion((value) => value + 1);
    void (async () => {
      try {
        const response = await fetch(runArtifactContentUrl(runId, artifact.id), { headers: { Accept: artifact.mediaType } });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        let text = await response.text();
        if (artifact.mediaType.toLowerCase().includes("json")) {
          try {
            text = JSON.stringify(JSON.parse(text), null, 2);
          } catch {
          }
        }
        cacheRef.current.set(artifact.id, { kind: "text", text });
      } catch (error) {
        cacheRef.current.set(artifact.id, { kind: "error", message: error instanceof Error ? error.message : String(error) });
      }
      setVersion((value) => value + 1);
    })();
  }, [artifact, runId, version]);

  return { content: artifact ? cacheRef.current.get(artifact.id) : undefined, retry };
}

type DiffRow = { kind: "same" | "added" | "removed"; text: string };
const DIFF_LINE_LIMIT = 5000;

const lineDiff = (left: string[], right: string[]): DiffRow[] => {
  const lengths = Array.from({ length: left.length + 1 }, () => new Uint32Array(right.length + 1));
  for (let row = left.length - 1; row >= 0; row -= 1) {
    for (let column = right.length - 1; column >= 0; column -= 1) {
      lengths[row][column] = left[row] === right[column]
        ? lengths[row + 1][column + 1] + 1
        : Math.max(lengths[row + 1][column], lengths[row][column + 1]);
    }
  }

  const rows: DiffRow[] = [];
  let row = 0;
  let column = 0;
  while (row < left.length && column < right.length) {
    if (left[row] === right[column]) {
      rows.push({ kind: "same", text: left[row] });
      row += 1;
      column += 1;
    } else if (lengths[row + 1][column] >= lengths[row][column + 1]) {
      rows.push({ kind: "removed", text: left[row] });
      row += 1;
    } else {
      rows.push({ kind: "added", text: right[column] });
      column += 1;
    }
  }
  while (row < left.length) rows.push({ kind: "removed", text: left[row++] });
  while (column < right.length) rows.push({ kind: "added", text: right[column++] });
  return rows;
};

function ArtifactDiff({ artifact, index }: { artifact: RunArtifact; index: RunIndex }) {
  const previous = artifact.previousVersionId ? index.artifactById.get(artifact.previousVersionId) : undefined;
  const before = useArtifactContent(index.view.id, previous).content;
  const after = useArtifactContent(index.view.id, artifact).content;
  const beforeText = before?.kind === "text" ? before.text : undefined;
  const afterText = after?.kind === "text" ? after.text : undefined;
  const rows = useMemo(() => {
    if (beforeText === undefined || afterText === undefined) return undefined;
    const left = beforeText.split("\n");
    const right = afterText.split("\n");
    if (left.length > DIFF_LINE_LIMIT || right.length > DIFF_LINE_LIMIT) return "too large" as const;
    return lineDiff(left, right);
  }, [beforeText, afterText]);

  if (!artifact.previousVersionId) return null;
  if (!previous) return <p className={mutedClass}>Previous version not in this projection.</p>;
  if (!before || !after || before.kind === "loading" || after.kind === "loading") return <p className={mutedClass}>Loading comparison ...</p>;
  if (rows === undefined) return <p className={mutedClass}>{artifact.mediaType} is not compared line by line.</p>;
  if (rows === "too large") return <p className={mutedClass}>Too large for the line comparison (more than {DIFF_LINE_LIMIT} lines).</p>;
  if (rows.every((entry) => entry.kind === "same")) return <p className={mutedClass}>Both versions have the same text.</p>;
  const marks = { same: " ", added: "+", removed: "-" };
  return <pre className="my-1.5 overflow-x-auto rounded-lg bg-foreground/4 p-2 text-[0.7rem] [&>span]:block [&>span]:whitespace-pre [&>span[data-diff=added]]:bg-success-soft [&>span[data-diff=removed]]:bg-destructive-soft">{rows.map((entry, position) => <span data-diff={entry.kind} key={position}>{marks[entry.kind]} {entry.text}{"\n"}</span>)}</pre>;
}

function ArtifactView({ artifact, index, ...props }: FlowInspectorProps & { artifact: RunArtifact; index: RunIndex }) {
  const view = index.view;
  const { content, retry } = useArtifactContent(view.id, artifact);
  const carriedOn = view.inputs.filter((input) => input.artifactIds.includes(artifact.id));
  return (
    <div className={inspectorClass}>
      <header className={headClass}>
        <BackButton canGoBack={props.canGoBack} onBack={props.onBack} />
        <div className="min-w-0 flex-1">
          <p className="mb-0.5 text-[0.66rem] font-semibold tracking-[0.08em] uppercase text-muted-foreground">Artifact</p>
          <h2>{artifact.title}</h2>
          <span className={subtitleClass}>by {actorLabel(index, artifact.createdBy)} - {formatBytes(artifact.size)} - {artifact.mediaType}</span>
        </div>
        <Button render={<a href={runArtifactContentUrl(view.id, artifact.id)} />} size="sm" variant="outline">Download</Button>
      </header>
      <div className={scrollClass}>
        <section className={sectionClass}>
          <h3>Content</h3>
          {(!content || content.kind === "loading") && <p className={mutedClass}>Loading artifact ...</p>}
          {content?.kind === "error" && <p className={errorClass}>{content.message} <button className={linkClass} onClick={retry} type="button">Reload</button></p>}
          {content?.kind === "download" && <p className={mutedClass}>No preview for {artifact.mediaType}.</p>}
          {content?.kind === "image" && <img alt={artifact.title} className="max-w-full rounded-lg" src={runArtifactContentUrl(view.id, artifact.id)} />}
          {content?.kind === "text" && <pre className={textBlockClass}>{content.text}</pre>}
        </section>
        {artifact.previousVersionId && <section className={sectionClass}><h3>Change from previous version</h3><ArtifactDiff artifact={artifact} index={index} /></section>}
        {carriedOn.length > 0 && (
          <section className={sectionClass}>
            <h3>Used in inputs</h3>
            <div className={rowsClass}>
              {carriedOn.map((input) => (
                <button className={rowClass} key={input.id} onClick={() => props.onNavigate({ type: "input", id: input.id })} type="button">
                  <span className={rowCopyClass}><strong>{input.content}</strong><small>{inputDeliveryLabel(index, input)} - {formatTime(input.enqueuedAt)}</small></span>
                </button>
              ))}
            </div>
          </section>
        )}
        <section className={sectionClass}>
          <h3>Details</h3>
          <dl className={propertiesClass}>
            <dt>Created by</dt><dd><EntityLink id={artifact.createdBy} index={index} onNavigate={props.onNavigate} /></dd>
            <dt>Hash</dt><dd>{shortId(artifact.hash)}</dd>
            <dt>Created</dt><dd>{formatTime(artifact.createdAt)}</dd>
            {artifact.previousVersionId && <><dt>Previous version</dt><dd><SelectionLink label={shortId(artifact.previousVersionId)} onNavigate={props.onNavigate} selection={{ type: "artifact", id: artifact.previousVersionId }} /></dd></>}
          </dl>
        </section>
      </div>
    </div>
  );
}
