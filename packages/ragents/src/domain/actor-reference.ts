/** What resolving a reference needs of an actor; the engine's actors and the web's run view both have it. A missing room is the main room. */
export type ReferencedActor = {
    readonly id: string;
    readonly handle: string;
    readonly room?: string | null;
};

/** The form in which handles are stored: without a leading @, NFC-composed and lower case. */
export const handleKey = (reference: string) => reference.trim().replace(/^@/, "").normalize("NFC").toLowerCase();

/** The grammar of an address after handleKey: room.handle, a bare handle, or a dotted handle of an older journal or of an owner. */
export const actorAddressPattern = /^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u;

/** Whether a reference has the form of an actor address; the leading @, case, and Unicode composition do not matter. */
export const isActorAddress = (reference: string): boolean => actorAddressPattern.test(handleKey(reference));

/** Room names are package names, so that room.name stays a valid package folder; the main room has none. */
export const roomNamePattern = /^[a-z][a-z0-9-]{0,63}$/;

/** The address that names the actor from anywhere: room.handle, the bare handle in the main room. */
export const addressOf = (actor: ReferencedActor): string => actor.room ? `${actor.room}.${actor.handle}` : actor.handle;

/** The address as an actor in `room` writes it: its own room's and the main room's actors without prefix, any other with its room. */
export const addressFrom = (actor: ReferencedActor, room: string | null): string =>
    !actor.room || actor.room === room ? actor.handle : addressOf(actor);

/** Whether two rooms share bare names: a room with itself, and the main room with every room, because its names are written without prefix from anywhere. */
export const sharesNames = (room: string | null, other: string | null): boolean => room === null || other === null || room === other;

/** The actor at this address as seen from `room`: an older journal's dotted handle exactly, room.name in that room, a bare name in `room`, then the main room. */
export const actorByHandle = <Found extends ReferencedActor>(actors: Iterable<Found>, handle: string, room: string | null = null): Found | undefined => {
    const listed = [...actors];
    const wanted = handleKey(handle);
    const inRoom = (name: string | null, bare: string) => listed.find((actor) => (actor.room ?? null) === name && actor.handle === bare);
    const dot = wanted.indexOf(".");

    if (dot >= 0)
        return inRoom(null, wanted) ?? (wanted.indexOf(".", dot + 1) < 0 ? inRoom(wanted.slice(0, dot), wanted.slice(dot + 1)) : undefined);

    return (room === null ? undefined : inRoom(room, wanted)) ?? inRoom(null, wanted);
};

/** The actor with this ID, otherwise the one at this address as seen from `room`. */
export const actorByReference = <Found extends ReferencedActor>(actors: Iterable<Found>, reference: string, room: string | null = null): Found | undefined => {
    const listed = [...actors];

    return listed.find((actor) => actor.id === reference) ?? actorByHandle(listed, reference, room);
};

/** Whether a room of this name can still be opened: not yet open and not the start of a dotted handle of an older journal. */
export const roomNameFree = (run: { readonly rooms: Iterable<{ readonly name: string }>; readonly actors: Iterable<ReferencedActor> }, name: string): boolean =>
    roomNamePattern.test(name)
    && ![...run.rooms].some((room) => room.name === name)
    && ![...run.actors].some((actor) => actor.handle.startsWith(`${name}.`));

/** The first free room name for this base: base, then base-2, base-3 and so on; `taken` rules out further names. */
export const freeRoomName = (
    run: { readonly rooms: Iterable<{ readonly name: string }>; readonly actors: Iterable<ReferencedActor> },
    base: string,
    taken: (name: string) => boolean = () => false,
): string => {
    if (!roomNamePattern.test(base))
        throw new Error(`${base} is no room name: a lowercase letter, then at most 63 lowercase letters, digits or hyphens.`);

    for (let counter = 1; ; counter += 1) {
        const suffix = counter === 1 ? "" : `-${counter}`;
        const candidate = `${base.slice(0, 64 - suffix.length)}${suffix}`;

        if (roomNameFree(run, candidate) && !taken(candidate))
            return candidate;
    }
};
