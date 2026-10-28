/* Insights: today's session, highlights, trend charts, rank history, teammates and the rank goal.
   Loaded before script.js. It only uses script.js globals when its functions are called. */

const KEY_RR = "vt:rr:";
const KEY_GOAL = "vt:goal";
const CHART_MATCHES = 30;
let rrHistory = []; // newest first: { id, time, change, rr, score, tier }

const localDay = (ms) => new Date(ms).toLocaleDateString("en-CA");
const average = (list) => list.reduce((a, b) => a + b, 0) / list.length;

/* ---------- Rank history (RR) ---------- */

const rrKey = () => KEY_RR + lower(account.name) + "#" + lower(account.tag);

function loadRr() {
  try {
    const saved = JSON.parse(store.get(rrKey()) || "[]");
    rrHistory = Array.isArray(saved) ? saved : [];
  } catch (e) {
    rrHistory = [];
  }
}

function mergeRr(entries) {
  const known = new Map(rrHistory.map((h) => [h.id, h]));
  entries.forEach((h) => known.set(h.id, h));
  rrHistory = [...known.values()].sort((a, b) => b.time - a.time).slice(0, 500);
  store.set(rrKey(), JSON.stringify(rrHistory));
}

async function fetchRrHistory(force = false) {
  if (!force && rrHistory.length && isFresh("rr")) return; // fetched recently: use what is saved
  try {
    const json = await api(`/valorant/v2/mmr-history/${encodeURIComponent(account.region)}/pc/${encodeURIComponent(account.name)}/${encodeURIComponent(account.tag)}`);
    const list = json?.data?.history ?? json?.history ?? (Array.isArray(json?.data) ? json.data : []);
    const entries = [];
    list.forEach((h) => {
      const id = String(h?.match_id ?? "");
      const time = Date.parse(h?.date);
      if (!id || !Number.isFinite(time)) return;
      const rr = Number.isFinite(Number(h?.rr)) ? Number(h.rr) : 0;
      const idx = rankIndex(h?.tier?.name);
      entries.push({ id, time, change: Number(h?.last_change) || 0, rr, tier: String(h?.tier?.name || ""), score: idx === null ? (Number(h?.elo) || null) : idx * 100 + rr });
    });
    mergeRr(entries);
    markFetched("rr");
  } catch (e) {
    console.warn("Could not load RR history:", e);
  }
}

/* ---------- Today ---------- */

function renderSession(view) {
  const box = $("session-body");
  box.replaceChildren();
  const today = localDay(Date.now());
  const played = view.filter((m) => localDay(matchTime(m)) === today);
  if (!played.length) {
    box.append(el("p", "muted", view.length ? `No matches today. Last played ${view[0].date}.` : "No matches yet."));
  } else {
    const s = summarize(played);
    const change = rrHistory.filter((h) => localDay(h.time) === today).reduce((t, h) => t + h.change, 0);
    const line = el("div", "session-main");
    line.append(el("b", "", `${s.wins} W – ${s.losses} L${s.draws ? ` – ${s.draws} D` : ""}`), el("span", "", `K/D ${s.kd.toFixed(2)}`), el("span", "", `ACS ${Math.round(s.acs)}`));
    if (rrHistory.length) line.append(el("span", change >= 0 ? "r-win" : "r-loss", `${change > 0 ? "+" : ""}${change} RR`));
    box.append(line);
  }
  let streak = 0;
  while (streak < view.length && view[streak].result === view[0].result) streak++;
  if (view.length && view[0].result === "loss" && streak >= 3) box.append(el("p", "note warn", `You have lost ${streak} in a row. A short break can help.`));
  if (view.length && view[0].result === "win" && streak >= 4) box.append(el("p", "note", `${streak} wins in a row.`));
}

/* ---------- Highlights ---------- */

function renderHighlights(view) {
  const list = $("insight-list");
  list.replaceChildren();
  [["map", "map"], ["agent", "agent"]].forEach(([key, word]) => {
    const rows = groupBy(key, view).filter((r) => r.n >= 3).sort((a, b) => b.winRate - a.winRate || b.n - a.n);
    const add = (label, r) => {
      const item = el("li");
      item.append(el("b", "", `${label}: `), document.createTextNode(`${r.name}, ${pct(r.winRate)} win rate over ${r.n} games`));
      list.append(item);
    };
    if (rows.length) add(`Best ${word}`, rows[0]);
    if (rows.length > 1) add(`Weakest ${word}`, rows[rows.length - 1]);
  });
  if (!list.children.length) list.append(el("li", "muted", "Highlights appear once you have 3 or more matches on the same map or agent."));
}

