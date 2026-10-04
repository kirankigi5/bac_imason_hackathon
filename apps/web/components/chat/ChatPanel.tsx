"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowUp, Sparkles } from "lucide-react";
import type { ChangeRecord } from "@/lib/types/domain";
import { changeLabel } from "@/lib/frontend/factor-metadata";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; changes?: ChangeRecord[] };
const examples = [
  { label: "500 MW AI Training", message: "I need a 500 MW AI training campus by 2030 with strong clean energy and low water risk." },
  { label: "Low Water Risk", message: "I need a 300 MW AI inference facility by 2030. Water resilience is the top priority." },
  { label: "Clean Power", message: "I need a 500 MW mixed AI facility by 2030. Clean energy matters most." }
];

export function ChatPanel({ messages, pending, onSend, intake }: {
  messages: ChatMessage[]; pending: boolean; onSend: (message: string) => void; intake: boolean;
}) {
  const [draft, setDraft] = useState("");
  const thread = useRef<HTMLDivElement>(null);
  useEffect(() => { if (thread.current) thread.current.scrollTop = thread.current.scrollHeight; }, [messages, pending]);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || pending) return;
    onSend(draft.trim()); setDraft("");
  }
  return <aside className="conversation-panel" aria-label="AI Decision Assistant">
    {intake ? <div className="intake-heading"><span className="intake-symbol"><Sparkles size={25} /></span>
      <h1>Where should you build your next AI data center?</h1>
    </div> : <header className="assistant-heading"><Sparkles size={18} /><h2>AI Decision Assistant</h2></header>}
    <div ref={thread} className="conversation-thread" aria-label="Conversation" aria-live="polite">
      {messages.filter((message) => !intake || message.id !== "welcome").map((message) => <article className={`conversation-message message-${message.role}`} key={message.id}>
        <span className="message-author">{message.role === "assistant" ? "Planner" : "You"}</span>
        <p>{message.content}</p>
        {message.changes?.length ? <details className="message-changes"><summary>{message.changes.length} accepted changes</summary>
          <ul>{message.changes.map((change, index) => <li key={index}><strong>{changeLabel(change.field, change.label)}</strong>: {String(change.oldValue ?? "None")} &rarr; {String(change.newValue ?? "None")}</li>)}</ul>
        </details> : null}
      </article>)}
      {pending ? <p className="thinking-status" role="status"><span />{intake ? "Understanding your project..." : "Updating your decision..."}</p> : null}
    </div>
    <form className="conversation-composer" onSubmit={submit}>
      <textarea aria-label="Project message" rows={intake ? 3 : 2} placeholder={intake ? "Tell me what you're planning to build..." : "Refine your project or ask a question..."}
        value={draft} maxLength={6000} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); }
        }} />
      <button className="send-command" type="submit" aria-label="Find Locations" aria-busy={pending} title="Send message" disabled={pending || !draft.trim()}><ArrowUp size={19} />{intake ? <span>Send</span> : null}</button>
    </form>
    {intake ? <div className="quick-starts"><span>Quick starts</span><div>{examples.map((example) => <button key={example.label} disabled={pending} onClick={() => setDraft(example.message)}>{example.label}</button>)}</div></div>
      : <div className="chat-suggestions">{["Water matters more.", "Only Michigan and Ohio."].map((message) => <button key={message} disabled={pending} onClick={() => setDraft(message)}>{message}</button>)}</div>}
  </aside>;
}
