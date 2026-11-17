/* Featured store. Personal offers need a separate private Riot connection. */
const KEY_SHOP = "vt:featured-store";
const SHOP_FRESH = 30 * 60e3;
let shopSnapshot = null;
let shopLoading = false;
let shopTimer = null;

function validShopSnapshot(value) {
  return value && Number.isFinite(value.fetchedAt) && Array.isArray(value.bundles)
    && value.bundles.every((b) => b && typeof b.bundle_uuid === "string" && Array.isArray(b.items));
}

function readShop() {
  if (shopSnapshot) return;
  try {
    const saved = JSON.parse(store.get(KEY_SHOP) || "null");
    if (validShopSnapshot(saved)) shopSnapshot = saved;
  } catch (_) { /* ignore invalid saved data */ }
}

function shopImage(url, alt, className) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "media.valorant-api.com") return null;
    const img = el("img", className);
    img.src = parsed.href;
    img.alt = alt;
    img.loading = "lazy";
    img.addEventListener("error", () => img.remove(), { once: true });
    return img;
  } catch (_) { return null; }
}

function shopPrice(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? `${value.toLocaleString()} VP` : "Price unavailable";
}

function shopExpiry(bundle) {
  const expiry = Date.parse(bundle.expires_at);
  return Number.isFinite(expiry) ? expiry : null;
}

function updateShopCountdowns() {
  document.querySelectorAll("[data-shop-expires]").forEach((node) => {
    const remaining = Number(node.dataset.shopExpires) - Date.now();
    if (remaining <= 0) {
      node.textContent = "Rotation ended · refresh store";
      return;
    }
    const minutes = Math.ceil(remaining / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor(minutes % 1440 / 60);
    node.textContent = `Ends in ${days ? days + "d " : ""}${hours}h ${minutes % 60}m`;
  });
}

function renderShop() {
  const box = $("store-bundles");
  box.replaceChildren();
  if (!shopSnapshot) return;
  if (!shopSnapshot.bundles.length) box.append(el("p", "empty", "No featured bundles are available right now."));
  shopSnapshot.bundles.forEach((bundle) => {
    const card = el("article", "card shop-bundle");
    const image = shopImage(bundle.image, "", "shop-banner");
    if (image) card.append(image);
    const content = el("div", "shop-content");
    const head = el("div", "section-head shop-bundle-head");
    head.append(el("h3", "", bundle.name || "Featured bundle"), el("strong", "shop-price", shopPrice(bundle.bundle_price)));
    content.append(head);
    const expiry = shopExpiry(bundle);
    if (expiry !== null) {
      const clock = el("p", "hint shop-expiry");
      clock.dataset.shopExpires = String(expiry);
      clock.title = `Ends ${new Date(expiry).toLocaleString()}`;
      content.append(clock);
    } else content.append(el("p", "hint", "Expiry unavailable"));
    if (bundle.whole_sale_only) content.append(el("p", "hint", "Sold as a complete bundle only."));
    const grid = el("div", "shop-items");
    bundle.items.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const tile = el("div", "shop-item");
      const picture = shopImage(item.image, "", "shop-item-image");
      if (picture) tile.append(picture);
      tile.append(el("strong", "shop-item-name", item.name || "Store item"));
      const price = el("div", "shop-item-price");
      const cost = item.discounted_price ?? item.base_price;
      if (typeof cost === "number" && typeof item.base_price === "number" && cost < item.base_price) {
        price.append(el("s", "muted", shopPrice(item.base_price)), document.createTextNode(" "));
      }
      price.append(el("span", "", cost === 0 ? "Included with bundle" : shopPrice(cost)));
      tile.append(price);
      if (Number(item.amount) > 1) tile.append(el("small", "muted", `Quantity: ${item.amount}`));
      grid.append(tile);
    });
    content.append(grid);
    card.append(content);
    box.append(card);
  });
  $("store-updated").textContent = `Snapshot from ${new Date(shopSnapshot.fetchedAt).toLocaleString()}. Prices in Valorant Points; confirm availability in game.`;
  updateShopCountdowns();
}

async function loadShop(force = false) {
  if (shopLoading) return;
  readShop();
  renderShop();
  const age = shopSnapshot ? Date.now() - shopSnapshot.fetchedAt : Infinity;
  const expired = shopSnapshot?.bundles.some((b) => shopExpiry(b) !== null && shopExpiry(b) <= Date.now());
  if (!force && shopSnapshot && age < SHOP_FRESH && !expired) {
    $("store-status").className = "hint";
    $("store-status").textContent = "Showing your saved store snapshot. Refresh to check for changes.";
    return;
  }
  if (force && age < 60000) {
    $("store-status").textContent = "Store was just updated. You can refresh again in a minute.";
    return;
  }
  shopLoading = true;
  const button = $("store-refresh");
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  const status = $("store-status");
  status.className = "hint";
  status.textContent = "Loading featured bundles…";
  try {
    const json = await api("/valorant/v2/store-featured");
    if (!Array.isArray(json?.data)) throw new Error("The store returned an unexpected response. Try again later.");
    const fetchedAt = Date.now();
    const bundles = await Promise.all(json.data.map(async (bundle) => {
      if (!bundle || typeof bundle.bundle_uuid !== "string" || !Array.isArray(bundle.items)) throw new Error("Store bundle data is incomplete.");
      let meta = null;
      try {
        const response = await fetch(`https://valorant-api.com/v1/bundles/${encodeURIComponent(bundle.bundle_uuid)}`);
        if (response.ok) meta = (await response.json()).data;
      } catch (_) { /* prices and items still work without bundle artwork */ }
      const expiry = Date.parse(bundle.expires_at);
      return {
        ...bundle,
        name: typeof meta?.displayName === "string" ? meta.displayName : "Featured bundle",
        image: meta?.displayIcon || null,
        expires_at: Number.isFinite(expiry) ? new Date(expiry).toISOString()
          : typeof bundle.seconds_remaining === "number" && bundle.seconds_remaining >= 0
            ? new Date(fetchedAt + bundle.seconds_remaining * 1000).toISOString() : null
      };
    }));
    shopSnapshot = { fetchedAt, bundles };
    store.set(KEY_SHOP, JSON.stringify(shopSnapshot));
    renderShop();
    status.textContent = "Featured store updated.";
  } catch (error) {
    status.className = "error";
    status.textContent = `${error.message || "Could not load the store."}${shopSnapshot ? " Showing a saved snapshot; offers may have changed." : " Press Refresh store to retry."}`;
  } finally {
    shopLoading = false;
    button.disabled = false;
    button.setAttribute("aria-busy", "false");
  }
}

function onStoreTab() {
  if (shopTimer) clearInterval(shopTimer);
  shopTimer = setInterval(updateShopCountdowns, 60000);
  void loadShop();
}

document.getElementById("store-refresh").addEventListener("click", () => loadShop(true));
