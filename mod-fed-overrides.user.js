// ==UserScript==
// @name        Module Federation Overrides
// @namespace   https://github.com/attn-xplor/userscripts
// @description Edits the Native Federation remote overrides. Also available as the NF tab in Merchant Portal Debug Overlay.
// @match       https://*.clearent.net/*
// @match       http://localhost:4200/*
// @grant       GM.registerMenuCommand
// @version     1.2.0
// @author      Ismael J Lopez
// @run-at      document-idle
// ==/UserScript==

'use strict';

const OVERRIDES_KEY = 'MOD_FED_APPLICATION_OVERRIDES';

// Local dev URLs for the remotes in merchant-host-ui's
// `public/federation.manifest.json`. The paths differ because each repo sets its
// own baseHref/deployUrl: merchant-main-ui serves under `/ui/main/`, the others
// serve from their dev-server root. `user-support` is listed with a blank URL
// until its local port is confirmed.
const LOCAL_REMOTES = {
  'merchant-main-ui': 'http://localhost:4201/ui/main/remoteEntry.json',
  'merchant-terminal-ui': 'http://localhost:4202/remoteEntry.json',
  'merchant-notifications-ui': 'http://localhost:4305/remoteEntry.json',
  'user-support': '',
};

GM.registerMenuCommand('Edit MFE overrides', showModal);

// What the host booted with. It reads this key during pre-bootstrap, long before
// document-idle, so anything changed from here on only lands on the next load.
const bootOverrides = readOverrides();

seedMissingEntries();

function readOverrides() {
  const raw = localStorage.getItem(OVERRIDES_KEY);
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed;
    }
  } catch {
    // Fall through: the host ignores a malformed value, so replacing it cannot
    // lose anything it was actually honoring.
  }

  console.warn(`[ModFedOverrides] Replacing malformed ${OVERRIDES_KEY}.`);
  return {};
}

function writeOverrides(overrides) {
  // Pretty-printed so the value stays readable when edited by hand.
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides, null, 2));
}

function isComplete(entry) {
  return (
    !!entry &&
    typeof entry === 'object' &&
    typeof entry.url === 'string' &&
    typeof entry.enabled === 'boolean'
  );
}

function urlFor(name, entry) {
  if (typeof entry?.url === 'string') {
    return entry.url;
  }
  return LOCAL_REMOTES[name] ?? '';
}

function entryNames(overrides) {
  return [...new Set([...Object.keys(LOCAL_REMOTES), ...Object.keys(overrides)])];
}

function isKnownRemote(name) {
  return Object.hasOwn(LOCAL_REMOTES, name);
}

// Adds whatever is missing without touching entries that are already well
// formed, so a hand-edited URL or an enabled remote survives.
function seedMissingEntries() {
  const overrides = readOverrides();
  const added = [];

  for (const name of Object.keys(LOCAL_REMOTES)) {
    if (isComplete(overrides[name])) {
      continue;
    }
    overrides[name] = {
      url: urlFor(name, overrides[name]),
      enabled: overrides[name]?.enabled === true,
    };
    added.push(name);
  }

  if (added.length) {
    writeOverrides(overrides);
    console.debug(`[ModFedOverrides] Seeded disabled entries: ${added.join(', ')}`);
  }
}

