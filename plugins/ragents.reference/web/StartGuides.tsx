import { useState } from "react";
import type { EntryGuideContext } from "@ragents/web/PluginRegistry";
import { Button, Card, Input, Textarea } from "@ragents/web/ui";

const formClass = "grid gap-5.5 mx-auto max-w-[820px] p-6 text-foreground max-sm:p-4.5";
const introClass = "leading-[1.6] text-muted-foreground";
const fieldClass = "grid min-w-0 gap-2.5 [&>span]:font-semibold";
const hintClass = "leading-[1.5] text-muted-foreground";
const actionsClass = "flex flex-wrap justify-end gap-2.5 pt-2";

export function ConversationGuide({ onCancel, onComplete }: EntryGuideContext) {
  const [topic, setTopic] = useState("Should city centers become car-free?");
  const [rounds, setRounds] = useState("2");
  const count = Number(rounds);
  const valid = topic.trim().length > 0 && Number.isInteger(count) && count >= 1 && count <= 5;

  return (
    <form className={formClass} onSubmit={(event) => {
      event.preventDefault();
      if (valid) onComplete({ topic: topic.trim(), rounds: count });
    }}>
      <p className={introClass}>Three perspectives on one question. The coordinator leads the round and summarizes the results.</p>
      <label className={fieldClass}>
        <span>What should the round talk about?</span>
        <Textarea autoFocus maxLength={160} onChange={(event) => setTopic(event.target.value)} required rows={3} value={topic} />
      </label>
      <div aria-label="Conversation partners" className="grid grid-cols-3 gap-3.5 max-sm:grid-cols-1 max-sm:gap-2">
        {[
          { name: "Mira", role: "Asks curious questions" },
          { name: "Jon", role: "Politely disagrees" },
          { name: "Ada", role: "Looks for common ground" },
        ].map((partner) => (
          <div className="grid gap-[7px] rounded-lg bg-secondary p-3.5" key={partner.name}>
            <strong>{partner.name}</strong>
            <span className="text-[0.85rem] leading-[1.4] text-muted-foreground">{partner.role}</span>
          </div>
        ))}
      </div>
      <label className={fieldClass}>
        <span>Rounds</span>
        <Input className="max-w-25" max={5} min={1} onChange={(event) => setRounds(event.target.value)} required step={1} type="number" value={rounds} />
        <small className={hintClass}>1 to 5 rounds, with one contribution per person and round.</small>
      </label>
      <div className={actionsClass}>
        <Button onClick={onCancel} variant="outline">Cancel</Button>
        <Button disabled={!valid} type="submit">Start conversation</Button>
      </div>
    </form>
  );
}

export function SharedBoardGuide({ onCancel, onComplete }: EntryGuideContext) {
  const [title, setTitle] = useState("Ideas for our team breakfast");
  const [firstEntry, setFirstEntry] = useState("Everyone brings something from their favorite cuisine.");
  const valid = title.trim().length > 0 && firstEntry.trim().length > 0;

  return (
    <form className={formClass} onSubmit={(event) => {
      event.preventDefault();
      if (valid) onComplete({ title: title.trim(), firstEntry: firstEntry.trim() });
    }}>
      <p className={introClass}>Collects ideas, questions, or tasks in one place. You add to the list in its view, the list helper through its tool.</p>
      <div className="grid grid-cols-2 gap-6 max-sm:grid-cols-1">
        <div className="grid min-w-0 gap-5.5">
          <label className={fieldClass}>
            <span>What do you want to collect?</span>
            <Input autoFocus maxLength={160} onChange={(event) => setTitle(event.target.value)} required value={title} />
          </label>
          <label className={fieldClass}>
            <span>First entry</span>
            <Textarea maxLength={2000} onChange={(event) => setFirstEntry(event.target.value)} required rows={5} value={firstEntry} />
          </label>
        </div>
        <aside aria-label="Collection board preview">
          <Card className="h-full gap-0 bg-secondary p-5 [overflow-wrap:anywhere]">
            <small className={hintClass}>This is how your collection starts</small>
            <h3 className="mt-3 mb-4.5 text-[1.05rem]">{title.trim() || "Collection title"}</h3>
            <ol className="list-decimal pl-5.5 leading-[1.6] whitespace-pre-wrap"><li>{firstEntry.trim() || "Your first entry"}</li></ol>
            <p className="mt-5.5 text-[0.85rem] leading-[1.5] text-muted-foreground">The list helper adds this entry after the start. After that, both of you can add more.</p>
          </Card>
        </aside>
      </div>
      <div className={actionsClass}>
        <Button onClick={onCancel} variant="outline">Cancel</Button>
        <Button disabled={!valid} type="submit">Start collection board</Button>
      </div>
    </form>
  );
}
