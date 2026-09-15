// ==UserScript==
// @name        Cache Utilities (Deprecated)
// @namespace   https://github.com/attn-xplor/userscripts
// @description Deprecated: use the Cache tab in Merchant Portal Debug Overlay.
// @match       https://my*.clearent.net/ui/*
// @match       http://localhost:4200/*
// @grant       GM.registerMenuCommand
// @grant       GM.getValue
// @grant       GM.setValue
// @version     1.5.0
// @author      Ismael Lopez
// ==/UserScript==

const CUSTOM_EXCLUSIONS_KEY = 'CACHE_UTILS_EXCLUSIONS';
const DEFAULT_EXCLUSIONS = [
  'MOD_FED_APPLICATION_OVERRIDES',
  'TanstackQueryDevtools.open',
  'TanstackQueryDevtools.pip_open',
  'TanstackQueryDevtools.theme_preference',
  'xplor.debug.overlay.position',
  'xplor.debug.overlay.mode',
  'xplor.debug.overlay.tab',
  'xplor.debug.overlay.font',
];

GM.registerMenuCommand('Clear Session', () => {
  sessionStorage.clear();
});

GM.registerMenuCommand('Clear Local', clearLocalCache);

GM.registerMenuCommand('Clear All', async () => {
  sessionStorage.clear();
  await clearLocalCache();
});

GM.registerMenuCommand('Edit Local Exclusions', editLocalExclusions);

async function getCustomExclusions() {
  const exclusions = await GM.getValue(CUSTOM_EXCLUSIONS_KEY, []);
  return Array.isArray(exclusions) ? exclusions : [];
}

async function editLocalExclusions() {
  const exclusions = await getCustomExclusions();
  const value = await showExclusionsEditor(exclusions.join('\n'));

  if (value === null) {
    return;
  }

  const updatedExclusions = [
    ...new Set(value.split('\n').map(key => key.trim()).filter(Boolean)),
  ];
  await GM.setValue(CUSTOM_EXCLUSIONS_KEY, updatedExclusions);
}

function showExclusionsEditor(initialValue) {
  return new Promise(resolve => {
    const dialog = document.createElement('dialog');
    dialog.style.cssText = 'width: 50vw; max-height: 80vh; padding: 1em; border: none; box-shadow: 0px 5px 35px 10px #0000007f; border-radius: 5px;';

    const hint = document.createElement('p');
    hint.textContent = 'One localStorage key per line. These keys are preserved when clearing the local cache.';
    hint.style.cssText = 'margin: 0 0 0.5em;';

    const textarea = document.createElement('textarea');
    textarea.value = initialValue;
    textarea.spellcheck = false;
    textarea.rows = 10;
    textarea.style.cssText = 'width: 100%; box-sizing: border-box; margin-bottom: 0.5em; font-family: monospace; border-radius: 5px;';

    const cancelButton = document.createElement('button');
    cancelButton.textContent = 'Cancel';

    const saveButton = document.createElement('button');
    saveButton.textContent = 'Save';

    const buttons = document.createElement('div');
    buttons.style.cssText = 'display: flex; gap: 0.5em; justify-content: flex-end;';
    buttons.append(cancelButton, saveButton);

    dialog.append(hint, textarea, buttons);
    document.body.appendChild(dialog);

    const save = () => {
      resolve(textarea.value);
      dialog.close();
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
    dialog.onclose = () => {
      resolve(null);
      dialog.remove();
    };

    dialog.showModal();
    textarea.focus();
  });
}

async function clearLocalCache() {
  try {
    const exclusions = new Set([
      ...DEFAULT_EXCLUSIONS,
      ...await getCustomExclusions(),
    ]);

    const mem = [];
    for (const key of exclusions) {
      const value = localStorage.getItem(key);
      if (value !== null) {
        mem.push({key, value});
      }
    }

    localStorage.clear();

    for (const {key, value} of mem) {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    console.error(error);
  }
}