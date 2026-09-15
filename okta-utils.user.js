// ==UserScript==
// @name        Okta Utilities (Deprecated)
// @namespace   https://github.com/attn-xplor/userscripts
// @description Deprecated: use the Okta tab in Merchant Portal Debug Overlay.
// @match       https://my*.clearent.net/ui/*
// @match       http://localhost:4200/*
// @grant       GM.registerMenuCommand
// @grant       GM.setClipboard
// @version     1.3
// @author      Ismael Lopez
// ==/UserScript==

GM.registerMenuCommand('Copy Access Token', () => {
  const key = (window.location.hostname === 'my.clearent.net')
    ? 'oidc.user:https://auth.clearent.net/oauth2/aus4ulyubshD7M0yf697:0oa6ggt30dFSxSVxX697'
    : 'oidc.user:https://auth-sb.clearent.net/oauth2/aus3a1kavt9qzEcsz1d7:0oa3a1ic7mGSRLqrZ1d7';
  const value = sessionStorage.getItem(key);
  if (!value) {
    alert(`Key '${key}' not found in session storage`);
    return;
  }
  GM.setClipboard(JSON.parse(value).access_token);
});