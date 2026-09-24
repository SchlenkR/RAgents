import { DomainError, type AccessContext } from "@ragents/engine";
import { assertRights } from "../rpc/dispatcher.js";
import type { RunRightsKind } from "@ragents/engine/src/http/methods";
import type { RunListScope } from "../chat-handler.js";

export interface GlobalRunPolicy {
  runId: string;
  read: string;
  write: string;
}

/** Das Recht, die Runs aller Benutzer zu sehen; ohne es bleibt ein Zugang bei seinen eigenen. */
export const RUNS_READ_ALL = "runs.read.all";

export interface RunAccessPolicy {
  global: GlobalRunPolicy | undefined;
  /** Der Benutzer des Runs: null für einen Run ohne Eigentümer, undefined für einen Run, den es noch nicht gibt. */
  ownerOf: (runId: string) => string | null | undefined;
  /** Ob nur der Eigentümer den Run bedient, weil ein Plugin ihn so erklärt hat. */
  ownerOnly: (runId: string) => boolean;
}

/** Rechte je Run: gewöhnliche Runs über runs.*, der globale Chat über die Rechte seines Plugins. */
export const runRights = (runId: string, kind: RunRightsKind, global: GlobalRunPolicy | undefined): readonly string[] => {
  if (global && runId === global.runId) {
    const technical = kind === "inspect" || kind === "write-inspect" ? ["runs.inspect"] : [];
    return kind === "read" || kind === "inspect" ? [global.read, ...technical] : [global.read, global.write, ...technical];
  }
  switch (kind) {
    case "read": return ["runs.read"];
    case "inspect": return ["runs.read", "runs.inspect"];
    case "write": return ["runs.read", "runs.write"];
    case "stop": return ["runs.read", "runs.write"];
    case "write-inspect": return ["runs.read", "runs.write", "runs.inspect"];
  }
};

/** Ein Run gehört dem Zugang: ohne Anmeldung gibt es nur einen, der globale Chat ist gemeinsam, runs.read.all sieht alle. */
export const runOwned = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  !access.enabled
  || (policy.global !== undefined && runId === policy.global.runId)
  || access.can(RUNS_READ_ALL)
  || policy.ownerOf(runId) === access.user?.id;

/** Erreichbar ist zusätzlich eine Kennung ohne Run: sie gehört erst dem, der den Run unter ihr anlegt. */
export const runReachable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runOwned(access, runId, policy) || policy.ownerOf(runId) === undefined;

/** Bedienen heißt schreiben, starten und antworten; einen Run, den nur sein Eigentümer bedient, bedient auch runs.read.all nicht. */
export const runOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  !access.enabled || !policy.ownerOnly(runId) || policy.ownerOf(runId) === access.user?.id;

/** Der Arbeitsbereich eines Runs, den nur sein Eigentümer bedient, liegt bei ihm; auch lesend erreicht ihn nur er, das Journal lesen weiter alle, die den Run sehen. */
export const runWorkspaceAccessible = (access: AccessContext, runId: string, policy: RunAccessPolicy): boolean =>
  runOperable(access, runId, policy);

/** Die Run-Liste eines Zugangs: sichtbar, was ihm gehört, erreichbar nur der Arbeitsbereich, den er auch lesen darf. */
export const runListScope = (access: AccessContext, policy: RunAccessPolicy): RunListScope => ({
  visible: (runId) => runOwned(access, runId, policy),
  workspaceAccessible: (runId) => runWorkspaceAccessible(access, runId, policy),
});

export const assertRunWorkspaceAccess = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runWorkspaceAccessible(access, runId, policy)) {
    throw new DomainError(
      "run-workspace-owner-only",
      `Den Arbeitsbereich des Runs ${runId} sieht nur sein Eigentümer; Journal lesen und den Run stoppen darfst du.`,
      403,
    );
  }
};

/** Auslieferungsadressen nennen ihren Run als eigenen Pfadabschnitt: /files/runs/<id>/..., /api/plugins/<plugin>/runs/<id>/... */
export const runIdInPath = (pathname: string): string | undefined =>
  /(?:^|\/)runs\/([A-Za-z0-9_-]{1,64})(?:\/|$)/.exec(pathname)?.[1];

/** Ein fremder Run verhält sich wie ein nicht vorhandener: gleicher Code, gleiche Meldung, gleicher Status. */
export const assertRunReachable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runReachable(access, runId, policy)) throw new DomainError("run-not-found", `Run ${runId} does not exist.`, 404);
};

/** Wer den Run sehen darf, erfährt auch, warum er ihn nicht bedienen darf. */
export const assertRunOperable = (access: AccessContext, runId: string, policy: RunAccessPolicy): void => {
  if (!runOperable(access, runId, policy)) {
    throw new DomainError("run-owner-only", `Den Run ${runId} bedient nur sein Eigentümer; lesen und stoppen darfst du ihn.`, 403);
  }
};

/** Die Prüfung der Nachrichtenschicht: jeder Beitrag mit runId muss den Run erreichen, einer mit runs.write ihn auch bedienen. */
export const assertRunAccess = (access: AccessContext, runId: string, operates: boolean, policy: RunAccessPolicy): void => {
  assertRunReachable(access, runId, policy);
  if (operates) assertRunOperable(access, runId, policy);
};

export const assertRunRights = (access: AccessContext, runId: string, kind: RunRightsKind, policy: RunAccessPolicy): void => {
  assertRights(access, runRights(runId, kind, policy.global));
  assertRunReachable(access, runId, policy);
  if (kind === "write" || kind === "write-inspect") assertRunOperable(access, runId, policy);
};
