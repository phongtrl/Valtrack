/* Personal offers: local Windows companion only. No tokens or offers persisted. */
let personalPairing = "";
let personalSnapshot = null;
let personalRequest = null;

function renderPersonalStore() {
  const connected = !!personalSnapshot;
  $("personal-connect-form").hidden = connected;
  $("personal-connected").hidden = !connected;
  const grid = $("personal-offers");
  grid.replaceChildren();
  const expiry = $("personal-expiry");
  expiry.textContent = "";
  delete expiry.dataset.shopExpires;
  if (!connected) return;
  $("personal-account").textContent = `Riot Client account: ${personalSnapshot.account}`;
  $("personal-fetched").textContent = `Snapshot from ${new Date(personalSnapshot.fetchedAt).toLocaleString()}. This is the account signed into Riot Client, independent of the profile tracked above.`;
  expiry.dataset.shopExpires = String(Date.parse(personalSnapshot.expiresAt));
  personalSnapshot.offers.forEach((offer) => {
    const tile = el("article", "shop-item");
    const picture = shopImage(offer.image, "", "shop-item-image");
    if (picture) tile.append(picture);
    tile.append(el("strong", "shop-item-name", offer.name), el("span", "shop-item-price", shopPrice(offer.price)));
    grid.append(tile);
  });
  if (!personalSnapshot.offers.length) grid.append(el("p", "empty", "Riot returned no personal daily offers."));
  updateShopCountdowns();
}

async function connectPersonalStore(event) {
  event?.preventDefault();
  if (personalRequest) return;
  const pairing = personalPairing || $("personal-pairing").value.trim();
  const status = $("personal-status");
  status.className = "hint";
  if (!/^[0-9a-f]{64}$/.test(pairing)) {
    status.className = "error";
    status.textContent = "Paste the pairing code from the Windows companion window. Do not enter your Riot password or API key.";
    return;
  }
  const controller = new AbortController();
  personalRequest = controller;
  const timeout = setTimeout(() => controller.abort(), 60000);
  const refresh = $("personal-refresh");
  refresh.classList.add("is-loading");
  refresh.disabled = true;
  refresh.setAttribute("aria-busy", "true");
  $("personal-connect").disabled = true;
  $("personal-shard").disabled = true;
  status.textContent = "Connecting to the companion on this PC… Allow local network access if your browser asks.";
  try {
    const response = await fetch("http://127.0.0.1:8766/store", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Valtrack-Pairing": pairing },
      body: JSON.stringify({ shard: $("personal-shard").value }),
      cache: "no-store",
      credentials: "omit",
      redirect: "error",
      signal: controller.signal
    });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data?.error === "string" ? data.error : "The companion could not read your store.");
    if (typeof data.account !== "string" || !Array.isArray(data.offers) || data.offers.length > 4
      || !Number.isFinite(data.fetchedAt) || !Number.isFinite(Date.parse(data.expiresAt))
      || data.offers.some((o) => !o || typeof o.name !== "string" || !(o.price === null || (Number.isFinite(o.price) && o.price >= 0)))) {
      throw new Error("Unexpected companion response. Update your Windows companion and retry.");
    }
    if (personalRequest !== controller) return;
    personalPairing = pairing;
    personalSnapshot = data;
    $("personal-pairing").value = "";
    renderPersonalStore();
    status.textContent = "Connected privately. Keep the companion and VALORANT open. Personal offers are held only in this page.";
  } catch (error) {
    if (personalRequest !== controller) return;
    status.className = "error";
    status.textContent = error.name === "TypeError" || error.name === "AbortError"
      ? "Could not reach the companion. Keep its window open, allow local network access for Valtrack, and retry on the same PC."
      : error.message;
    if (personalSnapshot) status.textContent += " Showing the previous snapshot; offers may have changed.";
  } finally {
    clearTimeout(timeout);
    if (personalRequest === controller) {
      personalRequest = null;
      refresh.classList.remove("is-loading");
      refresh.disabled = false;
      refresh.setAttribute("aria-busy", "false");
      $("personal-connect").disabled = false;
      $("personal-shard").disabled = false;
    }
  }
}

function disconnectPersonalStore() {
  const request = personalRequest;
  personalRequest = null;
  request?.abort();
  personalPairing = "";
  personalSnapshot = null;
  $("personal-pairing").value = "";
  $("personal-connect").disabled = false;
  $("personal-shard").disabled = false;
  $("personal-refresh").disabled = false;
  $("personal-refresh").classList.remove("is-loading");
  $("personal-refresh").setAttribute("aria-busy", "false");
  renderPersonalStore();
  $("personal-status").className = "hint";
  $("personal-status").textContent = "Disconnected. Close the companion window to invalidate its pairing code.";
}

document.getElementById("personal-connect-form").addEventListener("submit", connectPersonalStore);
document.getElementById("personal-refresh").addEventListener("click", () => connectPersonalStore());
document.getElementById("personal-disconnect").addEventListener("click", disconnectPersonalStore);
