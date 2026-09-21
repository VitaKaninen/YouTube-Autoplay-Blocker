// ==UserScript==
// @name         YouTube Autoplay Blocker
// @namespace    https://github.com/VitaKaninen
// @version      0.10.0
// @description  Stops YouTube from starting a video you did not ask for. A video may play only after you clicked the player or a thumbnail, or pressed a play key; any other play() call is refused before it starts (or paused again immediately as a fallback). While a requested play is still waiting for data, a second click or play key cancels it (YouTube itself would just request play again); a badge shows whether the pending state is play or pause.
// @author       VitaKaninen
// @match        *://*.youtube.com/*
// @run-at       document-start
// @noframes
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// @updateURL    https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "settings";
  const DEFAULTS = {
    queuedBadge: true,       // play / pause badge on the player while a request waits for data
  };
  const INTENT_SELECTOR = "#movie_player, ytd-thumbnail, ytd-playlist-panel-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, a[href*='/watch'], a[href*='/shorts/']";
  const PLAY_BUTTON_SELECTOR = ".ytp-play-button, .ytp-large-play-button, .html5-video-container";
  const PLAY_KEYS = new Set([" ", "k", "K", "MediaPlayPause"]);
  const BADGE_ID = "yt-autoplay-blocker-badge";
  const HTML = document.documentElement;
  // Runs in page context: refuses play() on the main video unless <html data-ytab-intent="1">.
  const GATE_SRC = `(() => {
    const proto = HTMLMediaElement.prototype, nativePlay = proto.play, html = document.documentElement;
    proto.play = function () {
      if (html.dataset.ytabIntent === "1" || !this.closest("#movie_player")) return nativePlay.apply(this, arguments);
      return Promise.reject(new DOMException("Autoplay blocked by YouTube Autoplay Blocker", "NotAllowedError"));
    };
    html.dataset.ytabGateInstalled = "1";
  })();`;

  let cfg = Object.assign({}, DEFAULTS, readSettings());
  let userWantsPlay = false;
  let currentVideoId = null;
  let video = null;
  let badgeState = null;  // null | "play" | "pause"
  let swallowClick = false;

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

  function videoIdFromUrl() {
    const m = location.pathname.match(/^\/shorts\/([^/?]+)/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get("v");
  }

  // ---- badge
  function badge(state) {
    badgeState = state;
    const old = document.getElementById(BADGE_ID);
    if (!state) { if (old) old.remove(); return; }
    if (!cfg.queuedBadge) return;
    const player = document.getElementById("movie_player");
    if (!player) return;
    const el = old || document.createElement("div");
    el.id = BADGE_ID;
    el.textContent = state === "play" ? "▶ play" : "⏸ pause";
    Object.assign(el.style, {
      position: "absolute", top: "12px", left: "12px", zIndex: "9999", pointerEvents: "none",
      padding: "4px 10px", borderRadius: "6px", font: "600 13px/1.4 Roboto, Arial, sans-serif",
      color: "#cdd6f4", background: "rgba(30,30,46,.85)",
      border: "1px solid " + (state === "play" ? "#89b4fa" : "#f9e2af"),
    });
    if (!old) player.appendChild(el);
  }

  // ---- play() gate
  function setIntent(v) {
    userWantsPlay = v;
    HTML.dataset.ytabIntent = v ? "1" : "0";
  }

  // Inject GATE_SRC into the page; a Trusted Types policy is needed where the CSP enforces one.
  function installPlayGate() {
    HTML.dataset.ytabIntent = "0";
    const s = document.createElement("script");
    try {
      s.textContent = GATE_SRC;
    } catch (e) {
      s.textContent = window.trustedTypes.createPolicy("yt-autoplay-blocker", { createScript: (x) => x }).createScript(GATE_SRC);
    }
    HTML.appendChild(s);
    s.remove();
    if (HTML.dataset.ytabGateInstalled !== "1") console.warn("[Autoplay Blocker] play() gate not installed; pause-after-play fallback only");
  }

  // ---- video hookup
  // Forget the intent flag whenever the watch target changes.
  function syncVideo() {
    const id = videoIdFromUrl();
    const el = document.querySelector("video.html5-main-video");
    const idChanged = id !== null && id !== currentVideoId;
    const elChanged = el && el !== video;
    if (idChanged || (elChanged && id === null)) {
      setIntent(false);
      currentVideoId = id;
      badge(null);
    }
    if (elChanged) {
      video = el;
      hookVideo(el);
    }
  }

  // Fallback: pause any play that slipped past the gate; drive the badge.
  function hookVideo(el) {
    if (el.dataset.autoplayBlockerHooked) return;
    el.dataset.autoplayBlockerHooked = "1";
    el.addEventListener("play", () => {
      if (userWantsPlay) { badge(el.readyState < 3 ? "play" : null); return; }
      el.pause();
    });
    el.addEventListener("playing", () => badge(null));
    el.addEventListener("pause", () => { if (badgeState === "play") badge(null); });
  }

  // A play request still waiting for data: YouTube treats every further click as "play" again.
  function isQueued() {
    return userWantsPlay && video && !video.paused && video.readyState < 3;
  }

  // Second click / key while queued: withdraw the request and keep the event from YouTube.
  function cancelQueued(e) {
    setIntent(false);
    video.pause();
    badge("pause");
    e.stopImmediatePropagation();
    e.preventDefault();
  }

  function isTextTarget(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  window.addEventListener("mousedown", (e) => {
    if (e.target.closest(PLAY_BUTTON_SELECTOR) && isQueued()) { swallowClick = true; cancelQueued(e); }
  }, true);
  for (const type of ["mouseup", "click"]) {
    window.addEventListener(type, (e) => {
      if (!swallowClick) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (type === "click") swallowClick = false;
    }, true);
  }

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(INTENT_SELECTOR)) setIntent(true);
  }, true);

  window.addEventListener("keydown", (e) => {
    if (isTextTarget(e.target) || !PLAY_KEYS.has(e.key)) return;
    if (isQueued()) { cancelQueued(e); return; }
    setIntent(true);
  }, true);

  // ---- menu
  function buildMenu() {
    const toggle = (label, key) => {
      GM_registerMenuCommand(`${cfg[key] ? "☑" : "☐"} ${label}`, () => {
        cfg[key] = !cfg[key];
        saveSettings();
        buildMenu();
      }, { id: key });
    };
    toggle("Show play / pause badge while waiting for data", "queuedBadge");
  }
  installPlayGate();
  buildMenu();

  new MutationObserver(syncVideo).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("yt-navigate-finish", syncVideo);
})();
