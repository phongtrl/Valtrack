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
  const toggle = el("button", "quiet small", marked ? "Remove bookmark" : "Bookmark this match");
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
  const location = kill?.location ?? kill?.victim_death_location ?? kill?.victim_location ?? kill?.victimLocation ?? kill?.victim?.location ?? kill?.victim?.death_location;
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
  section.open = true;
  section.append(el("summary", "", "Fight map"));
  const mine = match.details.players.findIndex(isMine);
  const points = [];
  match.timeline?.forEach((round, i) => {
    for (const [killer, victim, time, x, y] of round.k || []) {
      if (mine < 0 || (killer !== mine && victim !== mine) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
      points.push({ round: i, side: round.s, time, x, y, kind: victim === mine ? "Death" : "Kill" });
    }
  });
  if (!points.length) {
    section.append(loadMatchEl(match,
      match.mapLocationsSaved ? "No locations are saved. Refresh the match to check again." : "Locations aren’t saved for this match yet.",
      match.mapLocationsSaved ? "Refresh map data" : "Load map data"));
    return section;
  }

  const body = el("div", "kill-map-body");
  const status = el("p", "hint");
  status.setAttribute("role", "status");
  section.append(body, status);

  let loading = false;
  const load = async () => {
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
      const heat = el("canvas", "kill-heat");
      heat.width = heat.height = 240;
      heat.setAttribute("aria-hidden", "true");
      plot.append(image, heat);
      const controls = el("div", "map-controls");
      const select = (label, options) => {
        const field = el("label", "", label);
        const input = el("select");
        for (const [value, text] of options) {
          const option = el("option", "", text);
          option.value = value;
          input.append(option);
        }
        field.append(input);
        controls.append(field);
        return input;
      };
      const eventType = select("Events", [["", "All fights"], ["Kill", "Kills"], ["Death", "Deaths"]]);
      const side = select("Side", [["", "Both sides"], ["A", "Attack"], ["D", "Defence"]]);
      const view = select("View", [["density", "Density + markers"], ["events", "Markers only"], ["heat", "Density only"]]);
      const preview = el("div", "map-preview");
      const previewText = el("span", "", "Select a marker to preview its round.");
      previewText.setAttribute("role", "status");
      const jump = el("button", "quiet small", "Open round");
      jump.type = "button";
      jump.hidden = true;
      preview.append(previewText, jump);
      let selectedRound;
      jump.addEventListener("click", () => {
        const round = timeline.querySelectorAll(".tl-round")[selectedRound];
        round?.click();
        round?.focus({ preventScroll: true });
        round?.scrollIntoView({ block: "nearest", inline: "nearest" });
      });
      const redraw = () => {
        plot.querySelectorAll("button").forEach((button) => button.remove());
        const visible = [];
        heat.hidden = view.value === "events";
        jump.hidden = true;
        previewText.textContent = view.value === "heat" ? "Switch to markers to inspect a round." : "Select a marker to preview its round.";
        for (const point of points) {
          if (side.value && point.side !== side.value || eventType.value && point.kind !== eventType.value) continue;
          const left = point.y * map.xMultiplier + map.xScalarToAdd;
          const top = point.x * map.yMultiplier + map.yScalarToAdd;
          if (left < 0 || left > 1 || top < 0 || top > 1) continue;
          visible.push([left, top, point.kind]);
          if (view.value === "heat") continue;
          const marker = el("button", "kill-marker " + point.kind.toLowerCase(), point.kind === "Kill" ? "+" : "×");
          marker.type = "button";
          marker.style.left = left * 100 + "%";
          marker.style.top = top * 100 + "%";
          marker.title = marker.ariaLabel = `${point.kind}, round ${point.round + 1}, ${clock(point.time)}`;
          marker.addEventListener("click", () => {
            plot.querySelector(".is-selected")?.classList.remove("is-selected");
            marker.classList.add("is-selected");
            selectedRound = point.round;
            const result = match.timeline[point.round].w ? "won" : "lost";
            previewText.textContent = `${point.kind} · Round ${point.round + 1} · ${clock(point.time)} · Round ${result}`;
            jump.hidden = !timeline.querySelectorAll(".tl-round")[selectedRound];
          });
          plot.append(marker);

        }
        if (!heat.hidden) drawKillHeat(heat, visible);
        const kills = visible.filter((point) => point[2] === "Kill").length;
        const deaths = visible.length - kills;
        status.textContent = visible.length ? `${kills} kills plotted · ${deaths} deaths plotted` : "No locations match these filters.";
        preview.hidden = !visible.length;
      };
      image.addEventListener("error", () => {
        plot.hidden = true;
        status.textContent = "Could not load the map image. Close and reopen to retry.";
        body.replaceChildren();
      });
      image.addEventListener("load", () => { plot.hidden = false; redraw(); });
      image.loading = "eager";
      for (const input of [eventType, side, view]) input.addEventListener("change", redraw);
      const legend = el("div", "map-legend");
      legend.append(el("span", "map-kills", "Kills"), el("span", "map-deaths", "Deaths"), el("span", "muted", "Brighter areas have more events"));
      body.append(controls, plot, legend, preview, el("p", "hint", "Locations mark where the victim fell."));
    } catch {
      status.textContent = "Could not load the map catalog. Close and reopen to retry.";
    } finally {
      loading = false;
    }
  };
  section.addEventListener("toggle", load);
  void load();
  return section;
}

function drawKillHeat(canvas, points) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const size = canvas.width;
  ctx.clearRect(0, 0, size, size);
  for (const [kind, color] of [["Kill", [65, 221, 182]], ["Death", [255, 117, 127]]]) {
    const layer = document.createElement("canvas");
    layer.width = layer.height = size;
    const ink = layer.getContext("2d");
    for (const [x, y, event] of points) {
      if (event !== kind) continue;
      const px = x * size;
      const py = y * size;
      const glow = ink.createRadialGradient(px, py, 0, px, py, 17);
      glow.addColorStop(0, "rgba(0,0,0,.36)");
      glow.addColorStop(.45, "rgba(0,0,0,.19)");
      glow.addColorStop(1, "transparent");
      ink.fillStyle = glow;
      ink.fillRect(px - 17, py - 17, 34, 34);
    }
    const image = ink.getImageData(0, 0, size, size);
    for (let i = 0; i < image.data.length; i += 4) {
      const density = image.data[i + 3] / 255;
      for (let channel = 0; channel < 3; channel++) {
        image.data[i + channel] = color[channel] + (255 - color[channel]) * density * .42;
      }
      image.data[i + 3] = Math.round(density * 210);
    }
    ink.putImageData(image, 0, 0);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(layer, 0, 0);
  }
  ctx.globalCompositeOperation = "source-over";
}
