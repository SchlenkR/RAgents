# Self-test catalog

Test cases for the autonomous self-improvement loop. Each case has an idea, two
prompts in the same direction (A = detailed but non-technical, as a user
writes; B = very simple), an expectation, and the reasoning why the idea is good.
On the side, the two variants test the hypothesis: small, specific prompts
work better than large ones.

Frame: profile core, coordinator model from the profile configuration, isolated workspace per
conversation with access to the documents placed in it. A test agent runs both prompts as
SEPARATE conversations.

## T01 Two-agent interview

Idea: The coordinator should create two agents that work with each other (interviewer and
expert) and summarize the result.

Prompt A: "I would like to read a short interview. Please set up two conversation partners:
a curious interviewer and an expert on time series in building services. The
interviewer asks three questions one after the other, the expert answers each briefly. At the end
you summarize the conversation for me in five sentences."

Prompt B: "Have two agents conduct a short interview about time series and summarize
it."

Expectation: Two agents are created (agent_spawn), inputs go via actor_input, there
are at least three question-answer pairs, at the end a summary in the chat. No
endless ping-pong, completion in under 8 minutes.

Why good: The core of the product (multi-agent orchestration) in the smallest meaningful
cut; tests spawn, input routing, turn switching, and completion discipline.

## T02 Star with mediator light

Idea: Two plain LLMs without runtime knowledge, a mediator actor passes text along.

Prompt A: "Please build the following experiment: Anna and Ben are two simple conversation partners
who know nothing about their environment. A mail carrier forwards Anna's first message to Ben
and brings me Ben's answer. Anna should ask Ben about his favorite book. Show
me Ben's answer at the end."

Prompt B: "Anna asks Ben about his favorite book via a mail carrier. Show me the
answer."

Expectation: Anna and Ben are created with an empty tool list, the mediator subscribes to
model outputs (event_subscribe) and routes via actor_input; Ben's answer appears in the
chat. No tools for Anna/Ben.

Why good: Tests the subscription model and plain LLM isolation, the reference case of the
platform, with an everyday prompt instead of jargon.

## T03 To-do tracking for multi-step work

Idea: For a multi-part task, the coordinator should keep and work through the run's to-do
list.

Prompt A: "I need three things one after the other: first, a list of five typical
data quality problems with measured values, second, a short check proposal for each problem,
third, a recommendation of where to start. Please create a task list
for this and work through it visibly."

Prompt B: "Do in order: name 5 data quality problems, one check tip each,
a starting recommendation. Keep a task list while doing so."

Expectation: todo_replace is used, the list has 3 entries, check marks move during
the work (several plugin.state-replaced for ragents.todo), all three contents arrive.

Why good: Tests whether the model really uses tools for self-organization instead of
just answering; directly relevant for the planned feature workflow.

## T04 Question instead of guessing

Idea: For an ambiguous task, the coordinator should ask a real question
(question card), not simply start guessing.

Prompt A: "Please prepare the evaluation for the building, like last time, but
this time with the new numbers. You know which ones I mean."

Prompt B: "Do the evaluation like last time, just with the new numbers."

Expectation: ask_user is called (action.proposed in the journal), the coordinator ends its turn
and waits for the answer instead of inventing content. No made-up numbers or buildings.

Why good: No silent fallbacks as a rule of behavior; tests whether the question tool is
pulled at the right moment - one of the most expensive error classes in everyday use.

## T05 Document in the file storage

Idea: A work result should end up as a document in the run's file storage and be shown in the
chat.

Prompt A: "Write me a one-page, understandable explanation of what a ring buffer is
and what it is used for. Store it as a document so that I can find it again later,
and show it to me."

Prompt B: "Explain ring buffers on one page and store it as a document."

Expectation: A file is created in the run file storage (documents tab), show_document or
the artifact display is used, the content is sound.

Why good: Tests the documents path end to end (file storage, display) with a
realistic knowledge work task.

## T06 Actor function with React view

Idea: Create TypeScript functions, state, and a React view as one actor program.

Prompt A: "Build a small text analyst with an input field. It should count words and lines itself
and keep the last text. It does not need an AI answer for this. Check two lines
with six words in total and then let me enter a text myself."

Prompt B: "Build a text analyst with an operable UI using the text-analysis template."

Expectation: actor_program_create, normal file tools, and TypeScript diagnostics lead to
a package activated with actor_program_activate. The domain tests check counting and state;
the browser shows the result of real operation. The same actor owns function and view.
No separate build references or test arguments as JSON in the model context.

Why good: Tests normal TypeScript files, diagnostics, domain tests, actor state, and the
visible operation without an additional model turn per function call.

## T07 Function of an LLM actor as a tool

Idea: Build a small TypeScript tool, give it to a created agent, and the agent
really uses it.

Prompt A: "Create an assistant named Calculator. Give it a self-built tool
that takes a list of numbers and returns the sum and mean. Have the
Calculator evaluate the numbers 4, 8, 15, 16, 23, 42 with it and report the result to me."

Prompt B: "Build a sum tool, give it to a new agent, and have it evaluate 4 8 15 16 23
42."

