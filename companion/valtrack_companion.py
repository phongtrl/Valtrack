"""Private, read-only Riot Client store bridge. Python 3.10+, standard library only."""
import base64
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import secrets
import ssl
import threading
import time
import urllib.error
import urllib.request
import uuid

ORIGIN = "https://phongtrl.github.io"
PORT = 8766
VERSION = "1.1.0"
VP = "85ad13f7-3d1b-5128-9eb2-7cd8a7c127b7"
SHARDS = {"eu", "na", "ap", "kr", "pbe"}


class CompanionError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None  # Never forward Riot credentials to a redirect destination.


def request_json(url, headers=None, local=False, *, body=None):
    handlers = [NoRedirect()]
    if local:
        # Riot Client serves a self-signed certificate on loopback only.
        if not re.fullmatch(r"https://127\.0\.0\.1:\d+/[a-z0-9/-]+", url):
            raise CompanionError("Invalid local Riot endpoint.")
        handlers += [urllib.request.ProxyHandler({}),
                     urllib.request.HTTPSHandler(context=ssl._create_unverified_context())]
    opener = urllib.request.build_opener(*handlers)
    req = urllib.request.Request(url, headers=headers or {}, data=body, method="POST" if body is not None else "GET")
    try:
        with opener.open(req, timeout=10) as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code in (401, 403):
            stage = "Riot Client session" if local else "Riot storefront" if "/storefront/" in url else "Store data provider"
            raise CompanionError(f"{stage} rejected the request (HTTP {error.code}).", 401) from None
        if error.code == 429:
            raise CompanionError("Riot asked us to slow down. Wait a minute and retry.", 429) from None
        raise CompanionError("Riot or the item catalog is unavailable. Try again later.") from None
    except (OSError, ValueError):
        raise CompanionError("Could not reach Riot Client or the store. Keep VALORANT open and check your connection.") from None


def local_session():
    folder = os.environ.get("LOCALAPPDATA")
    if not folder:
        raise CompanionError("Run this companion on your Windows gaming PC.", 409)
    try:
        text = (Path(folder) / "Riot Games/Riot Client/Config/lockfile").read_text(encoding="utf-8")
        _, _, port, password, protocol = text.strip().split(":")
        if protocol != "https" or not 1 <= int(port) <= 65535 or not password:
            raise ValueError()
    except (OSError, ValueError):
        raise CompanionError("Riot Client was not found. Sign in and open VALORANT, then retry.", 409) from None
    authorization = "Basic " + base64.b64encode(("riot:" + password).encode()).decode()
    base = "https://127.0.0.1:" + port
    headers = {"Authorization": authorization}
    session = request_json(base + "/entitlements/v1/token", headers, local=True)
    try:
        subject = str(uuid.UUID(session["subject"]))
        access = session["accessToken"]
        entitlement = session["token"]
        if not isinstance(access, str) or not access or not isinstance(entitlement, str) or not entitlement:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise CompanionError("Riot Client has no active session. Sign in and open VALORANT.", 409) from None
    account_name = "Signed-in Riot Client account"
    try:
        alias = request_json(base + "/player-account/aliases/v1/active", headers, local=True)
        name = alias.get("game_name") or alias.get("gameName")
        tag = alias.get("tag_line") or alias.get("tagLine")
        if name and tag:
            account_name = str(name) + "#" + str(tag)
    except CompanionError:
        pass
    return subject, access, entitlement, account_name


def skin_metadata(item_id):
    try:
        data = request_json("https://valorant-api.com/v1/weapons/skinlevels/" + str(uuid.UUID(item_id)))["data"]
        return {"name": data.get("displayName") or "Weapon skin", "image": data.get("displayIcon")}
    except (CompanionError, KeyError, TypeError, ValueError):
        return {"name": "Weapon skin", "image": None}


def daily_offers(storefront, prices=None):
    panel = storefront.get("SkinsPanelLayout")
    if not isinstance(panel, dict):
        raise CompanionError("Riot's store response changed. The companion needs an update.")
    offers = panel.get("SingleItemStoreOffers")
    if not isinstance(offers, list):
        ids = panel.get("SingleItemOffers")
        if not isinstance(ids, list):
            raise CompanionError("Riot did not return daily offers.")
        by_id = {p.get("OfferID"): p for p in (prices or {}).get("Offers", [])}
        offers = [by_id.get(item_id, {"OfferID": item_id}) for item_id in ids]
    result = []
    for offer in offers[:4]:
        if not isinstance(offer, dict):
            raise CompanionError("Riot returned an invalid daily offer.")
        rewards = offer.get("Rewards") or []
        item_id = rewards[0].get("ItemID") if rewards and isinstance(rewards[0], dict) else offer.get("OfferID")
        try:
            item_id = str(uuid.UUID(item_id))
        except (ValueError, TypeError, AttributeError):
            raise CompanionError("Riot returned an invalid skin ID.") from None
        price = (offer.get("Cost") or {}).get(VP)
        if type(price) not in (int, float) or price < 0:
            price = None
        result.append({"id": item_id, "price": price})
    seconds = panel.get("SingleItemOffersRemainingDurationInSeconds")
    if type(seconds) not in (int, float) or not 0 <= seconds <= 7 * 86400:
        raise CompanionError("Riot did not return a valid daily store expiry.")
    return result, seconds


