const text = (value) => ({ content: [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value) }] });

export const mcpScenario = (record) => {
  const added = new Set();
  const definitions = () => [
    { name: "echo", title: "Echo", description: "Return the supplied text", inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] }, annotations: { readOnlyHint: true } },
    ...["failure", "expand", "wait", "progress", "environment", "roots"].map((name) => ({ name, description: `Fixture ${name}`, inputSchema: { type: "object", properties: {} } })),
    ...[...added].map((name) => ({ name, description: "Added after notification", inputSchema: { type: "object", properties: {} } })),
  ];
  const call = async (name, input, context) => {
    record({ type: "tool.called", tool: name });
    if (name === "echo") return text(input.text);
    if (name === "failure") return { ...text("Intentional MCP tool failure"), isError: true };
    if (name === "environment") return text({ pid: process.pid, cwd: process.cwd(), value: process.env.MCP_TEST_VALUE, machine: process.env.MCP_TEST_MACHINE, marker: process.env.RAGENTS_RUN_ID });
    if (name === "roots") return context.roots();
    if (name === "expand") {
      added.add("later");
      await context.changed();
      return text("Tool added");
    }
    if (name === "later") return text("New tool reached");
    if (name === "wait") {
      record({ type: "wait.started" });
      return new Promise((resolve) => {
        const cancelled = () => {
          record({ type: "wait.cancelled" });
          resolve(text("Cancelled"));
        };
        if (context.signal.aborted) cancelled();
        else context.signal.addEventListener("abort", cancelled, { once: true });
      });
    }
    if (name === "progress") {
      for (let step = 1; step <= 8; step += 1) {
        await new Promise((resolve) => setTimeout(resolve, 30));
        context.signal.throwIfAborted();
        await context.progress(step, 8);
      }
      return text("Progress completed");
    }
    throw new Error(`Unknown fixture tool ${name}`);
  };
  return { definitions, call };
};

export const fixtureInstructions = "Use the fixture tools for protocol checks.";
