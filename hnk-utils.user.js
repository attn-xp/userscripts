// ==UserScript==
// @name        HNK Utilities
// @namespace   https://github.com/attn-xplor/userscripts
// @description Copies the selected merchant's DBA and HNK. Also available as the Merchant tab in Merchant Portal Debug Overlay.
// @match       https://my*.clearent.net/ui/*
// @match       http://localhost:4200/*
// @grant       GM.registerMenuCommand
// @grant       GM.setClipboard
// @version     1.3
// @author      Ismael J Lopez
// ==/UserScript==

// Host UI writes the selected HNK as a plain string and the default list as JSON.
// See MerchantService / MerchantSearchService (`xplor.${username}.*`).
const CURRENT_MERCHANT_KEY = /^xplor\.(.+)\.current\.merchant$/;
const merchantsKey = (user) => `xplor.${user}.merchants`;
const LEGACY_LOCAL_KEY = 'CACHED_LOCAL_STORAGE_SERVICE_DATA';
const LEGACY_SELECTED = 'selectedMerchant';
const SEARCH_PLACEHOLDER = 'Search by Business Name or Merchant ID';

function parseJson(raw) {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function fromXplorCache() {
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    const match = CURRENT_MERCHANT_KEY.exec(key);
    if (!match) continue;
    const hnk = localStorage.getItem(key);
    if (!hnk) continue;
    const list = parseJson(localStorage.getItem(merchantsKey(match[1])));
    const found = Array.isArray(list)
      ? list.find((m) => m?.merchantNumber === hnk)
      : null;
    return { dba: found?.merchantName || '', hnk };
  }
  return null;
}

function fromLegacyCache() {
  const all = parseJson(localStorage.getItem(LEGACY_LOCAL_KEY));
  if (!Array.isArray(all)) return null;
  const item = all.find((e) => e?.itemName === LEGACY_SELECTED);
  const merchant = item?.dataObject;
  if (!merchant) return null;
  return {
    dba: merchant.merchantName || '',
    hnk: merchant.merchantNumber || '',
  };
}

function parseLabel(text) {
  const trimmed = (text || '').trim();
  if (!trimmed) return null;
  const parts = trimmed.split(' - ');
  if (parts.length === 1) return { dba: '', hnk: parts[0] };
  return { dba: parts.slice(0, -1).join(' - '), hnk: parts.at(-1) };
}

function fromDom() {
  const input = document.querySelector('merchant-selector input');
  if (input) {
    const placeholder = (input.getAttribute('placeholder') || '').trim();
    if (placeholder && placeholder !== SEARCH_PLACEHOLDER) {
      const parsed = parseLabel(placeholder);
      if (parsed?.hnk) return parsed;
    }
  }
  const el = document.getElementById('merchantData');
  if (el?.textContent) return parseLabel(el.textContent);
  return null;
}

function getMerchant() {
  const sources = [fromXplorCache(), fromLegacyCache(), fromDom()];
  const hnk = sources.find((s) => s?.hnk)?.hnk || '';
  const dba =
    sources.find((s) => s?.dba && (!hnk || !s.hnk || s.hnk === hnk))?.dba || '';
  return { dba, hnk };
}

GM.registerMenuCommand('Copy DBA', () => {
  const { dba } = getMerchant();
  if (!dba) {
    alert('Could not get DBA');
    return;
  }
  GM.setClipboard(dba);
});

GM.registerMenuCommand('Copy HNK', () => {
  const { hnk } = getMerchant();
  if (!hnk) {
    alert('Could not get HNK');
    return;
  }
  GM.setClipboard(hnk);
});

GM.registerMenuCommand('Copy DBA & HNK', () => {
  const { dba, hnk } = getMerchant();
  if (!dba && !hnk) {
    alert('Could not get DBA or HNK');
    return;
  }
  const parts = [];
  if (dba) parts.push(dba);
  if (hnk) parts.push('`' + hnk + '`');
  GM.setClipboard(parts.join(' - '));
});