class RiotStore:
    def __init__(self):
        self.cache = None
        self.lock = threading.Lock()

    def read(self, shard):
        if shard not in SHARDS:
            raise CompanionError("Choose a valid store region.", 400)
        with self.lock:
            subject, access, entitlement, account_name = local_session()
            if self.cache and self.cache[0] == (subject, shard) and time.monotonic() - self.cache[1] < 60:
                return self.cache[2]
            version = request_json("https://valorant-api.com/v1/version").get("data", {}).get("riotClientVersion")
            if not isinstance(version, str) or not version:
                raise CompanionError("Could not determine the current VALORANT version.")
            platform = {"platformType": "PC", "platformOS": "Windows", "platformOSVersion": "10.0.19042.1.256.64bit", "platformChipset": "Unknown"}
            headers = {"Authorization": "Bearer " + access, "X-Riot-Entitlements-JWT": entitlement,
                       "X-Riot-ClientVersion": version,
                       "X-Riot-ClientPlatform": base64.b64encode(json.dumps(platform).encode()).decode()}
            base = "https://pd." + shard + ".a.pvp.net"
            storefront = request_json(base + "/store/v3/storefront/" + subject, {**headers, "Content-Type": "application/json"}, body=b"{}")
            prices = None
            if not isinstance(storefront.get("SkinsPanelLayout", {}).get("SingleItemStoreOffers"), list):
                prices = request_json(base + "/store/v1/offers/", headers)
            offers, seconds = daily_offers(storefront, prices)
            fetched = time.time()
            with ThreadPoolExecutor(max_workers=4) as pool:
                metadata = list(pool.map(skin_metadata, [o["id"] for o in offers]))
            for offer, meta in zip(offers, metadata):
                offer.update(meta)
            # Return only display data. No subject UUID, local password or Riot tokens.
            result = {"account": account_name, "shard": shard, "offers": offers,
                      "fetchedAt": int(fetched * 1000),
                      "expiresAt": datetime.fromtimestamp(fetched + seconds, timezone.utc).isoformat()}
            self.cache = ((subject, shard), time.monotonic(), result)
            return result


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # Never log requests, pairing headers or upstream errors.

    def setup(self):
        super().setup()
        self.connection.settimeout(15)

    def allowed(self):
        return (self.headers.get("Host") == "127.0.0.1:" + str(self.server.server_port)
                and self.headers.get("Origin") == ORIGIN)

    def respond(self, status, data=None):
        try:
            self.write_response(status, data)
        except (BrokenPipeError, ConnectionResetError, TimeoutError):
            pass  # The page disconnected or cancelled the request.

    def write_response(self, status, data=None):
        body = json.dumps(data).encode() if data is not None else b""
        self.send_response(status)
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if self.allowed():
            self.send_header("Access-Control-Allow-Origin", ORIGIN)
            self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Valtrack-Pairing")
            self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("Vary", "Origin")
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        self.respond(204 if self.allowed() and self.path == "/store" else 403)

    def do_GET(self):
        self.respond(405, {"error": "Use Valtrack's Connect button."})

    def do_POST(self):
        if not self.allowed():
            self.respond(403, {"error": "This companion accepts requests only from Valtrack."})
            return
        token = self.headers.get("X-Valtrack-Pairing", "")
        if not re.fullmatch(r"[0-9a-f]{64}", token) or not secrets.compare_digest(token, self.server.pairing):
            self.respond(403, {"error": "Pairing code is incorrect or expired. Copy the current code from the companion window."})
            return
        if self.path != "/store":
            self.respond(404, {"error": "Unknown endpoint."})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1024 or self.headers.get_content_type() != "application/json":
                raise ValueError()
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict) or payload.get("shard") not in SHARDS:
                raise ValueError()
        except (ValueError, TypeError):
            self.respond(400, {"error": "Choose a valid store region."})
            return
        try:
            self.respond(200, self.server.riot_store.read(payload["shard"]))
        except CompanionError as error:
            self.respond(error.status, {"error": str(error)})
        except Exception:
            self.respond(502, {"error": "The companion could not read the store. Keep VALORANT open and try again."})


def main():
    if os.name != "nt":
        print("Run this companion on your Windows gaming PC.")
        return 1
    import tkinter as tk
    from tkinter import messagebox, ttk

    root = tk.Tk()
    root.title(f"Valtrack personal store · v{VERSION}")
    try:
        server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    except OSError:
        messagebox.showerror("Valtrack", "Port 8766 is unavailable. Close the other companion and retry.", parent=root)
        root.destroy()
        return 1

    server.pairing = secrets.token_hex(32)
    server.riot_store = RiotStore()
    panel = ttk.Frame(root, padding=20)
    panel.pack(fill="both", expand=True)
    ttk.Label(panel, text="Pair Valtrack on this PC").pack(anchor="w")
    ttk.Label(panel, text="Keep VALORANT open. Paste the code in Store → Personal daily offers.").pack(anchor="w", pady=(4, 12))
    code = tk.StringVar(value=server.pairing)
    entry = ttk.Entry(panel, textvariable=code, state="readonly", width=68)
    entry.pack(fill="x")
    status = tk.StringVar()

    def copy_code(event=None):
        root.clipboard_clear()
        root.clipboard_append(server.pairing)
        status.set("Code copied. Paste it into Valtrack and click Connect.")
        return "break"

    entry.bind("<Control-c>", copy_code)
    buttons = ttk.Frame(panel)
    buttons.pack(fill="x", pady=(12, 0))
    ttk.Button(buttons, text="Copy code", command=copy_code).pack(side="left")
    ttk.Button(buttons, text="Stop companion", command=root.destroy).pack(side="right")
    ttk.Label(panel, textvariable=status).pack(anchor="w", pady=(8, 0))
    entry.focus_set()
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        root.mainloop()
    finally:
        server.shutdown()
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
