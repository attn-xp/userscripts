// ==UserScript==
// @name         Merchant Portal Debug Overlay
// @namespace    https://github.com/attn-xplor/userscripts
// @version      2.1.1
// @description  Tabbed Merchant Portal tools for terminals, merchants, Okta, caches, and module federation overrides. Fully vibe-coded.
// @author       Ismael J Lopez
// @match        http://localhost:4200/ui/*
// @match        https://*.clearent.net/ui/*
// @run-at       document-idle
// @connect      localhost
// @connect      127.0.0.1
// @grant        GM.getValue
// @grant        GM.setClipboard
// @grant        GM.setValue
// @grant        GM.xmlHttpRequest
// ==/UserScript==
(function () {
  "use strict";

  // The Angular Query cache marks the terminals payload stale after 10 minutes,
  // and the VT tokens inside it are good for 20. See QuestJwtService.terminals.
  const STALE_MS = 10 * 60 * 1000;
  const EXPIRES_MS = 20 * 60 * 1000;
  const TICK_MS = 1000;

  const TERMINALS_KEY_PATTERN = /^xplor\.(\d+)\.quest-jwt\.terminals$/;
  const SELECTED_KEY = (hnk) => `xplor.${hnk}.quest-jwt.selected.terminal`;

  // Legacy caches, still written alongside the newer `xplor.*` entries by
  // QuestJwtService. Both services keep every item in one array under one key.
  const LEGACY_SESSION_KEY = "CACHED_STORAGE_SERVICE_DATA";
  const LEGACY_LOCAL_KEY = "CACHED_LOCAL_STORAGE_SERVICE_DATA";
  const LEGACY_TERMINALS_ITEM = "QUEST_MERCHANTS_DATA";
  const LEGACY_SELECTED_ITEM = "selectedQuestTerminal";
  const LEGACY_FEATURES_ITEM = "FEATURE_PERMISSION_DATA";
  const LEGACY_ACH_ITEM = "CACHED_ACH_SETTINGS";
  const LEGACY_MERCHANT_TERMINALS_ITEM = "MERCHANT-TERMINALS";
  const LEGACY_MERCHANT_TERMINAL_SELECTED_ITEM = "QUEST_TERMINAL_SELECTED";
  const featuresKey = (hnk) => `xplor.${hnk}.features`;
  const achProvidersKey = (hnk) => `xplor.${hnk}.ach.providers`;

  const POS_KEY = "xplor.debug.overlay.position";
  const MODE_KEY = "xplor.debug.overlay.mode";
  const TAB_KEY = "xplor.debug.overlay.tab";
  const FONT_KEY = "xplor.debug.overlay.font";
  const FONT_DEFAULT_PX = 12;
  const FONT_MIN_PX = 9;
  const FONT_MAX_PX = 20;
  const MODES = ["compact", "detail", "panel"];
  const TABS = ["Terminal", "Merchant", "Okta", "Cache", "NF"];
  const LEGACY_TAB_NAMES = {
    "Virtual Terminal": "Terminal",
    HNK: "Merchant",
    "Mod Fed": "NF",
  };
  const DRAG_THRESHOLD_PX = 4;
  const TERMINAL_LIST_MAX_HEIGHT_PX = 180;
  const STORAGE_LIST_MAX_HEIGHT_PX = 240;
  const EXPANDED_GUTTER_PX = 24;
  const VALUE_MAX_CHARS = 64;
  const OKTA_TOKEN_MAX_CHARS = 20;
  const PREVIEW_MAX_CHARS = 42;
  const LOG_TO_CONSOLE = false;

  // Keys that describe when a cache entry itself was written or expires.
  const ENTRY_TIMESTAMP_KEYS = new Set([
    "auth_time",
    "dataupdatedat",
    "errorupdatedat",
    "exp",
    "expirationdate",
    "expires_at",
    "expiresat",
    "iat",
    "nbf",
    "timestamp",
    "updatedat",
  ]);

  const CURRENT_MERCHANT_KEY = /^xplor\.(.+)\.current\.merchant$/;
  const merchantsKey = (user) => `xplor.${user}.merchants`;
  const LEGACY_SELECTED_MERCHANT = "selectedMerchant";
  const SEARCH_PLACEHOLDER = "Search by Business Name or Merchant ID";

  const CUSTOM_EXCLUSIONS_KEY = "CACHE_UTILS_EXCLUSIONS";
  const MOD_FED_OVERRIDES_KEY = "MOD_FED_APPLICATION_OVERRIDES";
  const LOCAL_REMOTES = {
    "merchant-main-ui":
      "http://localhost:4201/ui/main/remoteEntry.json",
    "merchant-terminal-ui": "http://localhost:4202/remoteEntry.json",
    "merchant-notifications-ui":
      "http://localhost:4305/remoteEntry.json",
    "user-support": "",
  };
  const DEFAULT_EXCLUSIONS = [
    "MOD_FED_APPLICATION_OVERRIDES",
    "TanstackQueryDevtools.open",
    "TanstackQueryDevtools.pip_open",
    "TanstackQueryDevtools.theme_preference",
    POS_KEY,
    MODE_KEY,
    TAB_KEY,
    FONT_KEY,
  ];

  const GREEN = "#7bdcb5";
  const AMBER = "#ffd166";
  const RED = "#ff6b6b";
  const GREY = "#8a8a94";
  const BLUE = "#8ab4ff";
  const JSON_KEY = "#9cdcfe";
  const JSON_STRING = "#ce9178";
  const JSON_NUMBER = "#b5cea8";
  const JSON_BOOLEAN = "#c586c0";
  const ORANGE = "#f2a65a";
  const CACHE_GROUPS = [
    { id: "modern", label: "Merchant Portal", color: BLUE },
    { id: "legacy", label: "Legacy", color: RED },
    { id: "application", label: "Other", color: GREEN },
    { id: "overlay", label: "Debug Overlay", color: ORANGE },
  ];

  function parseItem(storage, key) {
    const raw = storage.getItem(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      // A malformed entry is not worth blowing up the timer over.
      return null;
    }
  }

  // `xplor.<user>.current.merchant` holds the merchant number the portal is
  // scoped to, which is the `<hnk>` segment of every other `xplor.*` cache key.
  function currentMerchant() {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const match = CURRENT_MERCHANT_KEY.exec(key);
      if (!match) continue;
      const hnk = localStorage.getItem(key);
      if (hnk) return { user: match[1], hnk };
    }
    return null;
  }

  // Switching merchants leaves the previous merchant's terminals behind in
  // sessionStorage, so the key has to be chosen by hnk rather than by whichever
  // one is found first. Without a known merchant the newest entry is the best
  // guess; with one, a missing entry means there is nothing to show yet.
  function readTerminals() {
    const entries = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const match = TERMINALS_KEY_PATTERN.exec(key);
      if (!match) continue;
      const item = parseItem(sessionStorage, key);
      if (!Array.isArray(item?.response) || typeof item.updatedAt !== "number")
        continue;
      entries.push({
        hnk: match[1],
        updatedAt: item.updatedAt,
        list: item.response,
      });
    }
    if (entries.length === 0) return null;

    const hnk = currentMerchant()?.hnk;
    if (hnk) return entries.find((entry) => entry.hnk === hnk) ?? null;
    return entries.reduce((latest, entry) =>
      entry.updatedAt > latest.updatedAt ? entry : latest,
    );
  }

  // The selected terminal is cached separately, in localStorage, so it survives
  // a session restart. Its `response` is a snapshot that can lag behind the
  // freshly-fetched terminals array, so it is only used to look up an id.
  function findSelected(hnk, list) {
    const selected = parseItem(localStorage, SELECTED_KEY(hnk))?.response;
    const id = selected?.syntheticTerminalId;
    if (!id) return { terminal: list[0], reason: "no selection cached" };
    const terminal = list.find((t) => t.syntheticTerminalId === id);
    if (!terminal)
      return { terminal: list[0], reason: `selection ${id} not in list` };
    return { terminal, reason: null };
  }

  function legacyItem(storage, storageKey, itemName) {
    const all = parseItem(storage, storageKey);
    if (!Array.isArray(all)) return null;
    return all.find((entry) => entry?.itemName === itemName) ?? null;
  }

  function scopedLegacyItem(storage, storageKey, itemName, dataHash) {
    const all = parseItem(storage, storageKey);
    if (!Array.isArray(all)) return null;
    return (
      all.find(
        (entry) =>
          entry?.itemName === itemName &&
          String(entry.dataHash) === String(dataHash),
      ) ?? null
    );
  }

  // Legacy caches keep one entry per merchant in a single array, tagged with
  // `dataHash`, so an unscoped lookup can hand back a previous merchant's entry.
  // Older entries predate the tag, hence the unscoped fallback.
  function legacyItemFor(storage, storageKey, itemName, hnk) {
    return (
      scopedLegacyItem(storage, storageKey, itemName, hnk) ??
      legacyItem(storage, storageKey, itemName)
    );
  }

  function readFeatures(hnk) {
    const modern = parseItem(sessionStorage, featuresKey(hnk))?.response;
    if (Array.isArray(modern)) return modern;
    const legacy = legacyItemFor(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_FEATURES_ITEM,
      hnk,
    )?.dataObject;
    return Array.isArray(legacy) ? legacy : [];
  }

  function featureFingerprint(hnk) {
    return JSON.stringify(
      readFeatures(hnk).map(({ feature, isAvailable }) => ({
        feature,
        isAvailable,
      })),
    );
  }

  function readAchEnabled(hnk) {
    const modern = parseItem(sessionStorage, achProvidersKey(hnk))?.response;
    if (Array.isArray(modern))
      return modern.some((provider) => provider?.enabled === true);
    const legacy = legacyItemFor(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_ACH_ITEM,
      hnk,
    )?.dataObject?.payload?.["ach-providers"]?.["ach-provider"];
    return Array.isArray(legacy)
      ? legacy.some((provider) => provider?.enabled === true)
      : null;
  }

  function sameMerchantTerminal(left, right) {
    if (!left || !right) return false;
    return (
      (left.merchantTerminalId != null &&
        String(left.merchantTerminalId) === String(right.terminalPKId)) ||
      (left.syntheticTerminalId &&
        left.syntheticTerminalId === right.syntheticTerminalId)
    );
  }

  function readRpsEnabled(hnk, terminal) {
    const selected = scopedLegacyItem(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_MERCHANT_TERMINAL_SELECTED_ITEM,
      hnk,
    )?.dataObject;
    if (
      sameMerchantTerminal(selected, terminal) &&
      typeof selected.isRpsEnabled === "boolean"
    )
      return selected.isRpsEnabled;

    const terminals = scopedLegacyItem(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_MERCHANT_TERMINALS_ITEM,
      hnk,
    )?.dataObject;
    const match = Array.isArray(terminals)
      ? terminals.find((item) => sameMerchantTerminal(item, terminal))
      : null;
    return typeof match?.isRpsEnabled === "boolean"
      ? match.isRpsEnabled
      : null;
  }

  function terminalIds(list) {
    return (list ?? [])
      .map((t) => t?.syntheticTerminalId)
      .filter(Boolean)
      .sort()
      .join(",");
  }

  // Each legacy item is compared against its newer `xplor.*` counterpart, which
  // QuestJwtService writes at the same time, so divergence is visible per item.
  function checkLegacyTerminals(cache) {
    const item = legacyItemFor(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_TERMINALS_ITEM,
      cache.hnk,
    );
    if (!item?.dataObject) return { ok: false, detail: "missing" };

    const problems = [];
    if (item.dataHash !== cache.hnk)
      problems.push(`hnk ${item.dataHash ?? "none"}`);
    if (terminalIds(item.dataObject) !== terminalIds(cache.list))
      problems.push("ids differ");
    if (
      item.expirationDate &&
      new Date(item.expirationDate).getTime() < Date.now()
    )
      problems.push("expired");
    return { ok: problems.length === 0, detail: problems.join(", ") };
  }

  function checkLegacySelected(cache, selected) {
    const item = legacyItemFor(
      localStorage,
      LEGACY_LOCAL_KEY,
      LEGACY_SELECTED_ITEM,
      cache.hnk,
    );
    if (!item?.dataObject) return { ok: false, detail: "missing" };

    const id = item.dataObject.syntheticTerminalId;
    if (id !== selected?.syntheticTerminalId)
      return { ok: false, detail: `is ${id ?? "unknown"}` };
    return { ok: true, detail: "" };
  }

  const LEGACY_CHECKS = [
    {
      label: LEGACY_TERMINALS_ITEM,
      storage: "session",
      run: checkLegacyTerminals,
    },
    { label: LEGACY_SELECTED_ITEM, storage: "local", run: checkLegacySelected },
  ];

  function compareLegacy(cache, selected) {
    return LEGACY_CHECKS.map(({ label, storage, run }) => ({
      label,
      storage,
      ...run(cache, selected),
    }));
  }

  // Minutes are padded too so a column of countdowns lines up on the colon.
  function formatDuration(ms) {
    const negative = ms < 0;
    const total = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${negative ? "-" : ""}${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  function accentFor(remaining) {
    if (remaining <= 0) return RED;
    if (remaining <= 2 * 60 * 1000) return AMBER;
    return GREEN;
  }

  function collect() {
    const cache = readTerminals();
    if (!cache || cache.list.length === 0) return null;

    const { terminal, reason } = findSelected(cache.hnk, cache.list);
    const age = Date.now() - cache.updatedAt;
    return {
      cache,
      terminal,
      reason,
      age,
      untilStale: STALE_MS - age,
      untilExpiry: EXPIRES_MS - age,
      achEnabled: readAchEnabled(cache.hnk),
      rpsEnabled: readRpsEnabled(cache.hnk, terminal),
      legacy: compareLegacy(cache, terminal),
      label:
        terminal.terminalName || terminal.syntheticTerminalId || "(unnamed)",
    };
  }

  function fromXplorMerchantCache() {
    const current = currentMerchant();
    if (!current) return null;
    const list = parseItem(localStorage, merchantsKey(current.user));
    const found = Array.isArray(list)
      ? list.find((merchant) => merchant?.merchantNumber === current.hnk)
      : null;
    return { dba: found?.merchantName || "", hnk: current.hnk };
  }

  function fromLegacyMerchantCache() {
    const all = parseItem(localStorage, LEGACY_LOCAL_KEY);
    if (!Array.isArray(all)) return null;
    const merchant = all.find(
      (entry) => entry?.itemName === LEGACY_SELECTED_MERCHANT,
    )?.dataObject;
    if (!merchant) return null;
    return {
      dba: merchant.merchantName || "",
      hnk: merchant.merchantNumber || "",
    };
  }

  function parseMerchantLabel(text) {
    const trimmed = (text || "").trim();
    if (!trimmed) return null;
    const parts = trimmed.split(" - ");
    if (parts.length === 1) return { dba: "", hnk: parts[0] };
    return { dba: parts.slice(0, -1).join(" - "), hnk: parts.at(-1) };
  }

  function fromMerchantDom() {
    const input = document.querySelector("merchant-selector input");
    if (input) {
      const placeholder = (input.getAttribute("placeholder") || "").trim();
      if (placeholder && placeholder !== SEARCH_PLACEHOLDER) {
        const parsed = parseMerchantLabel(placeholder);
        if (parsed?.hnk) return parsed;
      }
    }
    return parseMerchantLabel(document.getElementById("merchantData")?.textContent);
  }

  function getMerchant() {
    const sources = [
      fromXplorMerchantCache(),
      fromLegacyMerchantCache(),
      fromMerchantDom(),
    ];
    const hnk = sources.find((source) => source?.hnk)?.hnk || "";
    const dba =
      sources.find(
        (source) =>
          source?.dba && (!hnk || !source.hnk || source.hnk === hnk),
      )?.dba || "";
    return { dba, hnk };
  }

  function getAccessToken() {
    const key =
      window.location.hostname === "my.clearent.net"
        ? "oidc.user:https://auth.clearent.net/oauth2/aus4ulyubshD7M0yf697:0oa6ggt30dFSxSVxX697"
        : "oidc.user:https://auth-sb.clearent.net/oauth2/aus3a1kavt9qzEcsz1d7:0oa3a1ic7mGSRLqrZ1d7";
    const value = parseItem(sessionStorage, key);
    return { key, token: value?.access_token || "", session: value };
  }

  function decodeJwtPayload(token) {
    const encoded = token?.split(".")[1];
    if (!encoded) return null;
    try {
      const base64 = encoded.replace(/-/g, "+").replace(/_/g, "/");
      const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
      const bytes = Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return null;
    }
  }

  function displayClaim(value) {
    if (Array.isArray(value)) return value.join(", ");
    if (value !== null && typeof value === "object")
      return JSON.stringify(value);
    return value == null ? "" : String(value);
  }

  function truncate(text, max) {
    const value = text ?? "";
    return value.length > max ? `${value.slice(0, max)}...` : value;
  }

  function preview(raw) {
    return truncate((raw ?? "").replace(/\s+/g, " ").trim(), PREVIEW_MAX_CHARS);
  }

  function timestampMillis(value) {
    if (typeof value === "number") {
      // Epoch seconds (JWT claims) and epoch milliseconds (Query caches).
      if (value >= 1e9 && value < 1e11) return value * 1000;
      if (value >= 1e11 && value < 1e14) return value;
      return null;
    }
    if (typeof value !== "string") return null;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function relativeTime(timestamp) {
    const difference = Date.now() - timestamp;
    const future = difference < 0;
    const seconds = Math.floor(Math.abs(difference) / 1000);
    const units = [
      ["day", 86400],
      ["hour", 3600],
      ["minute", 60],
      ["second", 1],
    ];
    const [unit, size] =
      units.find(([, unitSize]) => seconds >= unitSize) ?? units.at(-1);
    const amount = Math.floor(seconds / size);
    const duration = `${amount} ${unit}${amount === 1 ? "" : "s"}`;
    return future ? `in ${duration}` : `${duration} ago`;
  }

  async function copyText(value, button) {
    if (value === null || value === undefined) return;
    try {
      if (
        typeof GM !== "undefined" &&
        typeof GM.setClipboard === "function"
      ) {
        GM.setClipboard(value);
      } else {
        await navigator.clipboard.writeText(value);
      }
      const original = button.textContent;
      button.textContent = "✓";
      setTimeout(() => {
        if (button.isConnected) button.textContent = original;
      }, 900);
    } catch (error) {
      console.error("[DebugOverlay] Could not copy to clipboard", error);
    }
  }

  function jsonClipboardValue(value) {
    if (typeof value === "string") return value;
    if (value !== null && typeof value === "object")
      return JSON.stringify(value, null, 2);
    return String(value);
  }

  function jsonToken(text, color) {
    const token = document.createElement("span");
    token.style.color = color;
    token.textContent = text;
    return token;
  }

  function makeJsonCopyButton(value) {
    const button = makeButton(
      "⧉",
      () => copyText(jsonClipboardValue(value), button),
      "Copy this value",
    );
    button.style.cssText += ";padding:0 4px;opacity:.65;line-height:1.35";
    return button;
  }

  function replaceJsonValue(root, path, replacement) {
    if (path.length === 0) return replacement;
    let target = root;
    for (const part of path.slice(0, -1)) target = target[part];
    target[path.at(-1)] = replacement;
    return root;
  }

  function startJsonEdit(row, value, context, path) {
    if (context.body.dataset.editing === "true") return;
    context.body.dataset.editing = "true";

    const editor = document.createElement("div");
    editor.setAttribute("data-no-drag", "");
    editor.style.cssText =
      "display:flex;gap:4px;align-items:flex-start;margin:3px 0 5px 16px";
    const compound = value !== null && typeof value === "object";
    const field = document.createElement(compound ? "textarea" : "input");
    if (!compound) field.type = "text";
    field.value = context.isJson
      ? JSON.stringify(value, null, compound ? 2 : 0)
      : String(value);
    if (compound) field.rows = Math.min(12, field.value.split("\n").length + 1);
    field.spellcheck = false;
    field.style.cssText = [
      "box-sizing:border-box",
      compound ? "width:min(640px,70vw)" : "width:min(360px,55vw)",
      "border:1px solid rgba(255,255,255,.3)",
      "border-radius:4px",
      "padding:3px 5px",
      "color:#fff",
      "background:#202027",
      "font:inherit",
    ].join(";");
    const save = makeButton("Save", () => {
      let replacement = field.value;
      if (context.isJson) {
        try {
          replacement = JSON.parse(field.value);
        } catch {
          field.style.borderColor = RED;
          field.title = "Enter valid JSON";
          return;
        }
      }
      let next = replacement;
      if (context.isJson) {
        try {
          // Re-read first so a portal write to a sibling property while this
          // editor was open is not accidentally overwritten.
          const latest = JSON.parse(context.storage.getItem(context.key));
          next = replaceJsonValue(latest, path, replacement);
        } catch {
          field.style.borderColor = RED;
          field.title = "The cached value changed; reopen the editor";
          return;
        }
      }
      context.storage.setItem(
        context.key,
        context.isJson ? JSON.stringify(next) : next,
      );
      delete context.body.dataset.editing;
      renderValue(
        context.body,
        context.storage.getItem(context.key),
        context.storage,
        context.key,
      );
    });
    const cancel = makeButton("Cancel", () => {
      delete context.body.dataset.editing;
      editor.remove();
    });
    field.addEventListener("keydown", (event) => {
      if (event.key === "Escape") cancel.click();
      if (event.key === "Enter" && !compound && (event.ctrlKey || event.metaKey))
        save.click();
    });
    editor.append(field, save, cancel);
    row.after(editor);
    field.focus();
    field.select();
  }

  function makeJsonEditButton(row, value, context, path) {
    const button = makeButton(
      "✎",
      () => startJsonEdit(row, value, context, path),
      "Edit this value",
    );
    button.style.cssText += ";padding:0 4px;opacity:.65;line-height:1.35";
    return button;
  }

  function appendJsonLine(
    parent,
    depth,
    parts,
    value,
    timestamp,
    context,
    path,
    editable = true,
  ) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:4px;align-items:flex-start;width:fit-content;max-width:100%";
    const code = document.createElement("span");
    code.style.cssText =
      "white-space:pre-wrap;overflow-wrap:anywhere;min-width:0";
    code.append("  ".repeat(depth), ...parts);
    if (timestamp !== null) {
      const note = document.createElement("span");
      note.style.color = BLUE;
      note.dataset.timestamp = String(timestamp);
      note.textContent = `  ← ${relativeTime(timestamp)}`;
      code.appendChild(note);
    }
    const actions = document.createElement("span");
    actions.style.cssText =
      "display:inline-flex;gap:2px;flex:none;align-items:center";
    actions.appendChild(makeJsonCopyButton(value));
    if (editable)
      actions.appendChild(makeJsonEditButton(row, value, context, path));
    row.append(code, actions);
    parent.appendChild(row);
  }

  function jsonPrefix(key) {
    if (key === null) return [];
    return [jsonToken(JSON.stringify(key), JSON_KEY), ": "];
  }

  function appendJsonValue(
    parent,
    value,
    depth,
    key,
    last,
    context,
    path,
  ) {
    const prefix = jsonPrefix(key);
    const comma = last ? "" : ",";
    const timestamp =
      key !== null && ENTRY_TIMESTAMP_KEYS.has(key.toLowerCase())
        ? timestampMillis(value)
        : null;

    if (value !== null && typeof value === "object") {
      const entries = Array.isArray(value)
        ? value.map((item, index) => [null, item, index])
        : Object.entries(value).map(([name, item]) => [name, item, name]);
      const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
      const container =
        entries.length > 0 ? document.createElement("details") : parent;
      const lineParent =
        entries.length > 0 ? document.createElement("summary") : parent;
      if (entries.length > 0) {
        container.open = true;
        container.style.cssText = "margin:0";
        lineParent.style.cssText = "cursor:pointer;list-style-position:inside";
        container.appendChild(lineParent);
        parent.appendChild(container);
      }
      appendJsonLine(
        lineParent,
        depth,
        [...prefix, entries.length ? open : `${open}${close}${comma}`],
        value,
        null,
        context,
        path,
        false,
      );
      if (!entries.length) return;
      const children = document.createElement("div");
      container.appendChild(children);
      entries.forEach(([childKey, childValue, pathPart], index) =>
        appendJsonValue(
          children,
          childValue,
          depth + 1,
          childKey,
          index === entries.length - 1,
          context,
          [...path, pathPart],
        ),
      );
      // The opening row already owns the copy action for this object/array.
      const closing = document.createElement("div");
      closing.style.cssText = "white-space:pre";
      closing.textContent = `${"  ".repeat(depth)}${close}${comma}`;
      children.appendChild(closing);
      return;
    }

    let token;
    if (typeof value === "string")
      token = jsonToken(JSON.stringify(value), JSON_STRING);
    else if (typeof value === "number")
      token = jsonToken(String(value), JSON_NUMBER);
    else if (typeof value === "boolean")
      token = jsonToken(String(value), JSON_BOOLEAN);
    else token = jsonToken("null", GREY);
    appendJsonLine(
      parent,
      depth,
      [...prefix, token, comma],
      value,
      timestamp,
      context,
      path,
    );
  }

  function renderValue(body, raw, storage, storageKey) {
    body.replaceChildren();
    if (raw === null) return;
    body.dataset.raw = raw;
    let root;
    try {
      root = JSON.parse(raw);
      const context = {
        body,
        storage,
        key: storageKey,
        root,
        isJson: true,
      };
      appendJsonValue(body, root, 0, null, true, context, []);
    } catch {
      const context = {
        body,
        storage,
        key: storageKey,
        root: raw,
        isJson: false,
      };
      appendJsonLine(body, 0, [raw], raw, null, context, []);
    }
  }

  function updateRelativeTimes(body) {
    for (const note of body.querySelectorAll("[data-timestamp]")) {
      const timestamp = Number(note.dataset.timestamp);
      note.textContent = `  ← ${relativeTime(timestamp)}`;
    }
  }

  async function getCustomExclusions() {
    const exclusions = await GM.getValue(CUSTOM_EXCLUSIONS_KEY, []);
    return Array.isArray(exclusions) ? exclusions : [];
  }

  async function clearLocalCache() {
    const exclusions = new Set([
      ...DEFAULT_EXCLUSIONS,
      ...(await getCustomExclusions()),
    ]);
    const preserved = [];
    for (const key of exclusions) {
      const value = localStorage.getItem(key);
      if (value !== null) preserved.push({ key, value });
    }
    localStorage.clear();
    for (const { key, value } of preserved) localStorage.setItem(key, value);
  }

  function showExclusionsEditor(initialValue) {
    return new Promise((resolve) => {
      const dialog = document.createElement("dialog");
      dialog.setAttribute("data-no-drag", "");
      dialog.style.cssText =
        "width:50vw;max-height:80vh;padding:1em;border:none;box-shadow:0 5px 35px 10px #0000007f;border-radius:5px";
      const hint = document.createElement("p");
      hint.textContent =
        "One localStorage key per line. These keys are preserved when clearing the local cache.";
      hint.style.cssText = "margin:0 0 .5em";
      const textarea = document.createElement("textarea");
      textarea.value = initialValue;
      textarea.spellcheck = false;
      textarea.rows = 10;
      textarea.style.cssText =
        "width:100%;box-sizing:border-box;margin-bottom:.5em;font-family:monospace;border-radius:5px";
      const cancel = document.createElement("button");
      cancel.textContent = "Cancel";
      const save = document.createElement("button");
      save.textContent = "Save";
      const buttons = document.createElement("div");
      buttons.style.cssText = "display:flex;gap:.5em;justify-content:flex-end";
      buttons.append(cancel, save);
      dialog.append(hint, textarea, buttons);
      document.body.appendChild(dialog);
      const finish = () => {
        resolve(textarea.value);
        dialog.close();
      };
      cancel.onclick = () => dialog.close();
      save.onclick = finish;
      dialog.onkeydown = (event) => {
        if (event.key === "s" && (event.ctrlKey || event.metaKey)) {
          event.preventDefault();
          finish();
        }
      };
      dialog.onclose = () => {
        resolve(null);
        dialog.remove();
      };
      dialog.showModal();
      textarea.focus();
    });
  }

  async function editLocalExclusions() {
    const value = await showExclusionsEditor(
      (await getCustomExclusions()).join("\n"),
    );
    if (value === null) return;
    const exclusions = [
      ...new Set(
        value
          .split("\n")
          .map((key) => key.trim())
          .filter(Boolean),
      ),
    ];
    await GM.setValue(CUSTOM_EXCLUSIONS_KEY, exclusions);
  }

  function readModFedOverrides() {
    const raw = localStorage.getItem(MOD_FED_OVERRIDES_KEY);
    if (!raw) return {};
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
        return parsed;
    } catch {
      // The host ignores malformed data; the editor can safely replace it.
    }
    console.warn(`[DebugOverlay] Replacing malformed ${MOD_FED_OVERRIDES_KEY}.`);
    return {};
  }

  function writeModFedOverrides(overrides) {
    localStorage.setItem(
      MOD_FED_OVERRIDES_KEY,
      JSON.stringify(overrides, null, 2),
    );
  }

  function isCompleteModFedEntry(entry) {
    return (
      !!entry &&
      typeof entry === "object" &&
      typeof entry.url === "string" &&
      typeof entry.enabled === "boolean"
    );
  }

  function modFedUrl(name, entry) {
    return typeof entry?.url === "string"
      ? entry.url
      : (LOCAL_REMOTES[name] ?? "");
  }

  function modFedEntryNames(overrides) {
    return [
      ...new Set([...Object.keys(LOCAL_REMOTES), ...Object.keys(overrides)]),
    ];
  }

  function isKnownRemote(name) {
    return Object.hasOwn(LOCAL_REMOTES, name);
  }

  function seedModFedEntries() {
    const overrides = readModFedOverrides();
    let changed = false;
    for (const name of Object.keys(LOCAL_REMOTES)) {
      if (isCompleteModFedEntry(overrides[name])) continue;
      overrides[name] = {
        url: modFedUrl(name, overrides[name]),
        enabled: overrides[name]?.enabled === true,
      };
      changed = true;
    }
    if (changed) writeModFedOverrides(overrides);
  }

  // Capture what the host booted with before filling in any missing defaults.
  const bootModFedOverrides = readModFedOverrides();
  seedModFedEntries();

  const overlay = document.createElement("div");
  overlay.id = "xplor-mp-debug-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#fff",
    "background:rgba(20,20,24,.9)",
    "box-shadow:0 2px 10px rgba(0,0,0,.4)",
    "cursor:grab",
    "user-select:none",
    "touch-action:none",
  ].join(";");
  overlay.title =
    "Merchant Portal developer tools — drag to move, click to toggle views";

  let mode = MODES.includes(localStorage.getItem(MODE_KEY))
    ? localStorage.getItem(MODE_KEY)
    : "compact";
  const savedTab = localStorage.getItem(TAB_KEY);
  let activeTab = TABS.includes(savedTab)
    ? savedTab
    : LEGACY_TAB_NAMES[savedTab] || TABS[0];
  localStorage.setItem(TAB_KEY, activeTab);
  let terminalsExpanded = false;
  // Deliberately not persisted: a full-window overlay is not what you want to
  // come back to on the next page load.
  let fullScreen = false;
  const storageExpanded = { local: false, session: false };
  let fontSize = readFontSize();
  applyFontSize();

  function readFontSize() {
    const saved = Number(localStorage.getItem(FONT_KEY));
    if (!Number.isFinite(saved) || saved <= 0) return FONT_DEFAULT_PX;
    return clamp(Math.round(saved), FONT_MIN_PX, FONT_MAX_PX);
  }

  // The shorthand `font` above sets the size; assigning the longhand wins.
  function applyFontSize() {
    overlay.style.fontSize = `${fontSize}px`;
  }

  function fontSizeTitle() {
    return `Overlay text size (${fontSize}px)`;
  }

  function changeFontSize(delta) {
    const next = clamp(fontSize + delta, FONT_MIN_PX, FONT_MAX_PX);
    if (next === fontSize) return;
    fontSize = next;
    localStorage.setItem(FONT_KEY, String(fontSize));
    applyFontSize();
    if (refs.fontGauge) refs.fontGauge.title = fontSizeTitle();
    applyGeometry();
  }

  function isFullScreen() {
    return fullScreen && mode === "panel";
  }

  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }

  function applyPosition(left, top) {
    const maxLeft = Math.max(0, window.innerWidth - overlay.offsetWidth);
    const maxTop = Math.max(0, window.innerHeight - overlay.offsetHeight);
    overlay.style.transform = "none";
    overlay.style.left = `${clamp(left, 0, maxLeft)}px`;
    overlay.style.top = `${clamp(top, 0, maxTop)}px`;
  }

  function savePosition() {
    localStorage.setItem(
      POS_KEY,
      JSON.stringify({
        left: parseFloat(overlay.style.left),
        top: parseFloat(overlay.style.top),
      }),
    );
  }

  function restorePosition() {
    const saved = parseItem(localStorage, POS_KEY);
    if (typeof saved?.left !== "number" || typeof saved?.top !== "number")
      return;
    applyPosition(saved.left, saved.top);
  }

  function applyFullScreen() {
    const gutter = `${EXPANDED_GUTTER_PX}px`;
    overlay.style.transform = "none";
    overlay.style.left = gutter;
    overlay.style.top = gutter;
    overlay.style.width = `calc(100vw - ${2 * EXPANDED_GUTTER_PX}px)`;
    overlay.style.height = `calc(100vh - ${2 * EXPANDED_GUTTER_PX}px)`;
    overlay.style.display = "flex";
    overlay.style.flexDirection = "column";
    overlay.style.cursor = "default";
  }

  function clearFullScreen() {
    overlay.style.width = "";
    overlay.style.height = "";
    overlay.style.display = "block";
    overlay.style.cursor = "grab";
    // Back to the centred default; a saved position overrides it right after.
    overlay.style.top = "8px";
    overlay.style.left = "50%";
    overlay.style.transform = "translateX(-50%)";
  }

  function applyGeometry() {
    if (isFullScreen()) applyFullScreen();
    else restorePosition();
  }

  let drag = null;
  overlay.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    // A full-window panel has nowhere to be dragged to.
    if (isFullScreen()) return;
    // Controls inside the panel handle their own clicks.
    if (event.target.closest("[data-no-drag]")) return;
    const rect = overlay.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originLeft: rect.left,
      originTop: rect.top,
      moved: false,
    };
    overlay.setPointerCapture(event.pointerId);
    overlay.style.cursor = "grabbing";
  });

  overlay.addEventListener("pointermove", (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (
      !drag.moved &&
      dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX
    )
      return;
    drag.moved = true;
    applyPosition(drag.originLeft + dx, drag.originTop + dy);
  });

  function endDrag(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const wasDrag = drag.moved;
    drag = null;
    overlay.style.cursor = "grab";
    if (wasDrag) {
      savePosition();
      return;
    }
    // The inline views have no controls of their own, so a click is the only
    // way out of them. The panel cycles from the button in its tab bar.
    if (mode !== "panel") cycleMode();
  }

  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", applyGeometry);

  function makeDot() {
    const dot = document.createElement("span");
    dot.style.cssText =
      "display:inline-block;width:8px;height:8px;border-radius:50%;flex:none";
    return dot;
  }

  function makePlain(text) {
    const span = document.createElement("span");
    span.textContent = text;
    return span;
  }

  // Rows in an aligned group get their labels padded to a common width once
  // the group is built, which lines up the values without moving each row's
  // trailing controls away from the value they belong to.
  function makeAlignedGroup(parent) {
    const group = document.createElement("div");
    group.dataset.aligned = "true";
    group.style.cssText =
      "display:flex;flex-direction:column;gap:2px;max-width:100%";
    parent.appendChild(group);
    return group;
  }

  function makeRowWrapper() {
    const row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;align-items:baseline";
    return row;
  }

  function makeLabel(parent, text) {
    const name = document.createElement("span");
    name.style.cssText = "opacity:.6;flex:none";
    // Only labels inside an aligned group take part in the padding pass.
    if (parent.dataset.aligned === "true") name.dataset.alignLabel = "";
    name.textContent = text;
    return name;
  }

  // Values start at the same offset because every label in a group is padded
  // out to the longest one. The overlay font is monospace, so `ch` is exact.
  function alignLabels(root) {
    for (const group of root.querySelectorAll('[data-aligned="true"]')) {
      const labels = [
        ...group.querySelectorAll(":scope > * > [data-align-label]"),
      ];
      if (!labels.length) continue;
      const width = Math.max(...labels.map((el) => el.textContent.length));
      for (const el of labels) el.style.minWidth = `${width}ch`;
    }
  }

  function makeRow(parent, label) {
    const row = makeRowWrapper();
    const name = makeLabel(parent, label);
    const value = document.createElement("span");
    row.append(name, value);
    parent.appendChild(row);
    return value;
  }

  function setStatus(value, enabled) {
    value.textContent = enabled === null ? "?" : enabled ? "✓" : "✗";
    value.style.color = enabled === null ? GREY : enabled ? GREEN : RED;
  }

  function makeStatusRow(parent, label, enabled) {
    const value = makeRow(parent, `${label}`);
    setStatus(value, enabled);
    return value;
  }

  let built = null;
  let refs = {};

  function makeButton(text, onClick, title = "") {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.title = title;
    button.setAttribute("data-no-drag", "");
    button.style.cssText = [
      "border:1px solid rgba(255,255,255,.25)",
      "border-radius:5px",
      "padding:2px 7px",
      "color:#fff",
      "background:rgba(255,255,255,.08)",
      "font:inherit",
      "cursor:pointer",
    ].join(";");
    button.addEventListener("click", onClick);
    return button;
  }

  function makeFontControls() {
    const group = document.createElement("div");
    group.setAttribute("data-no-drag", "");
    group.style.cssText = "display:flex;align-items:center;gap:3px";
    const gauge = document.createElement("span");
    gauge.style.cssText = "opacity:.6;line-height:1";
    gauge.style.padding = "0 4px";
    gauge.title = fontSizeTitle();
    refs.fontGauge = gauge;
    const small = document.createElement("span");
    small.style.fontSize = ".8em";
    small.textContent = "A";
    const large = document.createElement("span");
    large.style.fontSize = "1.15em";
    large.textContent = "A";
    gauge.append(small, large);
    const shrink = makeButton("−", () => changeFontSize(-1), "Smaller text");
    const grow = makeButton("+", () => changeFontSize(1), "Larger text");
    group.append(shrink, gauge, grow);
    return group;
  }

  function cycleMode() {
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    localStorage.setItem(MODE_KEY, mode);
    render();
  }

  function toggleFullScreen() {
    fullScreen = !fullScreen;
    if (!fullScreen) clearFullScreen();
    render();
  }

  // The inline views stay the pill they always were: no tabs, click to cycle.
  function buildInline(data) {
    clearFullScreen();
    overlay.style.borderRadius = "999px";
    overlay.style.whiteSpace = "nowrap";
    overlay.style.padding = "6px 12px";
    overlay.replaceChildren();
    refs.dot = makeDot();

    if (!data) {
      const empty = document.createElement("div");
      empty.style.cssText = "display:flex;gap:8px;align-items:center";
      empty.append(refs.dot, makePlain("No Cached Terminals"));
      overlay.appendChild(empty);
      return;
    }

    // Inline (not flex) layout: flex items trim their own leading and trailing
    // whitespace, which would eat the spaces around the separators below.
    const wrap = document.createElement("div");
    wrap.style.cssText = "white-space:pre";
    refs.dot.style.cssText += ";vertical-align:middle;margin-right:8px";
    wrap.appendChild(refs.dot);

    refs.expires = document.createElement("span");
    refs.stale = document.createElement("span");

    if (mode === "compact") {
      wrap.append(makePlain("E "), refs.expires, makePlain("  S "), refs.stale);
    } else {
      refs.label = document.createElement("span");
      refs.age = document.createElement("span");
      refs.reason = document.createElement("span");
      wrap.append(
        refs.label,
        makePlain(" · Expires "),
        refs.expires,
        makePlain(" · Stale "),
        refs.stale,
        makePlain(" · Age "),
        refs.age,
        refs.reason,
      );
    }

    overlay.appendChild(wrap);
  }

  function buildShell() {
    overlay.style.borderRadius = "10px";
    overlay.style.whiteSpace = "normal";
    overlay.style.padding = "0";
    overlay.replaceChildren();

    const bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;align-items:center;gap:8px;padding-right:8px;border-bottom:1px solid rgba(255,255,255,.18)";
    const tabs = document.createElement("div");
    tabs.style.cssText = "display:flex;flex:1";
    for (const tab of TABS) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = tab;
      button.setAttribute("data-no-drag", "");
      button.style.cssText = [
        "border:0",
        "border-bottom:2px solid transparent",
        "padding:7px 10px 5px",
        "color:#fff",
        "background:transparent",
        "font:inherit",
        "cursor:pointer",
        tab === activeTab ? `border-bottom-color:${GREEN}` : "opacity:.6",
      ].join(";");
      button.addEventListener("click", () => {
        activeTab = tab;
        localStorage.setItem(TAB_KEY, tab);
        render();
      });
      tabs.appendChild(button);
    }
    const expand = makeButton(
      "⛶",
      toggleFullScreen,
      fullScreen ? "Exit full screen" : "Full screen",
    );
    if (fullScreen) {
      expand.style.borderColor = GREEN;
      expand.style.color = GREEN;
    }
    bar.append(
      tabs,
      makeFontControls(),
      makeButton("⬋", cycleMode, "Minimize (cycle views)"),
      expand,
    );

    refs.content = document.createElement("div");
    refs.content.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "gap:5px",
      "padding:9px 12px 11px",
      fullScreen
        ? "flex:1;min-height:0;overflow:auto;overscroll-behavior:contain"
        : "min-width:340px;max-width:min(620px,90vw)",
    ].join(";");
    if (fullScreen) refs.content.setAttribute("data-no-drag", "");
    overlay.append(bar, refs.content);
  }

  function buildVirtualTerminal(data) {
    refs.dot = makeDot();

    if (!data) {
      const empty = document.createElement("div");
      empty.style.cssText = "display:flex;gap:8px;align-items:center";
      empty.append(refs.dot, makePlain("No Cached Terminals"));
      refs.content.appendChild(empty);
      return;
    }

    const header = document.createElement("div");
    header.style.cssText = "display:flex;gap:8px;align-items:center";
    refs.selected = document.createElement("span");
    header.append(refs.dot, refs.selected);
    refs.content.appendChild(header);

    refs.rows = makeAlignedGroup(refs.content);

    const terminalsRow = makeRowWrapper();
    const terminalsLabel = makeLabel(refs.rows, "Terminals");
    refs.terminalsToggle = document.createElement("span");
    refs.terminalsToggle.setAttribute("data-no-drag", "");
    refs.terminalsToggle.style.cssText =
      "cursor:pointer;text-decoration:underline dotted";
    refs.terminalsToggle.addEventListener("click", () => {
      terminalsExpanded = !terminalsExpanded;
      render();
    });
    terminalsRow.append(terminalsLabel, refs.terminalsToggle);
    refs.rows.appendChild(terminalsRow);

    if (terminalsExpanded) {
      const list = document.createElement("div");
      list.setAttribute("data-no-drag", "");
      list.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:2px",
        "padding:2px 0 2px 10px",
        "opacity:.85",
        // The full-window panel scrolls as a whole, so its lists run free.
        fullScreen ? "" : `max-height:${TERMINAL_LIST_MAX_HEIGHT_PX}px`,
        "overflow-y:auto",
        "overflow-x:hidden",
        "overscroll-behavior:contain",
        "touch-action:pan-y",
        "scrollbar-width:thin",
        "scrollbar-color:rgba(255,255,255,.35) transparent",
      ].join(";");
      for (const terminal of data.cache.list) {
        const entry = document.createElement("div");
        const isSelected =
          terminal.syntheticTerminalId === data.terminal.syntheticTerminalId;
        entry.style.cssText = `color:${isSelected ? GREEN : "#fff"}`;
        entry.textContent = `${isSelected ? "• " : "  "}${terminal.terminalName || "(unnamed)"} — ${terminal.syntheticTerminalId ?? "?"}`;
        list.appendChild(entry);
      }
      refs.rows.appendChild(list);
    }

    refs.expires = makeRow(refs.rows, "Expires");
    refs.stale = makeRow(refs.rows, "Stale");
    refs.age = makeRow(refs.rows, "Age");
    refs.ach = makeStatusRow(refs.rows, "ACH", data.achEnabled);
    refs.rps = makeStatusRow(refs.rows, "RPS", data.rpsEnabled);

    const legacyHeader = document.createElement("div");
    legacyHeader.style.cssText = "opacity:.6;margin-top:4px";
    legacyHeader.textContent = "Matches in Legacy Cache:";
    refs.content.appendChild(legacyHeader);

    // Legacy labels are much longer, so they align among themselves instead of
    // stretching the label column of the rows above.
    const legacyList = makeAlignedGroup(refs.content);
    legacyList.style.paddingLeft = "10px";
    refs.legacyRows = LEGACY_CHECKS.map(({ label, storage }) =>
      makeRow(legacyList, `${label} (${storage})`),
    );
  }

  // The full value is what lands on the clipboard; only the display is cut.
  function makeCopyRow(
    label,
    value,
    maxChars = VALUE_MAX_CHARS,
    singleLine = false,
  ) {
    const parent = refs.rows ?? refs.content;
    const row = makeRowWrapper();
    row.setAttribute("data-no-drag", "");
    row.style.cssText =
      "display:flex;gap:8px;align-items:center;max-width:100%";
    const name = makeLabel(parent, label);
    const output = document.createElement("span");
    output.style.cssText = singleLine
      ? `white-space:nowrap;overflow:hidden;text-overflow:clip;max-width:${maxChars + 3}ch;user-select:text`
      : "overflow-wrap:anywhere;user-select:text";
    output.textContent = value ? truncate(value, maxChars) : "Not found";
    if (!value) output.style.color = GREY;
    if (value && value.length > maxChars) output.title = value;
    const copy = makeButton("⧉", () => copyText(value, copy), `Copy ${label}`);
    copy.disabled = !value;
    if (!value) copy.style.opacity = ".35";
    row.append(name, output, copy);
    parent.appendChild(row);
  }

  function buildMerchant() {
    const { dba, hnk } = getMerchant();
    refs.rows = makeAlignedGroup(refs.content);
    makeCopyRow("DBA", dba);
    makeCopyRow("HNK", hnk);
    makeCopyRow(
      "Display",
      [dba, hnk && `\`${hnk}\``].filter(Boolean).join(" - "),
    );

    const heading = document.createElement("div");
    heading.style.cssText =
      "margin-top:6px;padding-top:6px;border-top:1px solid rgba(255,255,255,.18);opacity:.7";
    heading.textContent = "Features";
    refs.content.appendChild(heading);
    const features = readFeatures(hnk)
      .filter((feature) => typeof feature?.feature === "string")
      .sort((left, right) => left.feature.localeCompare(right.feature));
    if (!features.length) {
      const empty = makePlain("No cached features");
      empty.style.color = GREY;
      refs.content.appendChild(empty);
      return;
    }
    const featureList = document.createElement("div");
    featureList.setAttribute("data-no-drag", "");
    featureList.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "gap:2px",
      "max-height:calc(15em + 18px)",
      "overflow-y:auto",
      "overscroll-behavior:contain",
      "scrollbar-width:thin",
      "scrollbar-color:rgba(255,255,255,.35) transparent",
    ].join(";");
    refs.content.appendChild(featureList);
    for (const feature of features)
      makeStatusRow(
        featureList,
        feature.feature,
        typeof feature.isAvailable === "boolean"
          ? feature.isAvailable
          : null,
      );
  }

  function buildOkta() {
    const { key, token, session } = getAccessToken();
    const claims = decodeJwtPayload(token);
    // The issuer is the longest value on the tab, so the token is cut to end
    // exactly where it does — the trailing "..." included.
    const issuerLength =
      typeof claims?.iss === "string"
        ? claims.iss.length
        : OKTA_TOKEN_MAX_CHARS;
    refs.rows = makeAlignedGroup(refs.content);
    makeCopyRow(
      "Bearer",
      token,
      fullScreen ? Number.POSITIVE_INFINITY : Math.max(8, issuerLength - 3),
      !fullScreen,
    );
    if (!token) {
      const missing = document.createElement("div");
      missing.style.cssText = `color:${GREY};overflow-wrap:anywhere`;
      missing.textContent = `${key} not in session storage`;
      refs.content.appendChild(missing);
      return;
    }

    if (!claims) {
      const unavailable = makePlain("Token metadata unavailable");
      unavailable.style.color = GREY;
      refs.content.appendChild(unavailable);
      return;
    }

    refs.oktaExpires = makeRow(refs.rows, "Expires");
    refs.oktaIssued = makeRow(refs.rows, "Issued");
    const username =
      claims.preferred_username ||
      claims.email ||
      session?.profile?.preferred_username ||
      session?.profile?.email;
    if (username) makeCopyRow("User", displayClaim(username));
    if (claims.sub) makeCopyRow("Subject", displayClaim(claims.sub));
    if (claims.iss) makeCopyRow("Issuer", displayClaim(claims.iss));
    if (claims.aud) makeCopyRow("Audience", displayClaim(claims.aud));
    if (claims.scp || claims.scope)
      makeCopyRow("Scopes", displayClaim(claims.scp || claims.scope));
    refs.oktaClaims = claims;
  }

  function storageKeys(storage) {
    const keys = [];
    for (let i = 0; i < storage.length; i++) keys.push(storage.key(i));
    return keys.filter(Boolean).sort();
  }

  function cacheGroupFor(key) {
    if (key.startsWith("xplor.debug.")) return CACHE_GROUPS[3];
    if (key.startsWith("xplor.")) return CACHE_GROUPS[0];
    if (
      key.startsWith("CACHED_") ||
      key === "destinationUrl" ||
      key === "userName"
    )
      return CACHE_GROUPS[1];
    return CACHE_GROUPS[2];
  }

  function appendCacheGroupHeading(list, group, addRule) {
    if (addRule) {
      const rule = document.createElement("hr");
      rule.style.cssText =
        "width:100%;box-sizing:border-box;border:0;border-top:1px solid rgba(255,255,255,.2);margin:6px 0 2px";
      list.appendChild(rule);
    }
    const heading = document.createElement("div");
    heading.style.cssText = `color:${group.color};font-weight:600;opacity:.9`;
    heading.textContent = group.label;
    list.appendChild(heading);
  }

  function buildStorageSection(kind, storage) {
    const keys = storageKeys(storage);
    const section = document.createElement("details");
    section.open = storageExpanded[kind];
    section.setAttribute("data-no-drag", "");
    section.style.cssText =
      "border:1px solid rgba(255,255,255,.14);border-radius:5px;padding:4px 7px";
    const summary = document.createElement("summary");
    summary.style.cssText = "cursor:pointer";
    summary.textContent = `${kind === "local" ? "Local Storage" : "Session Storage"} (${keys.length})`;
    section.appendChild(summary);

    const list = document.createElement("div");
    list.style.cssText = [
      "display:flex",
      "flex-direction:column",
      "gap:4px",
      "padding:7px 0 3px",
      fullScreen ? "" : `max-height:${STORAGE_LIST_MAX_HEIGHT_PX}px`,
      "overflow-y:auto",
      "overscroll-behavior:contain",
      "touch-action:pan-y",
      "user-select:text",
      "scrollbar-width:thin",
      "scrollbar-color:rgba(255,255,255,.35) transparent",
    ].join(";");

    const entries = new Map();
    const populatedGroups = CACHE_GROUPS.map((group) => ({
      group,
      keys: keys.filter((key) => cacheGroupFor(key).id === group.id),
    })).filter(({ keys: groupKeys }) => groupKeys.length);
    populatedGroups.forEach(({ group, keys: groupKeys }, groupIndex) => {
      appendCacheGroupHeading(list, group, groupIndex > 0);
      for (const key of groupKeys) {
      const entry = document.createElement("details");
      const entrySummary = document.createElement("summary");
      entrySummary.style.cssText = "cursor:pointer;overflow-wrap:anywhere";
      const name = document.createElement("span");
      name.style.color = group.color;
      name.textContent = key;
      const hint = document.createElement("span");
      hint.style.opacity = ".55";
      hint.textContent = ` ${preview(storage.getItem(key))}`;
      entrySummary.append(name, hint);
      const body = document.createElement("div");
      body.style.cssText =
        "margin:2px 0 4px;padding-left:12px;font:inherit;opacity:.9;overflow-wrap:anywhere";
      entry.append(entrySummary, body);
      // Rendering every entry on every tick would be wasteful, so only open
      // values receive syntax highlighting and live timestamp updates.
      entry.addEventListener("toggle", () => {
        if (entry.open) renderValue(body, storage.getItem(key), storage, key);
      });
      list.appendChild(entry);
      entries.set(key, { entry, hint, body });
      }
    });
    if (keys.length === 0) list.appendChild(makePlain("Empty"));

    section.appendChild(list);
    section.addEventListener("toggle", () => {
      storageExpanded[kind] = section.open;
    });
    refs.storage[kind] = entries;
    refs.content.appendChild(section);
  }

  function buildCache() {
    refs.storage = {};
    buildStorageSection("local", localStorage);
    buildStorageSection("session", sessionStorage);

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;gap:6px;flex-wrap:wrap;justify-content:space-between;margin-top:3px";
    const exclusions = makeButton(
      "Edit Local Exclusions",
      editLocalExclusions,
    );
    const clearActions = document.createElement("span");
    clearActions.style.cssText = "display:inline-flex;gap:6px;flex-wrap:wrap";
    const clearSession = makeButton("Clear Session", () => {
        sessionStorage.clear();
        render();
      });
    const clearLocal = makeButton("Clear Local", async () => {
        await clearLocalCache();
        render();
      });
    const clearAll = makeButton("Clear All", async () => {
        sessionStorage.clear();
        await clearLocalCache();
        render();
      });
    for (const button of [clearSession, clearLocal, clearAll]) {
      button.style.borderColor = RED;
      button.style.color = RED;
      button.style.background = "rgba(255,107,107,.1)";
    }
    clearActions.append(clearSession, clearLocal, clearAll);
    actions.append(exclusions, clearActions);
    refs.content.appendChild(actions);
  }

  function makeModFedInput(type, value, placeholder) {
    const input = document.createElement("input");
    input.type = type;
    input.value = value;
    input.placeholder = placeholder;
    input.setAttribute("data-no-drag", "");
    input.style.cssText = [
      "box-sizing:border-box",
      "width:100%",
      "border:1px solid rgba(255,255,255,.25)",
      "border-radius:4px",
      "padding:4px 6px",
      "color:#fff",
      "background:rgba(255,255,255,.08)",
      "font:inherit",
    ].join(";");
    return input;
  }

  function setServerIndicator(indicator, state, url) {
    const states = {
      checking: { text: "… Checking", color: AMBER },
      running: { text: "✓ Running", color: GREEN },
      stopped: { text: "○ Not running", color: GREY },
      unavailable: { text: "○ Not a local URL", color: GREY },
      empty: { text: "○ No URL", color: GREY },
    };
    const current = states[state];
    indicator.textContent = current.text;
    indicator.style.color = current.color;
    indicator.title =
      state === "stopped"
        ? `No server responded at ${url}; the override can still be saved. Click to check again.`
        : `${url || current.text}. Click to check again.`;
  }

  function probeLocalServer(url, indicator) {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      setServerIndicator(indicator, url ? "unavailable" : "empty", url);
      return;
    }
    if (!["localhost", "127.0.0.1"].includes(parsed.hostname)) {
      setServerIndicator(indicator, "unavailable", url);
      return;
    }

    const probeId = String(Number(indicator.dataset.probeId || 0) + 1);
    indicator.dataset.probeId = probeId;
    setServerIndicator(indicator, "checking", url);
    const finish = (state) => {
      if (indicator.dataset.probeId === probeId)
        setServerIndicator(indicator, state, url);
    };
    if (
      typeof GM !== "undefined" &&
      typeof GM.xmlHttpRequest === "function"
    ) {
      GM.xmlHttpRequest({
        method: "HEAD",
        url,
        timeout: 1800,
        onload: () => finish("running"),
        onerror: () => finish("stopped"),
        ontimeout: () => finish("stopped"),
      });
      return;
    }
    fetch(url, { method: "HEAD", mode: "no-cors", cache: "no-store" })
      .then(() => finish("running"))
      .catch(() => finish("stopped"));
  }

  function buildModFed() {
    const overrides = readModFedOverrides();
    const staged = new Map(
      modFedEntryNames(overrides).map((name) => [
        name,
        {
          url: modFedUrl(name, overrides[name]),
          enabled: overrides[name]?.enabled === true,
        },
      ]),
    );

    const hint = document.createElement("div");
    hint.style.opacity = ".7";
    hint.textContent =
      "Enabled MFEs load from the configured URL after the next page reload.";
    refs.content.appendChild(hint);

    const list = document.createElement("div");
    list.style.cssText =
      "display:flex;flex-direction:column;gap:7px;margin-top:3px";
    refs.content.appendChild(list);

    const warning = document.createElement("div");
    warning.style.color = AMBER;

    function updateWarning() {
      const messages = [];
      const missing = [...staged]
        .filter(([, entry]) => entry.enabled && !entry.url)
        .map(([name]) => name);
      if (missing.length)
        messages.push(`Enabled without a URL: ${missing.join(", ")}.`);
      const mixed =
        location.protocol === "https:" &&
        [...staged.values()].some(
          (entry) => entry.enabled && entry.url.startsWith("http://"),
        );
      if (mixed)
        messages.push(
          "This page is HTTPS, so HTTP localhost remotes may be blocked as mixed content.",
        );
      warning.textContent = messages.join(" ");
    }

    function addRow(name) {
      const entry = staged.get(name);
      const row = document.createElement("div");
      row.setAttribute("data-no-drag", "");
      row.style.cssText =
        "display:grid;grid-template-columns:auto minmax(0,1fr) auto;gap:8px;align-items:center";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = entry.enabled;
      checkbox.title = `Enable ${name}`;
      checkbox.onchange = () => {
        entry.enabled = checkbox.checked;
        updateWarning();
      };

      const fields = document.createElement("div");
      fields.style.cssText =
        "display:flex;flex-direction:column;gap:2px;min-width:0";
      const labelRow = document.createElement("div");
      labelRow.style.cssText =
        "display:flex;gap:8px;justify-content:space-between;align-items:baseline";
      const label = document.createElement("span");
      label.textContent = name;
      const indicator = document.createElement("span");
      indicator.setAttribute("data-no-drag", "");
      indicator.style.cssText =
        "font-size:.9em;white-space:nowrap;cursor:pointer";
      labelRow.append(label, indicator);
      const url = makeModFedInput(
        "url",
        entry.url,
        "http://localhost:NNNN/remoteEntry.json",
      );
      let probeTimer;
      url.oninput = () => {
        entry.url = url.value.trim();
        updateWarning();
        clearTimeout(probeTimer);
        probeTimer = setTimeout(
          () => probeLocalServer(entry.url, indicator),
          350,
        );
      };
      indicator.onclick = () => probeLocalServer(entry.url, indicator);
      fields.append(labelRow, url);
      probeLocalServer(entry.url, indicator);

      const remove = makeButton("Remove", () => {
        staged.delete(name);
        row.remove();
        updateWarning();
      });
      remove.hidden = isKnownRemote(name);
      row.append(checkbox, fields, remove);
      list.appendChild(row);
    }

    for (const name of staged.keys()) addRow(name);

    const addControls = document.createElement("div");
    addControls.setAttribute("data-no-drag", "");
    addControls.style.cssText =
      "display:grid;grid-template-columns:minmax(100px,.6fr) minmax(180px,1fr) auto;gap:6px;align-items:center;margin-top:4px";
    const nameInput = makeModFedInput("text", "", "merchant-something-ui");
    const urlInput = makeModFedInput(
      "url",
      "",
      "http://localhost:NNNN/remoteEntry.json",
    );
    const add = makeButton("Add", addCustomEntry);

    function addCustomEntry() {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      if (staged.has(name)) {
        alert(`An entry named "${name}" already exists.`);
        nameInput.focus();
        return;
      }
      staged.set(name, { url: urlInput.value.trim(), enabled: false });
      addRow(name);
      nameInput.value = "";
      urlInput.value = "";
      nameInput.focus();
      updateWarning();
    }

    nameInput.onkeydown = urlInput.onkeydown = (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addCustomEntry();
      }
    };
    addControls.append(nameInput, urlInput, add);
    refs.content.append(addControls, warning);
    updateWarning();

    const actions = document.createElement("div");
    actions.style.cssText =
      "display:flex;justify-content:flex-end;margin-top:3px";
    const saveButton = makeButton("Save", () => {
        const missing = [...staged]
          .filter(([, entry]) => entry.enabled && !entry.url)
          .map(([name]) => name);
        if (missing.length) {
          alert(`Cannot enable an MFE without a URL: ${missing.join(", ")}`);
          return;
        }

        const updated = readModFedOverrides();
        for (const name of Object.keys(updated)) {
          if (!isKnownRemote(name) && !staged.has(name)) delete updated[name];
        }
        for (const [name, entry] of staged)
          updated[name] = { url: entry.url, enabled: entry.enabled };
        writeModFedOverrides(updated);

        const needsReload =
          [...staged].some(([name, next]) => {
            const boot = bootModFedOverrides[name];
            return (
              next.enabled !== (boot?.enabled === true) ||
              next.url !== (boot?.url ?? modFedUrl(name))
            );
          }) ||
          Object.keys(bootModFedOverrides).some(
            (name) => !staged.has(name) && !isKnownRemote(name),
          );
        render();
        if (
          needsReload &&
          confirm("Reload now to apply the changed overrides?")
        )
          location.reload();
      });
    saveButton.style.borderColor = GREEN;
    saveButton.style.color = GREEN;
    saveButton.style.background = "rgba(123,220,181,.1)";
    actions.appendChild(saveButton);
    refs.content.appendChild(actions);
  }

  function structureSignature(data) {
    if (mode !== "panel") return `${mode}|${Boolean(data)}`;
    const panel = `panel|${fullScreen}`;
    if (activeTab === "Terminal") {
      return [
        panel,
        activeTab,
        terminalsExpanded,
        terminalIds(data?.cache.list),
        Boolean(data),
      ].join("|");
    }
    if (activeTab === "Cache") {
      return `${panel}|${activeTab}|${storageKeys(localStorage).join(",")}|${storageKeys(sessionStorage).join(",")}`;
    }
    if (activeTab === "Merchant") {
      const { dba, hnk } = getMerchant();
      return `${panel}|${activeTab}|${dba}|${hnk}|${featureFingerprint(hnk)}`;
    }
    if (activeTab === "Okta")
      return `${panel}|${activeTab}|${getAccessToken().token}`;
    return `${panel}|${activeTab}|${localStorage.getItem(MOD_FED_OVERRIDES_KEY)}`;
  }

  function build(data, key) {
    refs = {};
    if (mode !== "panel") {
      buildInline(data);
    } else {
      buildShell();
      if (activeTab === "Terminal") buildVirtualTerminal(data);
      else if (activeTab === "Merchant") buildMerchant();
      else if (activeTab === "Okta") buildOkta();
      else if (activeTab === "Cache") buildCache();
      else buildModFed();
      alignLabels(refs.content);
    }
    built = key;
  }

  function updateVirtualTerminal(data) {
    if (!data) {
      refs.dot.style.background = GREY;
      return;
    }
    const accent = accentFor(data.untilExpiry);
    refs.dot.style.background = accent;
    refs.expires.textContent = formatDuration(data.untilExpiry);
    refs.expires.style.color = accent;
    refs.stale.textContent = formatDuration(data.untilStale);
    refs.stale.style.color = accentFor(data.untilStale);
    if (mode === "detail") {
      refs.label.textContent = data.label;
      refs.age.textContent = formatDuration(data.age);
      refs.reason.textContent = data.reason ? ` · ${data.reason}` : "";
    } else if (mode === "panel") {
      refs.selected.textContent = `Selected: ${data.label}`;
      refs.terminalsToggle.textContent = `${terminalsExpanded ? "▾" : "▸"} ${data.cache.list.length}`;
      refs.age.textContent = formatDuration(data.age);
      setStatus(refs.ach, data.achEnabled);
      setStatus(refs.rps, data.rpsEnabled);
      data.legacy.forEach((result, index) => {
        const row = refs.legacyRows[index];
        row.textContent = result.ok ? "✓" : `✗ ${result.detail}`.trim();
        row.style.color = result.ok ? GREEN : RED;
      });
    }
    if (LOG_TO_CONSOLE) {
      console.debug(
        `[DebugOverlay] vt token for ${data.label} expires in ${(data.untilExpiry / 60000).toFixed(2)} mins (${(data.untilExpiry / 1000).toFixed(0)} secs)`,
      );
    }
  }

  function updateOkta() {
    if (!refs.oktaClaims) return;
    const { exp, iat } = refs.oktaClaims;
    if (typeof exp === "number") {
      const remaining = exp * 1000 - Date.now();
      refs.oktaExpires.textContent = formatDuration(remaining);
      refs.oktaExpires.style.color = accentFor(remaining);
    } else {
      refs.oktaExpires.textContent = "Unknown";
      refs.oktaExpires.style.color = GREY;
    }
    if (typeof iat === "number") {
      refs.oktaIssued.textContent = relativeTime(iat * 1000);
      refs.oktaIssued.style.color = BLUE;
    } else {
      refs.oktaIssued.textContent = "Unknown";
      refs.oktaIssued.style.color = GREY;
    }
  }

  // Merchant and Okta values are part of the structure signature, so a change
  // there rebuilds the tab; only storage values move underneath a built view.
  function updateStorage() {
    for (const [kind, storage] of [
      ["local", localStorage],
      ["session", sessionStorage],
    ]) {
      if (!storageExpanded[kind]) continue;
      for (const [key, { entry, hint, body }] of refs.storage[kind]) {
        const raw = storage.getItem(key);
        hint.textContent = entry.open ? "" : ` ${preview(raw)}`;
        if (entry.open && body.dataset.editing !== "true") {
          if (body.dataset.raw !== raw)
            renderValue(body, raw, storage, key);
          else updateRelativeTimes(body);
        }
      }
    }
  }

  function render() {
    if (!overlay.isConnected) {
      document.body.appendChild(overlay);
      applyGeometry();
    }
    const data = collect();
    const key = structureSignature(data);
    if (built !== key) {
      build(data, key);
      applyGeometry();
    }
    if (mode !== "panel" || activeTab === "Terminal")
      updateVirtualTerminal(data);
    else if (activeTab === "Okta") updateOkta();
    else if (activeTab === "Cache") updateStorage();
  }

  render();
  setInterval(render, TICK_MS);
})();
