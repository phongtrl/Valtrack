/* Friends leaderboard and new-match alerts. Loaded before script.js; it only uses script.js globals when its functions are called. */

const KEY_ALERTS = "vt:alerts";
const friendData = new Map(); // "name#tag" -> { tierName, rr, score, region, form, error }
let friendsBusy = false;
let friendsLoadedAt = 0;
let alertTimer = null;

const friendKey = (f) => lower(f.name) + "#" + lower(f.tag);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// You first, then every favorite.
function friendList() {
  const list = account ? [{ name: account.name, tag: account.tag, region: account.region, me: true }] : [];
  getFavorites().forEach((f) => { if (!list.some((x) => sameId(x, f))) list.push({ ...f }); });
  return list;
}

async function loadFriend(f, force) {
  const region = f.region || (await lookupRegion(f.name, f.tag));
  const cur = (await fetchMmr(f.name, f.tag, region, force)).current || {};
  const tierName = (cur.tier && cur.tier.name) || "Unranked";
  const idx = rankIndex(tierName);
  const rr = Number(cur.rr) || 0;
  friendData.set(friendKey(f), { ...(friendData.get(friendKey(f)) || {}), tierName, rr, region, score: idx === null ? null : idx * 100 + rr, error: "" });
}

// Win rate and K/D over the last 10 ranked matches. Yours come from the matches you have saved, so they cost no requests.
async function loadForm(f, force) {
  const key = friendKey(f);
  const entry = friendData.get(key) || {};
  let rows;
  if (f.me) {
    rows = byDate().filter((m) => lower(m.mode) === "competitive").slice(0, 10);
  } else {
    const region = entry.region || f.region || (await lookupRegion(f.name, f.tag));
    rows = await cached(`form:${key}`, force ? 0 : FRESH_MS, async () => {
      const json = await api(`/valorant/v4/matches/${encodeURIComponent(region)}/pc/${encodeURIComponent(f.name)}/${encodeURIComponent(f.tag)}?size=10&mode=competitive`);
      return (Array.isArray(json.data) ? json.data : []).map((m) => parseMatch(m, f)).filter(Boolean)
        .map((m) => ({ result: m.result, kills: m.kills, deaths: m.deaths, acs: m.acs }));
    });
  }
  const s = summarize(rows);
  friendData.set(key, { ...friendData.get(key), form: { n: s.n, winRate: s.winRate, kd: s.kd } });
}

async function loadFriendRow(f, force) {
  await loadFriend(f, force);
  await loadForm(f, force);
}

// One friend at a time. After each one that needed the data source, wait about 2 s per request, which stays under its 30 a minute.
async function runFriends(list, force) {
  if (friendsBusy || !account) return;
  friendsBusy = true;
  const status = $("friends-status");
  try {
    for (const f of list) {
      status.textContent = `Loading ${f.name}…`;
      const before = apiCalls;
      try {
        await loadFriendRow(f, force);
      } catch (e) {
        if (e.status === 429) throw e; // the data source wants us to slow down: stop here
        friendData.set(friendKey(f), { ...(friendData.get(friendKey(f)) || {}), error: e.status === 404 ? "Not found" : "Unavailable" });
      }
      renderFriends();
      await pause((apiCalls - before) * 2100);
    }
    status.textContent = "";
  } catch (e) {
    status.textContent = e.message;
    friendsBusy = false;
    return;
  }
  friendsBusy = false;
  const missing = friendList().filter((f) => !friendData.has(friendKey(f)));
  if (missing.length && $("tab-friends") && !$("tab-friends").hidden) runFriends(missing, false); // favorites added while loading
}

function renderFriends() {
  const box = $("friends");
  if (!box || !account) return;
  box.replaceChildren();
  const rows = friendList().map((f) => ({ f, d: friendData.get(friendKey(f)) || {} })).sort((a, b) => (b.d.score ?? -1) - (a.d.score ?? -1));
  if (rows.length < 2) box.append(el("p", "hint", "Favorite a few friends with the star next to their name and they appear here, ranked."));
  box.append(statTable(["Player", "Rank", "RR", "Win rate", "K/D"], rows.map(({ f, d }) => ({
    name: f.me ? `${f.name}#${f.tag} (you)` : `${f.name}#${f.tag}`,
    badge: d.tierName && parseRank(d.tierName) ? rankBadge(d.tierName, 26) : undefined,
    onClick: f.me ? undefined : () => viewProfile(f),
    cells: [
      ["Rank", d.tierName || d.error || "…"],
      ["RR", d.score === null || d.score === undefined ? "—" : d.rr],
      ["Win rate, last 10 ranked", d.form && d.form.n ? `${pct(d.form.winRate)} (${d.form.n})` : "—"],
      ["K/D, last 10 ranked", d.form && d.form.n ? d.form.kd.toFixed(2) : "—"],
    ],
  })), colsFor(4)));
}

// Called when the Friends tab opens or the favorites change. Saved data is reused for 10 minutes, so reopening the tab costs nothing.
function onFriendsTab() {
  if (!account) return;
  renderFriends();
  if (Date.now() - friendsLoadedAt >= FRESH_MS) {
    friendsLoadedAt = Date.now();
    runFriends(friendList(), false);
  } else {
    const missing = friendList().filter((f) => !friendData.has(friendKey(f)));
    if (missing.length) runFriends(missing, false);
  }
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

function bindFriends() {
  $("friends-refresh").addEventListener("click", () => {
    if (Date.now() - friendsLoadedAt < MIN) { $("friends-status").textContent = "Friends were loaded a moment ago."; return; }
    friendsLoadedAt = Date.now();
    runFriends(friendList(), true);
  });
}
