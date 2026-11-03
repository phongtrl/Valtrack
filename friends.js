/* Friends leaderboard and new-match alerts. Loaded before script.js; it only uses script.js globals when its functions are called. */

const KEY_ALERTS = "vt:alerts";
const friendErrors = new Map(); // "name#tag" -> message from the last failed load
let friendLoading = null; // "name#tag" being loaded; only one at a time
let alertTimer = null;

const friendKey = (f) => lower(f.name) + "#" + lower(f.tag);

// You first, then every favorite.
function friendList() {
  const list = account ? [{ name: account.name, tag: account.tag, region: account.region, me: true }] : [];
  getFavorites().forEach((f) => { if (!list.some((x) => sameId(x, f))) list.push({ ...f }); });
  return list;
}

const myRanked = () => byDate().filter((m) => lower(m.mode) === "competitive").slice(0, 10);

// What is already saved in this browser for a friend. Reading it costs no requests.
function savedFriend(f) {
  const key = friendKey(f);
  const out = {};
  const mmr = savedCopy(`mmr:${key}`);
  if (mmr) {
    const cur = (mmr.v && mmr.v.current) || {};
    out.tierName = (cur.tier && cur.tier.name) || "Unranked";
    out.rr = Number(cur.rr) || 0;
    const idx = rankIndex(out.tierName);
    out.score = idx === null ? null : idx * 100 + out.rr;
    out.at = mmr.t;
  }
  const form = f.me ? { v: myRanked() } : savedCopy(`form:${key}`);
  if (form) {
    const s = summarize(form.v || []);
    out.form = { n: s.n, winRate: s.winRate, kd: s.kd };
    if (form.t) out.at = Math.min(out.at || form.t, form.t);
  }
  return out;
}

// Loads one friend when you tap their wheel: rank, then their last 10 ranked matches (yours come from your saved matches).
// Anything loaded in the last 10 minutes is reused, so tapping again costs nothing.
async function loadFriendNow(f) {
  const status = $("friends-status");
  if (friendLoading) {
    status.textContent = "One friend at a time. Wait for the current one to finish.";
    return;
  }
  const key = friendKey(f);
  const started = Date.now();
  friendLoading = key;
  friendErrors.delete(key);
  status.textContent = `Loading ${f.name}…`;
  renderFriends();
  const pressed = document.querySelector(`#friends [data-friend="${CSS.escape(key)}"]`);
  if (pressed) pressed.focus();
  try {
    const region = f.region || (await lookupRegion(f.name, f.tag));
    await fetchMmr(f.name, f.tag, region);
    if (!f.me) {
      await cached(`form:${key}`, FRESH_MS, async () => {
        const json = await api(`/valorant/v4/matches/${encodeURIComponent(region)}/pc/${encodeURIComponent(f.name)}/${encodeURIComponent(f.tag)}?size=10&mode=competitive`);
        return (Array.isArray(json.data) ? json.data : []).map((m) => parseMatch(m, f)).filter(Boolean)
          .map((m) => ({ result: m.result, kills: m.kills, deaths: m.deaths, acs: m.acs }));
      });
    }
    status.textContent = "";
  } catch (e) {
    friendErrors.set(key, e.status === 404 ? "Not found" : "Unavailable");
    status.textContent = e.message || "Could not load this friend.";
  } finally {
    // saved data returns instantly, so keep the wheel turning long enough to be seen
    const rest = 700 - (Date.now() - started);
    if (rest > 0) await new Promise((resolve) => setTimeout(resolve, rest));
    friendLoading = null;
    renderFriends();
    const again = document.querySelector(`#friends [data-friend="${CSS.escape(key)}"]`);
    if (again) again.focus();
  }
}

const REFRESH_SVG = '<svg class="icon refresh" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20.5 4v4.5H16"/></svg>';

