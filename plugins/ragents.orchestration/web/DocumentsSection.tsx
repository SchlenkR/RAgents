import { runActorFrom, runViewFrom, type RunArtifact } from "./contract";
import { formatBytes } from "@aicontainer/web/lib/format";
import type { CardSectionContext, SessionNavigation } from "@aicontainer/web/PluginRegistry";
import { SectionLabel } from "@aicontainer/web/ui";

const openDocument = (navigation: SessionNavigation, artifact: RunArtifact) => {
  if (navigation.revealEntity({ type: "artifact", id: artifact.id })) return;
  throw new Error(`Kein Plugin kann das Dokument ${artifact.title} anzeigen`);
};

export function DocumentsSection({ actor, navigation, session }: CardSectionContext) {
  const view = runViewFrom(session.runView);
  if (!view) return null;
  const actorId = runActorFrom(actor).id;
  const documents = view.artifacts.filter((artifact) => artifact.createdBy === actorId);
  if (documents.length === 0) return null;

  return (
    <section className="grid gap-1.5">
      <SectionLabel>
        <span>Dokumente</span>
        <small>{documents.length}</small>
      </SectionLabel>
      <ul className="grid list-none gap-1">
        {documents.map((artifact) => (
          <li key={artifact.id}>
            <button className="grid w-full cursor-pointer rounded-lg border border-border-soft px-2 py-1.5 text-left hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-primary/6"
              onClick={() => openDocument(navigation, artifact)} type="button">
              <strong className="truncate text-[0.74rem]" title={artifact.title}>{artifact.title}</strong>
              <small className="text-[0.64rem] text-muted-foreground">{formatBytes(artifact.size)} - {artifact.mediaType}</small>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
