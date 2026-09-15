# Xplor User Scripts

## Overview
Make your day a little easier. Once you have Violentmonkey installed, click on the links below to load an "Install" page for each user script.

## Requirements
Get the Violentmonkey userscript manager here: https://violentmonkey.github.io/get-it/
**Firefox is strongly recommended** due to its continued support for Manifest V2. Your mileage may vary with Chromium-based browsers other than Google Chrome.

## Scripts

### [Automatic override toggle](//github.com/attn-xplor/userscripts/raw/refs/heads/trunk/auto-overrides.user.js)
Automatically turns on Single Spa for any MFEs you are actively running locally. Uses the cached import map and checks if something is running on that port. Useful most of the time except for A-B testing, but that is why you can toggle it on/off in the first place.

### Module Federation Overrides (deprecated)
The Native Federation counterpart to the Single SPA script above. `merchant-host-ui`
reads `MOD_FED_APPLICATION_OVERRIDES` from `localStorage` to decide which remotes
to pull from a local dev server, but the key starts out empty, so pointing an MFE
at localhost normally means writing the JSON by hand.

This script fills in a disabled entry for every MFE, each already pointed at that
repo's `ng serve` port (`user-support` is seeded with a blank URL until its local
port is confirmed):

| MFE | Local remote entry |
| --- | --- |
| `merchant-main-ui` | `http://localhost:4201/ui/main/remoteEntry.json` |
| `merchant-terminal-ui` | `http://localhost:4202/remoteEntry.json` |
| `merchant-notifications-ui` | `http://localhost:4305/remoteEntry.json` |
| `user-support` | _(blank)_ |

Entries that already look right are left alone, so a hand-edited URL or an enabled
remote survives. Extra entries you add in the editor (or by hand) still show up
and can be removed later.

This utility is now the **NF** tab in the Merchant Portal Debug Overlay.
Use **Add** to register another remote by name and URL. Saving offers to reload,
because the host reads the key during pre-bootstrap: a change only takes effect
on the next page load. The first run seeds silently with all entries disabled.

Overrides work best against `localhost:4200`. On an HTTPS host the browser may
block `http://localhost` remotes as mixed content, so the editor warns when you
enable one there.

### [Config Patch](//github.com/attn-xplor/userscripts/raw/refs/heads/trunk/config-patch.user.js)
Much like Network Overrides (supported by Chrome and Firefox), this script allows you overwrite properties within MerchantWebApplicationClientConfig. However, this user script does so as a *patch* - meaning you only have to specify properties you need overwritten. 

Cleaner than having to look through the entire config.

#### Usage
On any `*.clearent.net` subdomain, Violentmonkey's extension menu will have an `Edit patch data` menu item under the `Config Patch` heading.
This opens a modal where you can edit a JSON document that serves as the "patch".

The userscript will *merge* your patch with the main config: properties from the patch will replace values in the normal config when both are present.
(Sub-objects get merged recursively.)

### Okta Utilities (deprecated)
This utility is now the **Okta** tab in the Merchant Portal Debug Overlay.

### Cache Utilities (deprecated)
These utilities are now the **Cache** tab in the Merchant Portal Debug Overlay.

### HNK Utilities (deprecated)
These utilities are now the **Merchant** tab in the Merchant Portal Debug Overlay.

### [Jira](//github.com/attn-xplor/userscripts/raw/refs/heads/trunk/jira.user.js)
Copies the ticket number (e.g., ITSM-12345) and url as a markdown-friendly link to your clipboard. 
This is useful for our Merchant Portal MFE Pull Request templates.

### [Merchant Portal Debug Overlay](//github.com/attn-xplor/userscripts/raw/refs/heads/trunk/mp-debug-overlay.user.js)
A developer overlay for Merchant Portal (`localhost:4200` and
`*.clearent.net`). Its expanded view is tabbed:

- **Terminal** — selected terminal, expandable terminal list, token timers,
  ACH/RPS capability indicators, and legacy-cache match checks.
- **Merchant** — the selected merchant's DBA, HNK, and the combined display
  string, each with a copy button, followed by cached frontend feature
  availability in a ten-row scrolling list.
- **Okta** — the current bearer token, shortened to the issuer row's length,
  copied in full, and refreshed after silent renewal. Full-screen mode displays
  the complete token. Decoded JWT details include a live expiry countdown,
  issued time, user, subject, issuer, audience, and scopes when available.
- **Cache** — collapsed `localStorage` and `sessionStorage` views with
  grouped, syntax-coloured JSON. Every value has adjacent copy and inline edit
  controls for primitive fields, while objects and arrays can be folded and
  copied as a unit. Cache-entry timestamps (`updatedAt`, `iat`, `exp`,
  `expires_at`, `expirationDate`, and the like) receive live-updating blue
  relative-time annotations; payload dates such as `createdDate` are left
  alone. Cache clearing and the local exclusions editor are included.
- **NF** — enables, edits, adds, and removes Native Federation overrides,
  with the same validation and reload prompt as the deprecated standalone tool.
  Local URLs receive an informational server-status probe; a stopped server
  does not prevent saving.

#### Usage
Drag the overlay to move it. Clicking the collapsed overlay cycles views:
**compact** (`E` expiry / `S` stale countdowns) and **detail** (terminal name,
expiry, stale, and cache age) are single-line pills, and **panel** is the
tabbed view above. Only the panel has tabs; its `⇲⇱` button collapses back to
the compact pill, and the `⛶` button beside it fills the window (24px gutters)
so long cache values have room. Full screen is per-session rather than
remembered, and dragging is disabled while it is on. The `− AA +` control next
to them scales the overlay text between 9px and 20px.

Within a tab, labels and values share columns so values line up down the
panel, and countdowns are zero-padded to keep the colon in place. The Merchant
features list keeps its checkmarks hugging each feature name instead.

Position, selected tab, view mode, and text size are remembered in
`localStorage`. The
status dot turns amber under two minutes remaining and red once expired. Long
values are truncated with `...` on screen, while copy buttons always place the
full value on the clipboard.

### [ngDevMode Patch](//github.com/attn-xplor/userscripts/raw/refs/heads/trunk/ng-dev-mode-patch.user.js)
Works around `ReferenceError: ngDevMode is not defined` when running MFEs under
Native Federation. Angular's compiler emits bare `ngDevMode` references (for
`signal()`, `input()`, `computed()`, and various dev-mode assertions), but
Native Federation's dev builds don't always hand esbuild a `define` for it, so
a remote chunk that evaluates one of those references first blows up on load.

The script defines `window.ngDevMode` as an empty object at `document-start`,
before any application code runs, which is what Angular itself does in a normal
dev build. It uses `??=`, so it leaves an already-defined value alone.

Only needed until the Native Federation version we're on ships the fix
([module-federation-plugin#1089](https://github.com/angular-architects/module-federation-plugin/pull/1089)).