/* ---------- Charts ---------- */

const SVG_NS = "http://www.w3.org/2000/svg";

function svgEl(tag, attrs = {}, parent) {
  const node = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => node.setAttribute(k, v));
  if (parent) parent.append(node);
  return node;
}

const movingAverage = (values, size) => values.map((_, i) => average(values.slice(Math.max(0, i - size + 1), i + 1)));

// A smooth curve through the points that never overshoots them (monotone cubic interpolation).
function smoothPath(pts) {
  const n = pts.length;
  const f = (v) => v.toFixed(1);
  if (n < 2) return "";
  const dx = [], m = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = pts[i + 1][0] - pts[i][0];
    m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i];
  }
  const t = [m[0]];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  t[n - 1] = m[n - 2];
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s = a * a + b * b;
    if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${f(pts[0][0])},${f(pts[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    d += ` C${f(pts[i][0] + h)},${f(pts[i][1] + t[i] * h)} ${f(pts[i + 1][0] - h)},${f(pts[i + 1][1] - t[i + 1] * h)} ${f(pts[i + 1][0])},${f(pts[i + 1][1])}`;
  }
  return d;
}

// One smooth trend line (5-match average) with a node for every match, grid lines and labelled axis.
function chartSvg(values, label, { ref, min, max, fmt, meta = [], onShow, onHide }) {
  const W = 340, H = 150, L = 38, R = 12, T = 14, B = 12;
  const last = values.length - 1;
  const lo = min ?? Math.min(...values);
  const hi = max ?? Math.max(...values);
  const pad = (hi - lo) * 0.12 || 1;
  const y0 = lo - pad, y1 = hi + pad;
  const x = (i) => L + (i * (W - L - R)) / last;
  const y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const n = (v) => v.toFixed(1);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": label });

  (hi > lo ? [lo, (lo + hi) / 2, hi] : [lo]).forEach((v) => {
    svgEl("line", { class: "chart-grid", x1: L, x2: W - R, y1: n(y(v)), y2: n(y(v)) }, svg);
    svgEl("text", { class: "chart-axis", x: L - 6, y: n(y(v) + 3), "text-anchor": "end" }, svg).textContent = fmt(v);
  });
  if (ref !== undefined && ref > y0 && ref < y1) svgEl("line", { class: "chart-ref", x1: L, x2: W - R, y1: n(y(ref)), y2: n(y(ref)) }, svg);

  const curve = smoothPath(movingAverage(values, 5).map((v, i) => [x(i), y(v)]));
  svgEl("path", { class: "chart-area", d: `${curve} L${n(x(last))},${H - B} L${n(x(0))},${H - B} Z` }, svg);
  svgEl("path", { class: "chart-trend", d: curve }, svg);

  values.forEach((v, i) => {
    const point = svgEl("g", { class: "chart-point" }, svg);
    const hit = svgEl("circle", { class: "chart-hit", cx: n(x(i)), cy: n(y(v)), r: 9 }, point);
    svgEl("circle", { class: `chart-node ${(meta[i] && meta[i].tone) || ""}${i === last ? " last" : ""}`, cx: n(x(i)), cy: n(y(v)), r: i === last ? 4.5 : 3.2 }, point);
    point.addEventListener("pointerenter", () => onShow(i, hit));
    point.addEventListener("pointerleave", (e) => { if (e.pointerType !== "touch") onHide(); }); // a tap on a phone stays until you tap elsewhere
    point.addEventListener("click", () => onShow(i, hit));
  });
  return svg;
}

// The bubble that follows the node you point at: it glides between nodes, flips below near the top and stays inside the card.
function placeBubble(card, bubble, anchor, value, info) {
  bubble.replaceChildren(el("b", "", value));
  if (info) bubble.append(el("span", "bubble-label", info.label));
  bubble.dataset.tone = (info && info.tone) || "";
  const c = card.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const w = bubble.offsetWidth, h = bubble.offsetHeight;
  const x = Math.min(Math.max(a.left + a.width / 2 - c.left, w / 2 + 6), c.width - w / 2 - 6);
  const above = a.top - c.top - h - 12 > 0;
  const wasShown = bubble.classList.contains("show");
  if (!wasShown) bubble.classList.add("snap"); // first appearance: fade in place instead of gliding in from the corner
  bubble.classList.toggle("below", !above);
  bubble.style.left = `${x}px`;
  bubble.style.top = `${above ? a.top - c.top - 6 : a.bottom - c.top + 6}px`;
  if (!wasShown) { void bubble.offsetWidth; bubble.classList.remove("snap"); }
  bubble.classList.add("show");
}

function chartCard(title, values, fmt, opts = {}) {
  const card = el("figure", "chart card");
  const head = el("div", "chart-head");
  head.append(el("span", "chart-title", title), el("b", "", values.length ? (opts.head ?? fmt(values[values.length - 1])) : "—"));
  card.append(head);
  if (values.length < 3) {
    card.append(el("p", "empty", "Not enough matches yet."));
    return card;
  }
  const meta = opts.meta || [];
  const bubble = el("div", "chart-bubble");
  bubble.setAttribute("aria-hidden", "true"); // the same numbers are in the chart label for screen readers
  const foot = opts.foot ?? `Average ${fmt(average(values))} over ${values.length} matches`;
  card.append(
    chartSvg(values, `${title}: ${foot}`, {
      ...opts, fmt, meta,
      onShow: (i, anchor) => placeBubble(card, bubble, anchor, fmt(values[i]), meta[i]),
      onHide: () => bubble.classList.remove("show"),
    }),
    el("p", "chart-foot", foot),
    bubble
  );
  return card;
}

function renderCharts(view) {
  const recent = view.slice(0, CHART_MATCHES).reverse(); // oldest first
  const meta = recent.map((m) => ({ tone: m.result, label: `${m.date} · ${m.map}${m.agent ? " · " + m.agent : ""}` }));
  const rolling = recent.map((_, i) => {
    const window = recent.slice(Math.max(0, i - 9), i + 1);
    return (window.filter((m) => m.result === "win").length / window.length) * 100;
  });
  const mode = $("mode-filter").selectedOptions[0];
  $("charts-note").textContent = `Last ${recent.length} matches · ${mode ? mode.textContent : "all game modes"}`;
  $("charts").replaceChildren(
    chartCard("Combat score", recent.map((m) => m.acs), (v) => String(Math.round(v)), { meta }),
    chartCard("K/D per match", recent.map(kdOf), (v) => v.toFixed(2), { ref: 1, meta }),
    chartCard("Win rate, rolling 10", rolling, (v) => Math.round(v) + "%", { ref: 50, min: 0, max: 100, meta })
  );
}

function renderRrChart() {
  const box = $("rr-chart");
  box.replaceChildren();
  const data = [...rrHistory].reverse().filter((h) => h.score !== null);
  if (data.length < 3) {
    box.append(el("p", "empty", rrHistory.length ? "Not enough rank history yet." : "Rank history appears after you press Fetch latest."));
    return;
  }
  const last = data[data.length - 1];
  const net = last.score - data[0].score;
  const meta = data.map((h) => ({ tone: h.change > 0 ? "win" : h.change < 0 ? "loss" : "", label: `${localDay(h.time)} · ${h.change > 0 ? "+" : ""}${h.change} RR` }));
  box.append(chartCard("Rank rating", data.map((h) => h.score), (v) => String(Math.round(v)), {
    head: `${last.tier} · ${last.rr} RR`,
    foot: `${net > 0 ? "+" : ""}${net} RR across your last ${data.length} ranked games`,
    meta,
  }));
}

/* ---------- Teammates ---------- */

function renderTeammates(view) {
  const box = $("teammates");
  box.replaceChildren();
  const stats = new Map();
  view.forEach((m) => {
    const me = m.details && m.details.players.find(isMine);
    if (!me) return;
    m.details.players.forEach((p) => {
      if (p === me || p.team !== me.team) return;
      const s = stats.get(p.key) || { name: `${p.name}#${p.tag}`, n: 0, wins: 0 };
      s.n++;
      if (m.result === "win") s.wins++;
      stats.set(p.key, s);
    });
  });
  const rows = [...stats.values()].filter((s) => s.n >= 2).sort((a, b) => b.n - a.n || b.wins - a.wins).slice(0, 8);
  if (!rows.length) {
    box.append(el("p", "empty", "Teammates show up after you have played twice with the same player. Player details load with Fetch latest."));
    return;
  }
  rows.forEach((s) => box.append(breakdownRow(s.name, `${s.n} games together`, s.wins / s.n)));
}

/* ---------- Rank goal ---------- */

/* ---------- Rank climb model ---------- */

// Typical RR for a win or a loss when there is no saved history to learn from.
const TYPICAL_SWING = [14, 17, 19, 20, 20, 21, 23, 26];
const CLIMB_RUNS = 1500;
const CLIMB_CAP = 150;

const typicalSwings = () => ({ wins: TYPICAL_SWING, losses: TYPICAL_SWING, own: false });

// What you really gain and lose per game, taken from your saved rank history.
function rrSwings() {
  const wins = [], losses = [];
  rrHistory.slice(0, 40).forEach((h) => {
    if (h.change > 0) wins.push(h.change);
    else if (h.change < 0) losses.push(-h.change);
  });
  return wins.length >= 4 && losses.length >= 4 ? { wins, losses, own: true } : typicalSwings();
}

// Seeded, so the same question always gives the same answer.
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Plays the climb many times. Every game is a win (worth one of your usual wins) with probability winRate, otherwise a loss.
// Returns the median number of games and how many games cover 80% of the runs, or null when fewer than half of the runs get there.
function simulateClimb(gap, winRate, swings) {
  const rand = seededRandom(Math.round(gap * 997 + winRate * 100003));
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const reached = new Array(CLIMB_CAP + 1).fill(0);
  for (let run = 0; run < CLIMB_RUNS; run++) {
    let progress = 0;
    for (let game = 1; game <= CLIMB_CAP; game++) {
      progress += rand() < winRate ? pick(swings.wins) : -pick(swings.losses);
      if (progress >= gap) { reached[game]++; break; }
    }
  }
  let total = 0, median = null, p80 = null;
  for (let game = 1; game <= CLIMB_CAP && p80 === null; game++) {
    total += reached[game] / CLIMB_RUNS;
    if (median === null && total >= 0.5) median = game;
    if (total >= 0.8) p80 = game;
  }
  return median === null || median > 100 ? null : { median, p80 }; // beyond 100 games the estimate means little
}

const gamesLabel = (n) => {
  const x = n < 20 ? n : Math.round(n / 5) * 5; // beyond 20 games the exact number means little
  return x === 1 ? "1 game" : `${x} games`;
};

// Rows of [win rate, label] shared by the compare tab and the rank goal.
function rateRows(withMine) {
  const rows = [[0.5, "50% win rate"], [0.55, "55% win rate"], [0.6, "60% win rate"], [0.65, "65% win rate"]];
  const mine = recentCompetitiveWinRate();
  if (withMine && mine !== null) rows.unshift([mine, `Your recent win rate (${pct(mine)})`]);
  return rows;
}

function catchupEl(title, sub, size, rows, swings) {
  const results = rows.map(([rate]) => simulateClimb(size, rate, swings));
  const max = Math.max(1, ...results.filter(Boolean).map((r) => r.median));
  const card = el("div", "cmp-catchup card");
  card.append(el("h3", "", title), el("p", "sub", sub));
  rows.forEach(([, label], i) => {
    const r = results[i];
    const bar = el("div", "bar");
    const fill = el("div", "fill");
    fill.style.width = r ? Math.max(4, (r.median / max) * 100) + "%" : "0%";
    bar.append(fill);
    const est = el("span", "est" + (r ? "" : " no"));
    est.append(document.createTextNode(r ? `About ${gamesLabel(r.median)}` : "Unlikely"));
    if (r && r.p80) est.append(el("small", "", `80% within ${gamesLabel(r.p80)}`));
    const row = el("div", "cmp-row");
    row.append(el("span", "", label), bar, est);
    card.append(row);
  });
  const basis = swings.own
    ? `Based on your recent ranked games: wins average +${Math.round(average(swings.wins))} RR and losses −${Math.round(average(swings.losses))} RR.`
    : "Assumes typical swings of about 20 RR for a win or a loss.";
  card.append(el("p", "cmp-note", `${basis} Each row replays the climb ${CLIMB_RUNS.toLocaleString("en")} times. Immortal and Radiant are approximated, and demotion protection is ignored.`));
  return card;
}

const rankNameAt = (i) => {
  if (i >= 24) return "Radiant";
  const tier = RANK_TIERS[Math.floor(i / 3)];
  return `${tier[0].toUpperCase()}${tier.slice(1)} ${(i % 3) + 1}`;
};

// Dot plot of your recent wins by RR gained, with the RR you need marked. Green dots would be enough.
function winStrip(wins, gap) {
  const W = 340, H = 72, L = 12, R = 12;
  const lo = Math.min(...wins, gap) - 2, hi = Math.max(...wins, gap) + 2;
  const x = (v) => (L + ((v - lo) / (hi - lo)) * (W - L - R)).toFixed(1);
  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", "aria-label": `Your recent wins gave ${Math.min(...wins)} to ${Math.max(...wins)} RR. You need ${gap}.` });
  svgEl("line", { class: "chart-grid", x1: L, x2: W - R, y1: 54, y2: 54 }, svg);
  svgEl("line", { class: "chart-ref", x1: x(gap), x2: x(gap), y1: 12, y2: 58 }, svg);
  svgEl("text", { class: "chart-axis", x: x(gap), y: 8, "text-anchor": "middle" }, svg).textContent = `${gap} needed`;
  const stack = new Map();
  [...wins].sort((a, b) => a - b).forEach((v) => {
    const level = stack.get(v) || 0;
    stack.set(v, level + 1);
    svgEl("circle", { class: "chart-node" + (v >= gap ? " win" : ""), cx: x(v), cy: Math.max(16, 48 - level * 9), r: 4 }, svg);
  });
  svgEl("text", { class: "chart-axis", x: L, y: 69 }, svg).textContent = `+${Math.min(...wins)}`;
  svgEl("text", { class: "chart-axis", x: W - R, y: 69, "text-anchor": "end" }, svg).textContent = `+${Math.max(...wins)}`;
  return svg;
}

function renderGoal() {
  const select = $("goal-select");
  const out = $("goal-result");
  out.replaceChildren();
  if (!rankNow) {
    out.append(el("p", "hint", "Fetch latest to load your current rank first."));
    return;
  }
  const saved = store.get(KEY_GOAL);
  select.value = saved && rankIndex(saved) !== null ? saved : rankNameAt(Math.min(24, Math.floor(rankNow.score / 100) + 1));
  const target = rankIndex(select.value) * 100;
  const gap = target - rankNow.score;
  if (gap <= 0) {
    out.append(el("p", "cmp-summary card", `You are already at or above ${select.value}.`));
    return;
  }

  // Where you are on the way: from the start of your current rank to the target.
  const start = Math.floor(rankNow.score / 100) * 100;
  const progress = el("div", "goal-progress");
  const bar = el("div", "goal-bar");
  const fill = el("div", "fill");
  fill.style.width = pct(Math.min(1, Math.max(0, (rankNow.score - start) / (target - start))));
  bar.append(fill);
  const caption = el("div", "goal-caption");
  caption.append(el("span", "", `${rankNow.name}, ${rankNow.rr} RR`), el("span", "", `${gap} RR to ${select.value}`));
  progress.append(bar, caption);

  // The next game: would one win be big enough?
  const swings = rrSwings();
  const rate = recentCompetitiveWinRate();
  const share = swings.wins.filter((v) => v >= gap).length / swings.wins.length;
  const verdict = share >= 0.85 ? "A win will very likely take you there."
    : share >= 0.6 ? "A win will likely take you there."
    : share >= 0.3 ? "A win may take you there."
    : share > 0 ? "A win is unlikely to be enough on its own."
    : `One win is not enough. You need at least ${Math.ceil(gap / Math.max(...swings.wins))} wins.`;
  const next = el("div", "goal-next card");
  const stats = el("div", "goal-stats");
  const stat = (value, text) => { const box = el("div"); box.append(el("b", "", value), el("span", "", text)); return box; };
  stats.append(
    stat(pct(share), `of your usual wins are worth ${gap} RR or more`),
    stat(pct((rate ?? 0.5) * share), `chance to rank up next game at a ${pct(rate ?? 0.5)} win rate`)
  );
  next.append(el("h3", "", "Your next game"), stats, el("p", "goal-verdict", verdict));
  if (swings.own) {
    next.append(winStrip(swings.wins, gap), el("p", "chart-foot", `Your last ${swings.wins.length} wins by RR gained. Green dots would be enough.`));
  } else {
    next.append(el("p", "chart-foot", "There is no rank history yet, so a win is assumed to be worth about 14 to 26 RR."));
  }

  out.append(progress, next, catchupEl(`Games to reach ${select.value}`, "How many games it takes, at different win rates", gap, rateRows(true), swings));
}

function bindInsights() {
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".chart-point")) document.querySelectorAll(".chart-bubble.show").forEach((b) => b.classList.remove("show"));
  });
  const select = $("goal-select");
  for (let i = 0; i <= 24; i++) select.append(new Option(rankNameAt(i), rankNameAt(i)));
  select.addEventListener("change", () => {
    store.set(KEY_GOAL, select.value);
    renderGoal();
  });
}

function renderInsights(view) {
  renderSession(view);
  renderHighlights(view);
  renderCharts(view);
  renderRrChart();
  renderTeammates(view);
  renderGoal();
}
