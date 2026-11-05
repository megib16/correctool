import { renderPaper } from "./paper";
import { el } from "./render";
import type { Turn } from "./types";

export interface ChatOptions {
  /** Learner mistakes become clickable (used once the conversation is over). */
  interactive: boolean;
  /** Adds a "Listen" button to the other speaker's bubbles. */
  onReplay?: (turn: Turn) => void;
  /** Scrolls the latest bubble into view. */
  scroll?: boolean;
}

/** Draws a role-play conversation as chat bubbles. */
export function renderConversation(target: HTMLElement, turns: Turn[], opts: ChatOptions) {
  target.replaceChildren();
  for (const t of turns) {
    const bubble = el("div", `bubble ${t.role}`);
    const body = el("div", "btext");
    if (t.role === "ai") {
      body.textContent = t.text;
      bubble.append(body);
      if (opts.onReplay) {
        const listen = el("button", "replay", "▶ Listen");
        listen.type = "button";
        listen.addEventListener("click", () => opts.onReplay!(t));
        bubble.append(listen);
      }
    } else {
      if (t.segments?.length) renderPaper(body, t.segments, opts.interactive);
      else if (t.text) body.textContent = t.text;
      else body.append(el("span", "pending", "…"));
      bubble.append(body);
    }
    target.append(bubble);
  }
  if (opts.scroll) target.lastElementChild?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
