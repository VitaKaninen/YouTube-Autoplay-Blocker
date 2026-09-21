// ==UserScript==
// @name         YouTube Autoplay Blocker
// @namespace    https://github.com/VitaKaninen
// @version      0.1.0
// @description  Stops YouTube from starting a video you did not ask for. A video may play only after you clicked the player or a thumbnail, or pressed a play key; anything else that calls play() is paused again immediately. Covers next-video autoplay, playlists, and (optionally) the first video on a fresh page load.
// @author       VitaKaninen
// @match        *://*.youtube.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_unregisterMenuCommand
// @downloadURL  https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// @updateURL    https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "settings";
  const DEFAULTS = {
    blockOnPageLoad: true,   // also block the first video after a full load / reload
    keyboardIsIntent: true,  // Space / k / MediaPlayPause count as "the user wants this"
    log: false,
  };
  const INTENT_SELECTOR = "#movie_player, ytd-thumbnail, ytd-playlist-panel-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, a[href*='/watch'], a[href*='/shorts/']";
  const PLAY_KEYS = new Set([" ", "k", "K", "MediaPlayPause"]);

  let cfg = Object.assign({}, DEFAULTS, readSettings());
  let userWantsPlay = false;
  let currentVideoId = null;
  let video = null;
  let firstVideo = true;
  const menuIds = [];

  function readSettings() {
    try {
      return JSON.parse(GM_getValue(STORE_KEY, "{}"));
    } catch (e) {
      console.warn("[Autoplay Blocker] settings unreadable, using defaults", e);
      return {};
    }
  }

  function saveSettings() {
    GM_setValue(STORE_KEY, JSON.stringify(cfg));
  }

  function log(...args) {
    if (cfg.log) console.log("[Autoplay Blocker]", ...args);
  }

  function videoIdFromUrl() {
    const m = location.pathname.match(/^\/shorts\/([^/?]+)/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get("v");
  }

  // Forget the intent flag whenever the watch target changes.
  function syncVideo() {
    const id = videoIdFromUrl();
    const el = document.querySelector("video.html5-main-video");
    const changed = (id !== null && id !== currentVideoId) || (el && el !== video);
    if (!changed) return;
    log("new video", id);
    userWantsPlay = firstVideo && !cfg.blockOnPageLoad;
    firstVideo = false;
    currentVideoId = id;
    if (el && el !== video) {
      video = el;
      hookVideo(el);
    }
  }

  // Pause any play() the user did not ask for.
  function hookVideo(el) {
    if (el.dataset.autoplayBlockerHooked) return;
    el.dataset.autoplayBlockerHooked = "1";
    el.addEventListener("play", () => {
      if (userWantsPlay) return;
      log("blocked play");
      el.pause();
    });
  }

  function grantIntent(reason) {
    if (!userWantsPlay) log("intent:", reason);
    userWantsPlay = true;
  }

  function isTextTarget(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(INTENT_SELECTOR)) grantIntent("mousedown");
  }, true);

  document.addEventListener("keydown", (e) => {
    if (!cfg.keyboardIsIntent || isTextTarget(e.target)) return;
    if (PLAY_KEYS.has(e.key)) grantIntent("key " + e.key);
  }, true);

  // ---- menu
  function buildMenu() {
    menuIds.splice(0).forEach((id) => GM_unregisterMenuCommand(id));
    const toggle = (label, key) => {
      menuIds.push(GM_registerMenuCommand(`${cfg[key] ? "☑" : "☐"} ${label}`, () => {
        cfg[key] = !cfg[key];
        saveSettings();
        buildMenu();
      }));
    };
    toggle("Block first video on page load", "blockOnPageLoad");
    toggle("Keyboard play counts as intent", "keyboardIsIntent");
    toggle("Console logging", "log");
  }
  buildMenu();

  new MutationObserver(syncVideo).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("yt-navigate-finish", syncVideo);
})();
