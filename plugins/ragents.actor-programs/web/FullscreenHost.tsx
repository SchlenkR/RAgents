import { useRef } from "react";
import { XIcon } from "lucide-react";
import type { SessionContext } from "@aicontainer/web/PluginRegistry";
import { Button, Dialog, DialogContent, DialogTitle } from "@aicontainer/web/ui";
import { HostConfirmation, pendingConfirmationFor, actorProgramApps, useActorPrograms } from "./AppsPanel";
import { ActorViewFrame } from "./ActorViewFrame";

export function FullscreenHost({ session }: { session: SessionContext }) {
  const { api, closeFullscreen, error, fullscreenAppId, invoke, listing, runId } = useActorPrograms();
  const closeRef = useRef<HTMLButtonElement>(null);
  if (!fullscreenAppId) return null;
  const entry = actorProgramApps(session).find((candidate) => candidate.id === fullscreenAppId && candidate.app.visible !== false);
  if (!entry) return null;
  const app = listing?.apps.find((candidate) => candidate.id === fullscreenAppId);
  const title = entry.title;
  const confirmation = app ? pendingConfirmationFor(session, app) : undefined;
  return <Dialog key={`${runId}:${fullscreenAppId}`} open onOpenChange={(open) => { if (!open) closeFullscreen(); }}>
    <DialogContent className="h-[calc(100%-2*clamp(16px,2vw,24px))] w-[calc(100%-2*clamp(16px,2vw,24px))] gap-0 bg-background p-0" initialFocus={closeRef} scope="canvas" showCloseButton={false} size="full">
    <header className="flex flex-none items-center gap-3 border-b border-border bg-card py-2 pr-3 pl-4">
      <DialogTitle className="min-w-0 flex-1 truncate text-[0.9rem]" render={<h2 />}>{title}</DialogTitle>
      <Button aria-label={`${title} Vollansicht schließen`} className="rounded-full" onClick={closeFullscreen} ref={closeRef} size="icon" title={`${title} Vollansicht schließen`} variant="outline"><XIcon /></Button>
    </header>
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden [&>[data-slot=host-confirmation]]:max-h-[65%] [&>[data-slot=host-confirmation]]:flex-[0_1_auto] [&>[data-slot=host-confirmation]]:overflow-auto">
      {confirmation && <HostConfirmation action={confirmation} key={confirmation.id} session={session} />}
      {app ? <ActorViewFrame api={api} app={app} invoke={invoke} pendingConfirmationInvocationId={confirmation?.parameters.invocationId}
        presentation="fullscreen" runId={runId} session={session} />
        : <p className="flex flex-1 items-center justify-center gap-2 text-[0.7rem] text-muted-foreground" role={error ? "alert" : "status"}>{error ?? "Actor-Ansicht wird geladen"}</p>}
    </div>
    </DialogContent>
  </Dialog>;
}