function friendButton(f) {
  const loading = friendLoading === friendKey(f);
  const b = el("button", "tool icon-only" + (loading ? " is-loading" : ""));
  b.type = "button";
  b.dataset.friend = friendKey(f);
  b.innerHTML = REFRESH_SVG;
  b.setAttribute("aria-label", `Load ${f.name}`);
  b.title = `Load ${f.name}`;
  if (loading) b.setAttribute("aria-busy", "true");
  b.addEventListener("click", (e) => {
    e.stopPropagation(); // the row itself opens the profile
    loadFriendNow(f);
  });
  return b;
}

function renderFriends() {
  const box = $("friends");
  if (!box || !account) return;
  box.replaceChildren();
  const rows = friendList()
    .map((f) => ({ f, d: { ...savedFriend(f), error: friendErrors.get(friendKey(f)) } }))
    .sort((a, b) => (b.d.score ?? -1) - (a.d.score ?? -1));
  if (rows.length < 2) box.append(el("p", "hint", "Favorite a few friends with the star next to their name and they appear here."));
  box.append(statTable(["Player", "Rank", "RR", "Win rate", "K/D"], rows.map(({ f, d }) => ({
    name: f.me ? `${f.name}#${f.tag} (you)` : `${f.name}#${f.tag}`,
    sub: friendLoading === friendKey(f) ? "Loading…" : d.at ? `Updated ${ago(Date.now() - d.at)}` : "Not loaded yet",
    badge: d.tierName && parseRank(d.tierName) ? rankBadge(d.tierName, 26) : undefined,
    action: friendButton(f),
    onClick: f.me ? undefined : () => viewProfile(f),
    cells: [
      ["Rank", d.error || d.tierName || "—"],
      ["RR", d.score === null || d.score === undefined ? "—" : d.rr],
      ["Win rate, last 10 ranked", d.form && d.form.n ? `${pct(d.form.winRate)} (${d.form.n})` : "—"],
      ["K/D, last 10 ranked", d.form && d.form.n ? d.form.kd.toFixed(2) : "—"],
    ],
  })), colsFor(4)));
}

// Called when the Friends tab opens or the favorites change. Only shows what is saved; nothing is requested until you tap a wheel.
function onFriendsTab() {
  renderFriends();
}

/* ---------- Match alerts: only while this page is open ---------- */

const alertsOn = () => store.get(KEY_ALERTS) === "1";

function announce(m) {
  const text = `${m.result[0].toUpperCase() + m.result.slice(1)} ${m.roundsWon} – ${m.roundsLost} on ${m.map} as ${m.agent}, K/D ${kdOf(m).toFixed(2)}`;
  $("toast-text").textContent = text;
  $("toast-view").onclick = () => { $("toast").hidden = true; openMatch(m.id); };
  $("toast").hidden = false;
  if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
    new Notification("Valtrack: new match", { body: text, icon: "icon-192.png" });
  }
}

// One small request: is the newest match one we have not saved yet? If so, load it.
async function checkForNewMatch() {
  if (!alertsOn() || !account || syncing) return;
  try {
    const region = account.region || (await lookupRegion());
    const json = await api(`/valorant/v4/matches/${encodeURIComponent(region)}/pc/${encodeURIComponent(account.name)}/${encodeURIComponent(account.tag)}?size=1`);
    const latest = json && Array.isArray(json.data) && json.data[0] && json.data[0].metadata && json.data[0].metadata.match_id;
    if (!latest || matches.some((m) => m.id === String(latest))) return;
    await syncMatches(true);
    const found = matches.find((m) => m.id === String(latest));
    if (found) announce(found);
  } catch (e) { /* stay quiet, the next check tries again */ }
}

function startAlerts() {
  clearInterval(alertTimer);
  if (alertsOn()) alertTimer = setInterval(checkForNewMatch, 240000);
  const button = $("alerts-toggle");
  button.setAttribute("aria-pressed", String(alertsOn()));
  button.textContent = alertsOn() ? "Match alerts: on" : "Match alerts: off";
}
