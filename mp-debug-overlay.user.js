// ==UserScript==
// @name         Merchant Portal Debug Overlay
// @namespace    https://github.com/attn-xplor/userscripts
// @version      1.0.4
// @description  Live stats overlay showing debug information. For example, information pertaining to the selected terminal's vt token.
// @author       Ismael J Lopez
// @match        http://localhost:4200/ui/*
// @match        https://*.clearent.net/ui/*
// @run-at       document-idle
// @grant        none
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

  const POS_KEY = "xplor.debug.overlay.position";
  const MODE_KEY = "xplor.debug.overlay.mode";
  const MODES = ["compact", "detail", "panel"];
  const DRAG_THRESHOLD_PX = 4;
  const TERMINAL_LIST_MAX_HEIGHT_PX = 180;
  const LOG_TO_CONSOLE = false;

  const GREEN = "#7bdcb5";
  const AMBER = "#ffd166";
  const RED = "#ff6b6b";
  const GREY = "#8a8a94";

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

  function readTerminals() {
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      const match = TERMINALS_KEY_PATTERN.exec(key);
      if (!match) continue;
      const item = parseItem(sessionStorage, key);
      if (!Array.isArray(item?.response) || typeof item.updatedAt !== "number")
        continue;
      return { hnk: match[1], updatedAt: item.updatedAt, list: item.response };
    }
    return null;
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
    const item = legacyItem(
      sessionStorage,
      LEGACY_SESSION_KEY,
      LEGACY_TERMINALS_ITEM,
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
    const item = legacyItem(
      localStorage,
      LEGACY_LOCAL_KEY,
      LEGACY_SELECTED_ITEM,
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

  function formatDuration(ms) {
    const negative = ms < 0;
    const total = Math.floor(Math.abs(ms) / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return `${negative ? "-" : ""}${minutes}:${String(seconds).padStart(2, "0")}`;
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
      legacy: compareLegacy(cache, terminal),
      label:
        terminal.terminalName || terminal.syntheticTerminalId || "(unnamed)",
    };
  }

  const overlay = document.createElement("div");
  overlay.id = "xplor-mp-debug-overlay";
  overlay.style.cssText = [
    "position:fixed",
    "top:8px",
    "left:50%",
    "transform:translateX(-50%)",
    "z-index:2147483647",
    "padding:6px 12px",
    "font:12px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace",
    "color:#fff",
    "background:rgba(20,20,24,.9)",
    "box-shadow:0 2px 10px rgba(0,0,0,.4)",
    "cursor:grab",
    "user-select:none",
    "touch-action:none",
  ].join(";");
  overlay.title = "Debug Overlay — drag to move, click to toggle views";

  let mode = MODES.includes(localStorage.getItem(MODE_KEY))
    ? localStorage.getItem(MODE_KEY)
    : "compact";
  let terminalsExpanded = false;

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

  let drag = null;
  overlay.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
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
    mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
    localStorage.setItem(MODE_KEY, mode);
    render();
  }

  overlay.addEventListener("pointerup", endDrag);
  overlay.addEventListener("pointercancel", endDrag);
  window.addEventListener("resize", restorePosition);

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

  function makeRow(parent, label) {
    const row = document.createElement("div");
    row.style.cssText =
      "display:flex;gap:12px;justify-content:space-between;align-items:baseline";
    const name = document.createElement("span");
    name.style.cssText = "opacity:.6";
    name.textContent = label;
    const value = document.createElement("span");
    row.append(name, value);
    parent.appendChild(row);
    return value;
  }

  // Views are rebuilt only when their structure changes; each tick just
  // rewrites the text of the cached refs so selection and layout stay stable.
  let built = null;
  let refs = {};

  function buildInline(kind) {
    overlay.style.borderRadius = "999px";
    overlay.style.whiteSpace = "nowrap";
    overlay.replaceChildren();
    // Inline (not flex) layout: flex items trim their own leading and trailing
    // whitespace, which would eat the spaces around the separators below.
    const wrap = document.createElement("div");
    wrap.style.cssText = "white-space:pre";
    refs.dot = makeDot();
    refs.dot.style.cssText += ";vertical-align:middle;margin-right:8px";
    wrap.appendChild(refs.dot);

    refs.expires = document.createElement("span");
    refs.stale = document.createElement("span");

    if (kind === "compact") {
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

  function buildCompact() {
    buildInline("compact");
  }

  function buildDetail() {
    buildInline("detail");
  }

  function buildPanel(data) {
    overlay.style.borderRadius = "10px";
    overlay.style.whiteSpace = "normal";
    overlay.replaceChildren();

    const panel = document.createElement("div");
    panel.style.cssText =
      "display:flex;flex-direction:column;gap:3px;min-width:260px";

    const header = document.createElement("div");
    header.style.cssText =
      "display:flex;gap:8px;align-items:center;margin-bottom:2px";
    refs.dot = makeDot();
    refs.selected = document.createElement("span");
    header.append(refs.dot, refs.selected);
    panel.appendChild(header);

    const terminalsRow = document.createElement("div");
    terminalsRow.style.cssText =
      "display:flex;gap:12px;justify-content:space-between;align-items:baseline";
    const terminalsLabel = document.createElement("span");
    terminalsLabel.style.cssText = "opacity:.6";
    terminalsLabel.textContent = "Terminals:";
    refs.terminalsToggle = document.createElement("span");
    refs.terminalsToggle.setAttribute("data-no-drag", "");
    refs.terminalsToggle.style.cssText =
      "cursor:pointer;text-decoration:underline dotted";
    refs.terminalsToggle.addEventListener("click", () => {
      terminalsExpanded = !terminalsExpanded;
      render();
    });
    terminalsRow.append(terminalsLabel, refs.terminalsToggle);
    panel.appendChild(terminalsRow);

    if (terminalsExpanded) {
      const list = document.createElement("div");
      // Dragging is suppressed inside the list so a touch swipe scrolls it
      // instead of moving the overlay, and the page keeps its own scroll
      // position once the list reaches either end.
      list.setAttribute("data-no-drag", "");
      list.style.cssText = [
        "display:flex",
        "flex-direction:column",
        "gap:2px",
        "padding:2px 0 2px 10px",
        "opacity:.85",
        `max-height:${TERMINAL_LIST_MAX_HEIGHT_PX}px`,
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
      panel.appendChild(list);
    }

    refs.expires = makeRow(panel, "Expires:");
    refs.stale = makeRow(panel, "Stale:");
    refs.age = makeRow(panel, "Age:");

    const legacyHeader = document.createElement("div");
    legacyHeader.style.cssText = "opacity:.6;margin-top:4px";
    legacyHeader.textContent = "Matches in Legacy Cache:";
    panel.appendChild(legacyHeader);

    const legacyList = document.createElement("div");
    legacyList.style.cssText =
      "display:flex;flex-direction:column;gap:2px;padding-left:10px";
    refs.legacyRows = LEGACY_CHECKS.map(({ label, storage }) =>
      makeRow(legacyList, `${label} (${storage}):`),
    );
    panel.appendChild(legacyList);

    overlay.appendChild(panel);
  }

  function signature(data) {
    if (!data) return `${mode}|empty`;
    return `${mode}|${terminalsExpanded}|${terminalIds(data.cache.list)}`;
  }

  function renderEmpty() {
    if (built !== `${mode}|empty`) {
      overlay.style.borderRadius = "999px";
      overlay.style.whiteSpace = "nowrap";
      overlay.replaceChildren();
      const wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:8px;align-items:center";
      refs.dot = makeDot();
      refs.text = document.createElement("span");
      refs.text.textContent = "No Cached Terminals";
      wrap.append(refs.dot, refs.text);
      overlay.appendChild(wrap);
      built = `${mode}|empty`;
    }
    refs.dot.style.background = GREY;
  }

  function render() {
    if (!overlay.isConnected) {
      document.body.appendChild(overlay);
      restorePosition();
    }

    const data = collect();
    if (!data) {
      renderEmpty();
      return;
    }

    const key = signature(data);
    if (built !== key) {
      if (mode === "panel") buildPanel(data);
      else if (mode === "detail") buildDetail();
      else buildCompact();
      built = key;
    }

    const accent = accentFor(data.untilExpiry);
    refs.dot.style.background = accent;

    if (mode === "compact") {
      refs.expires.textContent = formatDuration(data.untilExpiry);
      refs.expires.style.color = accent;
      refs.stale.textContent = formatDuration(data.untilStale);
      refs.stale.style.color = accentFor(data.untilStale);
    } else if (mode === "detail") {
      refs.label.textContent = data.label;
      refs.expires.textContent = formatDuration(data.untilExpiry);
      refs.expires.style.color = accent;
      refs.stale.textContent = formatDuration(data.untilStale);
      refs.stale.style.color = accentFor(data.untilStale);
      refs.age.textContent = formatDuration(data.age);
      refs.reason.textContent = data.reason ? ` · ${data.reason}` : "";
    } else {
      refs.selected.textContent = `Selected: ${data.label}`;
      refs.terminalsToggle.textContent = `${terminalsExpanded ? "▾" : "▸"} ${data.cache.list.length}`;
      refs.expires.textContent = formatDuration(data.untilExpiry);
      refs.expires.style.color = accent;
      refs.stale.textContent = formatDuration(data.untilStale);
      refs.stale.style.color = accentFor(data.untilStale);
      refs.age.textContent = formatDuration(data.age);
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

  render();
  setInterval(render, TICK_MS);
})();
