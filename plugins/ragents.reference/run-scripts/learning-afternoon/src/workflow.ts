import { defineWorkflow } from "@ragents/workflow";

export const learningWorkflow = defineWorkflow({
  id: "learning-afternoon",
  title: "Lernnachmittag",
  roles: {
    helper: { title: "Ideenhelfer", prompt: "prompts/helper.md" },
    collection: { title: "Automatische Sammlung" },
  },
  steps: [
    {
      id: "experiment", title: "Ein einfaches Experiment", role: "helper",
      goal: "Entwickle genau eine Experimentidee für einen gemeinsamen Lernnachmittag mit Grundschulkindern.",
      prompt: "prompts/experiment.md",
      completion: { source: "agent", description: "Der Helfer hat eine konkrete Idee als Text geliefert." },
      freedom: { mode: "fixed", description: "Material und Experiment frei wählen; genau eine Idee liefern." },
    },
    {
      id: "quiz", title: "Ein kleines Lernquiz", role: "helper",
      goal: "Entwickle genau eine Quizidee für einen gemeinsamen Lernnachmittag mit Grundschulkindern.",
      prompt: "prompts/quiz.md",
      completion: { source: "agent", description: "Der Helfer hat eine konkrete Idee als Text geliefert." },
      freedom: { mode: "fixed", description: "Thema und Spielweise frei wählen; genau eine Idee liefern." },
    },
    {
      id: "collect", title: "Ideen gemeinsam sammeln", role: "collection",
      goal: "Die Antworten beider unabhängig arbeitenden Helfer in der gemeinsamen Ergebnisliste anzeigen.",
      completion: { source: "service", description: "Beide Helfer sind beendet; erfolgreiche Ideen und Fehler bleiben sichtbar." },
      freedom: { mode: "fixed", description: "Antworten unverändert übernehmen; keine weitere Modellantwort erzeugen." },
    },
  ],
  transitions: [
    { from: "experiment", to: "collect" },
    { from: "quiz", to: "collect" },
  ],
});

export const helperSteps = learningWorkflow.steps.filter((step) => step.role === "helper");
