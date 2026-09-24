/** What resolving a reference needs of an actor; the engine's actors and the web's run view both have it. */
export type ReferencedActor = {
    readonly id: string;
    readonly handle: string;
};

/** The form in which handles are stored: without a leading @, NFC-composed and lower case. */
export const handleKey = (reference: string) => reference.trim().replace(/^@/, "").normalize("NFC").toLowerCase();

/** The actor with this handle; the journal gives a handle to exactly one actor of a run, stopped or not. */
export const actorByHandle = <Found extends ReferencedActor>(actors: Iterable<Found>, handle: string): Found | undefined => {
    const wanted = handleKey(handle);

    return [...actors].find((actor) => actor.handle === wanted);
};

/** The actor with this ID, otherwise the one with this handle (with or without @). */
export const actorByReference = <Found extends ReferencedActor>(actors: Iterable<Found>, reference: string): Found | undefined => {
    const listed = [...actors];

    return listed.find((actor) => actor.id === reference) ?? actorByHandle(listed, reference);
};