function showModal() {
  const overrides = readOverrides();
  const staged = new Map(
    entryNames(overrides).map(name => [
      name,
      {
        url: urlFor(name, overrides[name]),
        enabled: overrides[name]?.enabled === true,
      },
    ]),
  );

  const dialog = document.createElement('dialog');
  dialog.style.cssText = 'min-width: 28em; max-width: 90vw; max-height: 80vh; padding: 1em; border: none; box-shadow: 0px 5px 35px 10px #0000007f; border-radius: 5px;';

  const hint = document.createElement('p');
  hint.textContent = 'Enabled MFEs load from your local dev server. Changes take effect on the next page load.';
  hint.style.cssText = 'margin: 0 0 0.75em; max-width: 36em;';

  const list = document.createElement('div');
  list.style.cssText = 'display: flex; flex-direction: column; gap: 0.5em; margin-bottom: 0.75em;';

  const rows = new Map();

  function addRow(name) {
    const entry = staged.get(name);
    const row = document.createElement('div');
    row.style.cssText = 'display: grid; grid-template-columns: auto 1fr auto; gap: 0.5em; align-items: start;';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = entry.enabled;
    checkbox.style.cssText = 'margin-top: 0.2em;';
    checkbox.onchange = () => {
      staged.get(name).enabled = checkbox.checked;
      updateWarning();
    };

    const fields = document.createElement('div');
    fields.style.cssText = 'display: flex; flex-direction: column; gap: 0.2em; min-width: 0;';

    const nameLabel = document.createElement('span');
    nameLabel.textContent = name;

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.value = entry.url;
    urlInput.placeholder = 'http://localhost:NNNN/remoteEntry.json';
    urlInput.style.cssText = 'width: 100%; box-sizing: border-box; font-family: monospace; font-size: 0.85em;';
    urlInput.oninput = () => {
      staged.get(name).url = urlInput.value.trim();
      updateWarning();
    };

    fields.append(nameLabel, urlInput);

    const removeButton = document.createElement('button');
    removeButton.type = 'button';
    removeButton.textContent = 'Remove';
    removeButton.hidden = isKnownRemote(name);
    removeButton.onclick = () => {
      staged.delete(name);
      rows.delete(name);
      row.remove();
      updateWarning();
    };

    row.append(checkbox, fields, removeButton);
    list.appendChild(row);
    rows.set(name, { checkbox, urlInput });
  }

  for (const name of staged.keys()) {
    addRow(name);
  }

  const addRowWrap = document.createElement('div');
  addRowWrap.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr auto; gap: 0.5em; align-items: center; margin-bottom: 0.75em;';

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.placeholder = 'MFE name';
  nameInput.style.cssText = 'box-sizing: border-box;';

  const urlInput = document.createElement('input');
  urlInput.type = 'url';
  urlInput.placeholder = 'http://localhost:NNNN/remoteEntry.json';
  urlInput.style.cssText = 'box-sizing: border-box; font-family: monospace;';

  const addButton = document.createElement('button');
  addButton.type = 'button';
  addButton.textContent = 'Add';

  function addCustomEntry() {
    const name = nameInput.value.trim();
    const url = urlInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    if (staged.has(name)) {
      alert(`An entry named "${name}" already exists.`);
      nameInput.focus();
      return;
    }
    staged.set(name, { url, enabled: false });
    addRow(name);
    nameInput.value = '';
    urlInput.value = '';
    nameInput.focus();
    updateWarning();
  }

  addButton.onclick = addCustomEntry;
  nameInput.onkeydown = urlInput.onkeydown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addCustomEntry();
    }
  };

  addRowWrap.append(nameInput, urlInput, addButton);

  const warning = document.createElement('p');
  warning.style.cssText = 'margin: 0 0 0.75em; max-width: 36em; color: #9a6700;';

  function updateWarning() {
    const messages = [];
    const enabledWithoutUrl = [...staged.entries()]
      .filter(([, entry]) => entry.enabled && !entry.url)
      .map(([name]) => name);
    if (enabledWithoutUrl.length) {
      messages.push(`Enabled without a URL: ${enabledWithoutUrl.join(', ')}.`);
    }
    // An HTTPS page loading an http://localhost remote is mixed content, which
    // Chromium blocks outright.
    const mixed =
      location.protocol === 'https:' &&
      [...staged.values()].some(entry => entry.enabled && entry.url.startsWith('http://'));
    if (mixed) {
      messages.push('This page is HTTPS, so http://localhost remotes may be blocked as mixed content.');
    }
    warning.textContent = messages.join(' ');
  }

  updateWarning();

  const cancelButton = document.createElement('button');
  cancelButton.textContent = 'Cancel';

  const saveButton = document.createElement('button');
  saveButton.textContent = 'Save';

  const buttons = document.createElement('div');
  buttons.style.cssText = 'display: flex; gap: 0.5em; justify-content: flex-end;';
  buttons.append(cancelButton, saveButton);

  dialog.append(hint, list, addRowWrap, warning, buttons);
  document.body.appendChild(dialog);

  const save = () => {
    const enabledWithoutUrl = [...staged.entries()]
      .filter(([, entry]) => entry.enabled && !entry.url)
      .map(([name]) => name);
    if (enabledWithoutUrl.length) {
      alert(`Cannot enable an MFE without a URL: ${enabledWithoutUrl.join(', ')}`);
      return;
    }

    // Re-read so saving does not clobber an edit made in another tab or in
    // devtools while this dialog was open, then replace with the staged set
    // so removed custom entries actually go away.
    const updated = readOverrides();
    for (const name of Object.keys(updated)) {
      if (!isKnownRemote(name) && !staged.has(name)) {
        delete updated[name];
      }
    }
    for (const [name, entry] of staged) {
      updated[name] = { url: entry.url, enabled: entry.enabled };
    }
    writeOverrides(updated);
    dialog.close();

    const needsReload = [...staged.keys()].some(name => {
      const next = staged.get(name);
      const boot = bootOverrides[name];
      return next.enabled !== (boot?.enabled === true) || next.url !== (boot?.url ?? urlFor(name));
    }) || Object.keys(bootOverrides).some(name => !staged.has(name) && !isKnownRemote(name));
    if (needsReload && confirm('Reload now to apply the changed overrides?')) {
      location.reload();
    }
  };

  cancelButton.onclick = () => dialog.close();
  saveButton.onclick = save;

  dialog.onkeydown = (event) => {
    if (event.key === 's' && event.ctrlKey) {
      event.preventDefault();
      save();
    }
  };

  // Covers Escape, the Cancel button, and anything else that dismisses the dialog.
  dialog.onclose = () => dialog.remove();

  dialog.showModal();
}