Expectation: actor_program_activate binds the package to @calculator. The LLM actor calls its
own TypeScript function as a tool (tool.call.started with the new name) and reports sum 108,
mean 18.

Why good: Tests functions of a real LLM actor and their publication as a tool - including the question whether the target agent finds the tool at all.

## T08 TypeScript actor with memory

Idea: A deterministic TypeScript actor that keeps state across several inputs.

Prompt A: "I would like a counter that does not make anything up: every time you
send it something, it increases its count by one and answers with the new count.
Then send it something three times and tell me the final count."

Prompt B: "Build a counter actor and send it three messages. Final count?"

Expectation: actor_program_activate activates a package with onInput. The TypeScript actor processes three
inputs as three turns, the state rises to 3, the coordinator reports 3.

Why good: Tests TypeScript actors including the state contract (context.state.replace) and the
FIFO processing of several inputs.

## T09 Stopping and cleaning up

Idea: Stop created agents cleanly; afterwards the run is still usable.

Prompt A: "Briefly set up two helpers, have each say one sentence, and then end both
completely again. Confirm to me that only you are left, and then also answer
the question: How many helpers are still running now?"

Prompt B: "Create two agents, have each say one sentence, stop both, and tell me
how many are still running."

Expectation: actor_stop for both helpers (actor.stopped in the journal), the answer is
zero/none, the coordinator then continues answering normally.

Why good: Lifecycle discipline; hanging agents are a real resource and
confusion problem.

## T10 Use the knowledge base instead of hallucinating

Idea: A domain question whose answer is in the documents in the working directory -
the coordinator should look it up instead of guessing.

Prompt A: "Please look in the documents in your working directory: What is recorded there
about the basic rule for aggregating time series? Quote the passage
in substance and name the file in which you found it."

Prompt B: "What do your documents say about aggregating time series? With the source."

Expectation: Read tools are used (read/grep in the workspace), the answer names a
really existing file and renders its content in substance; no invented facts
or file names.

Why good: Grounding test for the static workspace; separates looking things up from
hallucination.

## T11 Output discipline for a short task

Idea: Does the coordinator model keep the output contract (no meta talk, clear final answer)
even when the task is trivial?

Prompt A: "Please give me exactly three advantages of buffer tanks in heating systems as a
numbered list. No introduction, no conclusion, only the list."

Prompt B: "3 advantages of buffer tanks, only as a list."

Expectation: The answer is exactly one numbered list with three items; no
tool calls, no preamble or epilogue, no thinking in plain text.

Why good: Measures format fidelity and overhead of the model for small tasks - important because
DeepSeek Flash is supposed to be the everyday engine.

## T12 Three messages in quick succession

Idea: Inputs that arrive during a running turn are processed in order as
their own turns - nothing gets lost, nothing gets mixed up.

Prompt A (as THREE messages sent quickly one after another in the same conversation):
1. "Remember the number 7."
2. "Also remember the color blue."
3. "What did I just tell you?"

Prompt B (two messages quickly one after another):
1. "Count slowly from 1 to 5, giving a reason for each."
2. "Stop, just tell me your favorite number instead."

Expectation: All messages are processed, in order, as separate turns
(FIFO, no steering); the last answer for A names 7 and blue; for B the
running turn is first finished or cleanly interrupted, then the second message is answered;
no input gets lost.

Why good: Tests the central queue semantics (one input = one turn, no
delivery into running turns) under realistic user behavior.

## T13 Hello world on the surface

Idea: A tiny wish for an app in the workshop ends up as a small static
actor view as a tab in the shared panel with a short create-activate flow.

Prompt A: "I would like a small app on the surface that only shows the text
Hello world. Please build it so that I see it directly on the surface."

Prompt B: "I would like a small app on the surface that simply says
Hello world. It should do nothing else."

Expectation: actor_program_create with the template blank and actor_program_activate;
afterwards the app is available as a tab beside Chat and actor_program_list confirms the installation.
The view belongs to the calling actor and creates no additional actor.
The package contains no functions, input handlers, or tools of its own and therefore needs no
invented backend test. No copying of hashes, no subagent just for testing.
The browser retains visited app input when switching tabs; VS Code opens the app in one editor.
Completion in under 5 minutes.

Why good: Tests the smallest actor view path end to end. Static content should
not produce additional server actions or artificial tests. Operation belongs
to the host and is not rebuilt in the app code.

## T14 Switch between chat and mini-apps

Idea: Use two mini-apps while a conversation continues in the same run.

Prompt A: "Create a notes app and a counter, then discuss a short task with me."

Prompt B: "Give me two small apps in this run and keep the coordinator available in chat."

Expectation: Both apps appear without changing the selected chat. In the browser, Chat and each
app are tabs with exactly one visible view. Unsent chat and app input survive switching. Hiding
the selected app returns to Chat; showing it again does not select it. In VS Code repeated clicks
focus the same editor, including after moving it to another editor group. Closing and reopening
creates one editor; the same app on another server stays independent. Both browser entry routes
show the same run panel. Questions remain in chat.

Why good: Exercises catalog lifecycle, stable frame identity, draft retention, and host navigation.
