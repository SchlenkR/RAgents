import { useState } from "react";
import type { EntryGuideContext } from "@aicontainer/web/PluginRegistry";
import { Button, Card, Input, Textarea } from "@aicontainer/web/ui";

const formClass = "grid gap-5.5 mx-auto max-w-[820px] p-6 text-foreground max-sm:p-4.5";
const introClass = "leading-[1.6] text-muted-foreground";
const fieldClass = "grid min-w-0 gap-2.5 [&>span]:font-semibold";
const hintClass = "leading-[1.5] text-muted-foreground";
const actionsClass = "flex flex-wrap justify-end gap-2.5 pt-2";

export function ConversationGuide({ onCancel, onComplete }: EntryGuideContext) {
  const [topic, setTopic] = useState("Sollten Innenstädte autofrei werden?");
  const [rounds, setRounds] = useState("2");
  const count = Number(rounds);
  const valid = topic.trim().length > 0 && Number.isInteger(count) && count >= 1 && count <= 5;

  return (
    <form className={formClass} onSubmit={(event) => {
      event.preventDefault();
      if (valid) onComplete({ topic: topic.trim(), rounds: count });
    }}>
      <p className={introClass}>Drei Perspektiven auf eine Frage. Der Koordinator führt durch die Runde und fasst die Ergebnisse zusammen.</p>
      <label className={fieldClass}>
        <span>Worüber soll die Runde sprechen?</span>
        <Textarea autoFocus maxLength={160} onChange={(event) => setTopic(event.target.value)} required rows={3} value={topic} />
      </label>
      <div aria-label="Gesprächspartner" className="grid grid-cols-3 gap-3.5 max-sm:grid-cols-1 max-sm:gap-2">
        {[
          { name: "Mira", role: "Fragt neugierig nach" },
          { name: "Jon", role: "Widerspricht höflich" },
          { name: "Ada", role: "Sucht Gemeinsamkeiten" },
        ].map((partner) => (
          <div className="grid gap-[7px] rounded-lg bg-secondary p-3.5" key={partner.name}>
            <strong>{partner.name}</strong>
            <span className="text-[0.85rem] leading-[1.4] text-muted-foreground">{partner.role}</span>
          </div>
        ))}
      </div>
      <label className={fieldClass}>
        <span>Runden</span>
        <Input className="max-w-25" max={5} min={1} onChange={(event) => setRounds(event.target.value)} required step={1} type="number" value={rounds} />
        <small className={hintClass}>1 bis 5 Runden, mit einem Beitrag pro Person und Runde.</small>
      </label>
      <div className={actionsClass}>
        <Button onClick={onCancel} variant="outline">Abbrechen</Button>
        <Button disabled={!valid} type="submit">Gespräch starten</Button>
      </div>
    </form>
  );
}

export function SharedBoardGuide({ onCancel, onComplete }: EntryGuideContext) {
  const [title, setTitle] = useState("Ideen für unser Teamfrühstück");
  const [firstEntry, setFirstEntry] = useState("Jeder bringt etwas aus seiner Lieblingsküche mit.");
  const valid = title.trim().length > 0 && firstEntry.trim().length > 0;

  return (
    <form className={formClass} onSubmit={(event) => {
      event.preventDefault();
      if (valid) onComplete({ title: title.trim(), firstEntry: firstEntry.trim() });
    }}>
      <p className={introClass}>Sammelt Ideen, Fragen oder Aufgaben an einem Ort. Du ergänzt die Liste in seiner View, der Listenhelfer über sein Werkzeug.</p>
      <div className="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
        <div className="grid min-w-0 gap-5.5">
          <label className={fieldClass}>
            <span>Was wollt ihr sammeln?</span>
            <Input autoFocus maxLength={160} onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>
          <label className={fieldClass}>
            <span>Erster Eintrag</span>
            <Textarea maxLength={2000} onChange={(event) => setFirstEntry(event.target.value)} required rows={5} value={firstEntry} />
          </label>
        </div>
        <aside aria-label="Vorschau des Sammelboards">
          <Card className="h-full gap-0 bg-secondary p-5 [overflow-wrap:anywhere]">
            <small className={hintClass}>So beginnt eure Sammlung</small>
            <h3 className="mt-3 mb-4.5 text-[1.05rem]">{title.trim() || "Titel der Sammlung"}</h3>
            <ol className="list-decimal pl-5.5 leading-[1.6] whitespace-pre-wrap"><li>{firstEntry.trim() || "Dein erster Eintrag"}</li></ol>
            <p className="mt-5.5 text-[0.85rem] leading-[1.5] text-muted-foreground">Der Listenhelfer trägt diesen Eintrag nach dem Start ein. Danach könnt ihr beide ergänzen.</p>
          </Card>
        </aside>
      </div>
      <div className={actionsClass}>
        <Button onClick={onCancel} variant="outline">Abbrechen</Button>
        <Button disabled={!valid} type="submit">Sammelboard starten</Button>
      </div>
    </form>
  );
}
