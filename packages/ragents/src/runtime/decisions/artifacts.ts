import type { Artifact } from "../../domain/model.ts";
import { event, type Decision } from "../command.ts";
import type { StoredArtifactContent } from "../artifacts.ts";
import { actorOf, artifactOf, assertArtifactRead, assertCapability, clean } from "../guards.ts";

export const publishArtifact =
    (
        input: { title: string; mediaType: string; previousVersionId: string | null },
        stored: StoredArtifactContent,
    ): Decision =>
    (state, context, services) => {
        const actor = actorOf(state, context);
        assertCapability(actor, "artifact.publish", { kind: "run" });

        if (input.previousVersionId)
            assertArtifactRead(state, actor, artifactOf(state, input.previousVersionId));

        const artifact: Omit<Artifact, "createdBy" | "createdAt"> = {
            id: services.newId("artifact"),
            title: clean(input.title, "title"),
            mediaType: clean(input.mediaType, "mediaType"),
            hash: stored.hash,
            size: stored.size,
            previousVersionId: input.previousVersionId,
        };

        return [event(context, { type: "artifact.published", payload: { artifact } })];
    };
