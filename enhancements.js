/* Data freshness and match-log filters. Loaded before script.js. */
const dataStates = new Map();
const matchFilters = { map: "", agent: "", result: "", since: "", until: "", query: "" };

function freshnessOwner() {
  return account ? lower(account.name) + "#" + lower(account.tag) : "";
}

function setDataState(kind, state, error = "", owner = freshnessOwner()) {
  dataStates.set((kind === "store" ? "global" : owner) + ":" + kind, { state, error });
  renderFreshness();
}

function renderFreshness() {
  const box = document.getElementById("data-freshness");
  if (!box || !account) return;
  const times = fetchedTimes();
  const shopTime = typeof shopSnapshot !== "undefined" && shopSnapshot ? shopSnapshot.fetchedAt : 0;
  const rankCopy = savedCopy(`mmr:${lower(account.name)}#${lower(account.tag)}`);
  box.replaceChildren();
  [["matches", "Matches", times.matches], ["rank", "Rank", times.rank || rankCopy?.t],
    ["rr", "RR history", times.rr], ["store", "Featured store", shopTime]].forEach(([kind, label, fetched]) => {
    const status = dataStates.get((kind === "store" ? "global" : freshnessOwner()) + ":" + kind);
    const item = el("div", "freshness-item");
    item.setAttribute("role", "listitem");
    item.dataset.freshness = kind;
    item.append(el("strong", "", label));
    const time = Number(fetched);
    const description = time > 0 ? `Updated ${ago(Math.max(0, Date.now() - time))}` : "No fetch recorded";
    item.append(el("span", "muted", description));
    if (time > 0) item.title = new Date(time).toLocaleString();
    if (status?.state === "loading") item.append(el("small", "", "Updating…"));
    if (status?.state === "error") {
      item.append(el("small", "error", "Update failed"));
      const reason = el("span", "freshness-error", status.error);
      item.append(reason);
    }
    box.append(item);
  });
}

function renderMatchFilterOptions() {
  for (const field of ["map", "agent"]) {
    const select = $("match-" + field);
    const options = [...new Set(matches.map((m) => String(m[field] || "Unknown")))].sort();
    select.replaceChildren(...["", ...options].map((value) => {
      const option = el("option", "", value || (field === "map" ? "All maps" : "All agents"));
      option.value = value;
      return option;
    }));
    if (!options.includes(matchFilters[field])) matchFilters[field] = "";
    select.value = matchFilters[field];
  }
}

function filterMatchLog(list) {
  const f = matchFilters;
  const query = f.query.trim().toLowerCase();
  if (f.since && f.until && f.since > f.until) return [];
  return list.filter((m) => {
    if (f.map && m.map !== f.map || f.agent && m.agent !== f.agent || f.result && m.result !== f.result) return false;
    const date = String(m.date || "").slice(0, 10);
    if (f.since && date < f.since || f.until && date > f.until) return false;
    if (!query) return true;
    const players = Array.isArray(m.details?.players) ? m.details.players : [];
    return [m.map, m.agent, m.mode, ...players.map((p) => `${p.name || ""}#${p.tag || ""}`)]
      .some((value) => String(value || "").toLowerCase().includes(query));
  });
}

function resetMatchFilters() {
  for (const key of Object.keys(matchFilters)) {
    matchFilters[key] = "";
    const input = document.getElementById("match-" + key);
    if (input) input.value = "";
  }
  logPage = 0;
}

function initEnhancements() {
  readShop();
  document.getElementById("match-filter-form").addEventListener("submit", (e) => e.preventDefault());
  for (const key of Object.keys(matchFilters)) {
    $("match-" + key).addEventListener(key === "query" ? "input" : "change", (e) => {
      matchFilters[key] = e.target.value;
      logPage = 0;
      renderLog(scope());
    });
  }
  $("match-clear").addEventListener("click", () => {
    resetMatchFilters();
    renderLog(scope());
  });
  setInterval(renderFreshness, 60000);
}
