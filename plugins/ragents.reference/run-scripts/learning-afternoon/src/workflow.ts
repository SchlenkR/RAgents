import { defineWorkflow } from "@ragents/workflow";

export const learningWorkflow = defineWorkflow({
  id: "learning-afternoon",
  title: "Learning afternoon",
  roles: {
    helper: { title: "Idea helper", prompt: "prompts/helper.md" },
    collection: { title: "Automatic collection" },
  },
  steps: [
    {
      id: "experiment", title: "A simple experiment", role: "helper",
      goal: "Create exactly one experiment idea for an afternoon with primary-school children.",
      prompt: "prompts/experiment.md",
      completion: { source: "agent", description: "The helper provided one concrete idea as text." },
      freedom: { mode: "fixed", description: "Choose the material and experiment freely; provide exactly one idea." },
    },
    {
      id: "quiz", title: "A short learning quiz", role: "helper",
      goal: "Create exactly one quiz idea for an afternoon with primary-school children.",
      prompt: "prompts/quiz.md",
      completion: { source: "agent", description: "The helper provided one concrete idea as text." },
      freedom: { mode: "fixed", description: "Choose the topic and format freely; provide exactly one idea." },
    },
    {
      id: "collect", title: "Collect ideas", role: "collection",
      goal: "Show the responses from both independent helpers in one shared result list.",
      completion: { source: "service", description: "Both helpers have finished; successful ideas and errors remain visible." },
      freedom: { mode: "fixed", description: "Keep responses unchanged and do not generate another model response." },
    },
  ],
  transitions: [
    { from: "experiment", to: "collect" },
    { from: "quiz", to: "collect" },
  ],
});

export const helperSteps = learningWorkflow.steps.filter((step) => step.role === "helper");
