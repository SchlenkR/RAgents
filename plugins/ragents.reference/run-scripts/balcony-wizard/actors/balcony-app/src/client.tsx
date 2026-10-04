import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { context } from "@ragents/client";
import * as UI from "@ragents/client/ui";
import type { ChatSnapshot, FormValues } from "@ragents/client/ui";
import { answerCount, answerInput, createSender, deriveConversation, retryMarker, startMarker } from "./conversation.js";

function App() {
  const advisor = `@${context.actor.handle}`;
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
  }, [advisor, sender]);

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

  return <UI.AppLayout title="Your balcony" description="Five questions about your balcony. They lead to a personal design recommendation.">
    <UI.Stack gap="large">
      <UI.Stack gap="small">
        <label htmlFor="interview-progress">{conversation.answers} of {answerCount} answers</label>
        <progress className="h-2.5 w-full [accent-color:var(--foreground)]" id="interview-progress" max={answerCount} value={conversation.answers} />
      </UI.Stack>
      {snapshot?.readOnly && <p>This run is read-only.</p>}
      {(sendError || conversation.error) && <p role="alert">{sendError || conversation.error}</p>}
      {conversation.phase === "start" && !pending && <UI.Stack>
        <p>You always answer only one question. Your previous answers are kept when you open this again.</p>
        <UI.Stack direction="row"><UI.Button disabled={disabled} onClick={() => void send(startMarker)}>Start consultation</UI.Button></UI.Stack>
      </UI.Stack>}
      {waiting && <p role="status">{evaluating ? "Your answers are being evaluated. The recommendation is being created ..." : "Your next question is being created ..."}</p>}
      {conversation.canRetry && <UI.Stack>
        <p>The next model answer could not be shown. The answers you already sent are kept.</p>
        <UI.Stack direction="row"><UI.Button disabled={disabled} onClick={() => void send(retryMarker)} variant="outline">Request model answer again</UI.Button></UI.Stack>
      </UI.Stack>}
      {conversation.phase === "question" && !pending && <UI.Stack>
        <h2>Question {conversation.answers + 1} of {answerCount}</h2>
        <UI.Markdown text={conversation.text} />
        <UI.Form title="Your answer" fields={[
          { id: "answer", label: "Answer", type: "textarea", rows: 4, required: true, placeholder: "Describe your balcony and your wishes ..." },
        ]} values={values} onChange={setValues} disabled={disabled} onSubmit={async (next) => {
          await send(answerInput(conversation.answers, String(next.answer ?? "")));
        }} submitLabel={conversation.answers === 4 ? "Send answer and evaluate" : "Send answer"} />
      </UI.Stack>}
      {conversation.phase === "complete" && !pending && <UI.Stack>
        <h2>Your design recommendation</h2>
        <UI.Markdown text={conversation.text} />
      </UI.Stack>}
    </UI.Stack>
  </UI.AppLayout>;
}

const root = document.getElementById("root");
if (!root) throw new Error("The #root element is missing.");
createRoot(root).render(<App />);
