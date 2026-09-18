import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { context } from "@ragents/client";
import * as UI from "@ragents/client/ui";
import type { ChatSnapshot, FormValues } from "@ragents/client/ui";
import { advisor, answerCount, answerInput, createSender, deriveConversation, retryMarker, startMarker } from "./conversation.js";

function App() {
  const [snapshot, setSnapshot] = useState<ChatSnapshot>();
  const [values, setValues] = useState<FormValues>({ answer: "" });
  const [sendError, setSendError] = useState<string>();
  const [sending, setSending] = useState(false);
  const sender = useRef(createSender((text) => context.chat.send(advisor, text))).current;
  const conversation = deriveConversation(snapshot);

  useEffect(() => {
    const refresh = () => {
      const next = context.chat.read(advisor);
      sender.observe(next);
      setSnapshot(next);
    };
    const unsubscribe = context.chat.subscribe(advisor, refresh);
    refresh();
    return unsubscribe;
  }, [sender]);

  const send = async (text: string) => {
    if (sender.pending) return;
    setSendError(undefined);
    setSending(true);
    try {
      if (await sender.send(snapshot, text)) setValues({ answer: "" });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally { setSending(false); }
  };

  if (conversation.phase === "loading") return null;
  const pending = sending || sender.pending;
  const waiting = !conversation.error && (pending || conversation.phase === "waiting" || conversation.phase === "evaluating");
  const evaluating = conversation.answers === answerCount || sender.finalAnswer;
  const disabled = Boolean(snapshot?.readOnly || snapshot?.running || pending);

  return <UI.AppLayout title="Dein Balkon" description="Fünf Fragen zu deinem Balkon. Daraus entsteht eine persönliche Gestaltungsempfehlung.">
    <UI.Stack gap="large">
      <UI.Stack gap="small">
        <label htmlFor="interview-progress">{conversation.answers} von {answerCount} Antworten</label>
        <progress className="h-2.5 w-full [accent-color:var(--foreground)]" id="interview-progress" max={answerCount} value={conversation.answers} />
      </UI.Stack>
      {snapshot?.readOnly && <p>Dieser Lauf ist schreibgeschützt.</p>}
      {(sendError || conversation.error) && <p role="alert">{sendError || conversation.error}</p>}
      {conversation.phase === "start" && !pending && <UI.Stack>
        <p>Du beantwortest immer nur eine Frage. Deine bisherigen Angaben bleiben beim erneuten Öffnen erhalten.</p>
        <UI.Stack direction="row"><UI.Button disabled={disabled} onClick={() => void send(startMarker)}>Beratung starten</UI.Button></UI.Stack>
      </UI.Stack>}
      {waiting && <p role="status">{evaluating ? "Deine Antworten werden ausgewertet. Die Empfehlung entsteht ..." : "Deine nächste Frage entsteht ..."}</p>}
      {conversation.canRetry && <UI.Stack>
        <p>Die nächste Modellantwort konnte nicht angezeigt werden. Deine bereits gesendeten Antworten bleiben erhalten.</p>
        <UI.Stack direction="row"><UI.Button disabled={disabled} onClick={() => void send(retryMarker)} variant="outline">Modellantwort erneut anfordern</UI.Button></UI.Stack>
      </UI.Stack>}
      {conversation.phase === "question" && !pending && <UI.Stack>
        <h2>Frage {conversation.answers + 1} von {answerCount}</h2>
        <UI.Markdown text={conversation.text} />
        <UI.Form title="Deine Antwort" fields={[
          { id: "answer", label: "Antwort", type: "textarea", rows: 4, required: true, placeholder: "Beschreibe deinen Balkon und deine Wünsche ..." },
        ]} values={values} onChange={setValues} disabled={disabled} onSubmit={async (next) => {
          await send(answerInput(conversation.answers, String(next.answer ?? "")));
        }} submitLabel={conversation.answers === 4 ? "Antwort senden und auswerten" : "Antwort senden"} />
      </UI.Stack>}
      {conversation.phase === "complete" && !pending && <UI.Stack>
        <h2>Deine Gestaltungsempfehlung</h2>
        <UI.Markdown text={conversation.text} />
      </UI.Stack>}
    </UI.Stack>
  </UI.AppLayout>;
}

const root = document.getElementById("root");
if (!root) throw new Error("Das Wurzelelement #root fehlt.");
createRoot(root).render(<App />);
