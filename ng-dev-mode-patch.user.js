// ==UserScript==
// @name        ngDevMode Patch
// @namespace   https://github.com/attn-xplor/userscripts
// @description Defines window.ngDevMode before the app boots. Also available as the Angular tab in Merchant Portal Debug Overlay.
// @match       https://*.clearent.net/*
// @match       http://localhost:4200/*
// @version     1.0.0
// @author      Ismael J Lopez
// @run-at      document-start
// ==/UserScript==

"use strict";

unsafeWindow.ngDevMode ??= {};
