import { errorFrom } from "@aicontainer/web/lib/http";

export const answerQuestion = async (
  routePrefix: string,
  runId: string,
  actionId: string,
  answer: string,
): Promise<void> => {
  const response = await fetch(
    `${routePrefix}/runs/${encodeURIComponent(runId)}/questions/${encodeURIComponent(actionId)}/answer`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answer }),
    },
  );
  if (!response.ok) throw await errorFrom(response, "Die Antwort konnte nicht übermittelt werden");
};
