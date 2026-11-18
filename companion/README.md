# Valtrack private store companion for Windows

This is an experimental, read-only companion using unofficial Riot Client endpoints. A real Windows/Riot session is required to confirm it works on your PC; browser and fixture tests cannot establish live Riot compatibility.

## Setup

1. Install Python 3.10 or newer from https://www.python.org/downloads/windows/ if it is not installed already. Include Tcl/Tk support in the installer. No extra packages are needed.
2. Download `valtrack-companion-windows-v1.1.0.zip`, right-click it and choose **Extract All**.
3. Sign into the official Riot Client and open VALORANT. Leave it open.
4. Double-click `start-companion.cmd` inside the extracted folder. Do not run it as administrator.
5. Open https://phongtrl.github.io/Valtrack/ on the **same PC**, select **Store**, and find **Personal daily offers**.
6. Choose the region of your signed-in Riot account. Brazil and Latin America use **Americas**.
7. Click **Copy code** in the companion, or press Ctrl+C in its code field. Paste the code into Valtrack and click **Connect**. This is a temporary helper code, not your Riot password or API key.
8. If Chrome or Edge asks for local network access, allow it for Valtrack. Browser support varies; no browser security settings need to be disabled.

The four daily offers belong to the account signed into Riot Client, regardless of the profile tracked in Valtrack. The connected account is labelled above the offers. Use the arrow next to it to refresh. New helper launches generate new pairing codes; page reloads require reconnecting. Disconnect clears personal data from the page; clicking **Stop companion** or closing its window stops the local service and invalidates the code.

## Privacy and connection boundaries

- Listens only at `http://127.0.0.1:8766`, never on your network interfaces.
- Requires both the exact Valtrack origin and a randomly generated 256-bit pairing code.
- Reads the Riot Client lockfile under your Windows LOCALAPPDATA folder only after an authenticated Connect/Refresh request.
- Riot session credentials are sent only to the local Riot Client and Riot's fixed HTTPS player-data host. Redirects are rejected. No token is sent to GitHub, Cloudflare, the item catalog, or your browser.
- Uses Riot’s read-only storefront lookup and has no purchase or account-edit functions.
- Item names, images and the client version come from the public valorant-api.com catalog, without Riot authentication headers.
- Holds display data in memory only. Does not save credentials, pairing codes or personal offers to disk. Valtrack holds the pairing code and personal offers in page memory only, outside match exports and local storage.
- The self-signed certificate exception is limited to Riot Client on `127.0.0.1`; remote HTTPS certificate validation remains enabled.

## Troubleshooting

- **Could not reach companion:** keep the helper window open, reconnect with its current code, and allow local network access when prompted. This connection is for the Windows PC running the helper; it does not connect your phone.
- **Riot Client not found / no active session:** sign into Riot Client and launch VALORANT.
- **Session rejected:** check the account region, then sign in again and retry. NA, BR and LATAM all use the Americas shard.
- **Pairing code incorrect:** restart the companion and use the new code.
- **Store response changed:** Riot's unofficial endpoints may have changed. Report the displayed error, never your pairing code or Riot tokens.

## Developer references

- https://valapidocs.techchrism.me/endpoint/entitlements-token
- https://valapidocs.techchrism.me/endpoint/storefront
- https://valapidocs.techchrism.me/endpoint/prices

Tests use fake credentials and fixtures only. Run `python -m unittest discover -s companion/tests` from the repository root.
