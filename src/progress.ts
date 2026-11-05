import { el } from "./render";
import { TYPE_LABELS } from "./types";
import type { ErrorType, Stats } from "./types";

export function buildProgress(stats: Stats, onReset: () => void): HTMLElement {
  const root = el("div", "progress");
  if (!stats.sessions) {
    root.append(
      el("p", "empty", "Finish a practice session and the patterns in your mistakes will show up here. Everything stays on this device."),
    );
    return root;
  }

  // overview numbers
  const rate = stats.words ? (stats.mistakes / stats.words) * 100 : 0;
  const grid = el("div", "stat-grid");
  const cards: [string, string][] = [
    [String(stats.sessions), stats.sessions === 1 ? "session" : "sessions"],
    [stats.words.toLocaleString(), "words spoken"],
    [String(stats.mistakes), "mistakes"],
    [rate.toFixed(1), "mistakes per 100 words"],
  ];
  for (const [num, label] of cards) {
    const c = el("div", "stat");
    c.append(el("div", "num", num), el("div", "lbl", label));
    grid.append(c);
  }
  root.append(grid);

  // which kinds of mistake
  root.append(el("h2", "", "What trips you up most"));
  const types = (Object.entries(stats.byType) as [ErrorType, number][]).sort((a, b) => b[1] - a[1]);
  const total = types.reduce((n, [, c]) => n + c, 0);
  if (!total) {
    root.append(el("p", "empty", "No mistakes recorded yet. Nice!"));
  } else {
    for (const [type, count] of types) {
      const row = el("div", "bar-row");
      const track = el("div", "bar-track");
      const fill = el("div", "bar-fill");
      fill.style.width = `${(count / types[0][1]) * 100}%`;
      track.append(fill);
      row.append(
        el("div", "bar-label", TYPE_LABELS[type] ?? type),
        track,
        el("div", "bar-count", `${count} · ${Math.round((count / total) * 100)}%`),
      );
      root.append(row);
    }
  }

  // the exact mistakes that keep coming back
  root.append(el("h2", "", "Keep running into"));
  const repeats = Object.values(stats.pairs)
    .filter((p) => p.count >= 2)
    .sort((a, b) => b.count - a.count || b.last - a.last)
    .slice(0, 8);
  if (!repeats.length) {
    root.append(el("p", "empty", "Nothing has repeated yet. Mistakes you make more than once will be listed here."));
  }
  for (const p of repeats) {
    const row = el("div", "note");
    row.append(
      el("span", "wrong", p.wrong),
      " → ",
      el("strong", "right", p.right),
      " ",
      el("span", "tag", TYPE_LABELS[p.type] ?? p.type),
      el("span", "times", ` × ${p.count}`),
    );
    root.append(row);
  }

  // trend: mistakes per 100 words, recent sessions
  if (stats.history.length >= 2) {
    root.append(el("h2", "", "Over time"));
    root.append(el("p", "empty", "Mistakes per 100 words in your most recent sessions. Lower is better."));
    const recent = stats.history.slice(-12).map((h) => ({ ...h, rate: h.words ? (h.mistakes / h.words) * 100 : 0 }));
    const maxRate = Math.max(...recent.map((r) => r.rate), 1);
    const chart = el("div", "trend");
    for (const r of recent) {
      const col = el("div", "trend-col");
      const bar = el("div", "trend-bar");
      bar.style.height = `${(r.rate / maxRate) * 100}%`;
      bar.title = `${new Date(r.date).toLocaleDateString()}: ${r.rate.toFixed(1)} per 100 words (${r.mistakes} mistakes, ${r.words} words)`;
      col.append(bar);
      chart.append(col);
    }
    root.append(chart);
  }

  const reset = el("button", "btn danger", "Reset my progress");
  reset.type = "button";
  reset.addEventListener("click", () => {
    if (confirm("Delete all your progress data on this device? This cannot be undone.")) onReset();
  });
  const resetRow = el("div", "reset-row");
  resetRow.append(reset);
  root.append(resetRow);
  return root;
}
