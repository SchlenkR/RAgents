# Rooms in the interface

Status: In progress

## Starting point

Rooms are implemented in engine, journal, tools, prompts, and run script starts: a room is a
delimited part of a run with its own actors, every run script start opens one, an actor's
address is `room.name` without prefix in the main room, and names are relative to the caller's
room. The current contract is in `docs/spec/core.md` (Rooms) and `docs/spec/typescript-platform.md`
(run scripts). The interface so far only shows an actor's address where it showed its handle;
it neither shows rooms as such nor lets a person work with them.

## Stage 3: the interface

- The run header names the rooms beside the main room, in the window group as one entry per
  room. Choosing a room focuses its apps and its actors; the run view already carries `rooms`
  with name, origin, opener, and time.
- The agent graph groups its cards by room: the main room as today, each further room as a
  frame of its own below its origin room, so a person sees which start produced which actors.
  The addressee tree already keeps siblings of different rooms apart.
- "Empty space" keeps working per room: an empty pane holds a place in the layout of the room
  that is in front.
- Chat mentions take `@room.name` for an actor of another room and `@name` within the current
  room, with the same resolution as the tools; completion lists addresses from the room in front.

## Open questions

- Whether the main room's apps stay visible while another room is in front, or the header
  switches the whole layout per room.
- Whether a person may open a room deliberately, for example to give a new agent a fresh
  context; the engine has no such function yet, only run script starts open rooms.
- Whether the homepage gets a section on rooms before or with this stage.
