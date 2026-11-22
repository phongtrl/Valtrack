/* Review tools use the active profile's local match history. */
function reviewBookmarks() {
  try {
    return new Map(JSON.parse(store.get(matchKey() + ":review") || "[]"));
  } catch {
    return new Map();
  }
}

function reviewMatchEl(match) {
  const box = el("section", "card pad review-match");
  const bookmarks = reviewBookmarks();
  const id = String(match.id);
  const marked = bookmarks.has(id);
  const toggle = el("button", "quiet small", marked ? "Remove from Review later" : "Review later");
  toggle.type = "button";
  toggle.setAttribute("aria-pressed", String(marked));
  const status = el("p", "hint");
  status.setAttribute("role", "status");
  function save(note, remove = false) {
    const next = reviewBookmarks();
    if (remove) next.delete(id);
    else next.set(id, note);
    if (!store.set(matchKey() + ":review", JSON.stringify([...next]))) {
      status.textContent = "Could not save on this device.";
      return;
    }
    renderLog(scope());
    if (remove || !marked) {
      const replacement = reviewMatchEl(match);
      box.replaceWith(replacement);
      replacement.querySelector("button").focus();
    } else status.textContent = "Note saved on this device.";
  }
  toggle.addEventListener("click", () => save("", marked));
  box.append(toggle);
  if (marked) {
    const form = el("form", "review-note");
    const label = el("label", "", "Review note");
    const note = el("textarea");
    note.maxLength = 500;
    note.rows = 2;
    note.value = bookmarks.get(id) || "";
    label.append(note);
    const submit = el("button", "quiet small", "Save note");
    submit.type = "submit";
    form.append(label, submit);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      save(note.value.trim());
    });
    box.append(form);
  }
  box.append(status);
  return box;
}

function matchKillCoordinates(kill) {
  const location = kill?.victim?.location ?? kill?.victim_death_location ?? kill?.victim_location ?? kill?.victimLocation;
  return Number.isFinite(location?.x) && Number.isFinite(location?.y) ? [location.x, location.y] : [];
}

let mapCatalog;

function loadMapCatalog() {
  if (!mapCatalog) {
    mapCatalog = fetch("https://valorant-api.com/v1/maps").then(async (response) => {
      if (!response.ok) throw new Error("Map catalog unavailable");
      const json = await response.json();
      if (!Array.isArray(json.data)) throw new Error("Map catalog unavailable");
      return json.data;
    }).catch((error) => {
      mapCatalog = null;
      throw error;
    });
  }
  return mapCatalog;
}

function killMapEl(match, timeline) {
  const section = el("details", "card pad kill-map");
  section.append(el("summary", "", "Kill and death map"));
  const mine = match.details.players.findIndex(isMine);
  const points = [];
  match.timeline?.forEach((round, i) => {
    for (const [killer, victim, time, x, y] of round.k || []) {
      if (mine < 0 || (killer !== mine && victim !== mine) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ round: i, side: round.s, time, x, y, kind: victim === mine ? "Death" : "Kill" });
    }
  });
  if (!points.length) {
    section.append(match.mapLocationsSaved
      ? el("p", "hint", "No kill or death locations are available for this match.")
      : loadMatchEl(match, "Locations aren’t saved for this match yet.", "Load map data"));
    return section;
  }

  const body = el("div", "kill-map-body");
  const status = el("p", "hint");
  status.setAttribute("role", "status");
  section.append(body, status);

  let loading = false;
  section.addEventListener("toggle", async () => {
    if (!section.open || loading || body.children.length) return;
    loading = true;
    status.textContent = "Loading map…";
    try {
      const maps = await loadMapCatalog();
      const map = maps.find((entry) => lower(entry.displayName) === lower(match.map));
      if (!map?.displayIcon || ![map.xMultiplier, map.yMultiplier, map.xScalarToAdd, map.yScalarToAdd].every(Number.isFinite)) {
        status.textContent = "No map image and coordinate transform are available for this map.";
        return;
      }
      const image = shopImage(map.displayIcon, match.map + " minimap", "kill-map-image");
      if (!image) throw new Error("Invalid map image");
      const plot = el("div", "kill-map-plot");
      plot.hidden = true;
      plot.append(image);
      const controls = el("label", "", "Side");
      const side = el("select");
      for (const [value, title] of [["", "All rounds"], ["A", "Attack"], ["D", "Defence"]]) {
        const option = el("option", "", title);
        option.value = value;
        side.append(option);
      }
      controls.append(side);
      const redraw = () => {
        plot.querySelectorAll("button").forEach((button) => button.remove());
        let count = 0;
        for (const point of points) {
          if (side.value && point.side !== side.value) continue;
          const left = point.y * map.xMultiplier + map.xScalarToAdd;
          const top = point.x * map.yMultiplier + map.yScalarToAdd;
          if (left < 0 || left > 1 || top < 0 || top > 1) continue;
          const marker = el("button", "kill-marker " + point.kind.toLowerCase(), point.kind === "Kill" ? "+" : "×");
          marker.type = "button";
          marker.style.left = left * 100 + "%";
          marker.style.top = top * 100 + "%";
          marker.title = marker.ariaLabel = `${point.kind}, round ${point.round + 1}, ${clock(point.time)}`;
          marker.addEventListener("click", () => {
            const round = timeline.querySelectorAll(".tl-round")[point.round];
            round?.click();
            round?.focus();
            round?.scrollIntoView({ block: "nearest", inline: "nearest" });
          });
          plot.append(marker);
          count++;
        }
        status.textContent = count ? `${count} locations shown. Select a marker to open its round.` : "No locations for this side.";
      };
      image.addEventListener("error", () => {
        plot.hidden = true;
        status.textContent = "Could not load the map image. Close and reopen to retry.";
        body.replaceChildren();
      });
      image.addEventListener("load", () => { plot.hidden = false; redraw(); });
      image.loading = "eager";
      side.addEventListener("change", redraw);
      body.append(controls, el("p", "hint", "+ Kill · × Death. Markers show where the victim fell."), plot);
    } catch {
      status.textContent = "Could not load the map catalog. Close and reopen to retry.";
    } finally {
      loading = false;
    }
  });
  return section;
}
