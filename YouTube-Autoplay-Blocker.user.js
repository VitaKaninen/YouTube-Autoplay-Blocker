// ==UserScript==
// @name         YouTube Autoplay Blocker
// @namespace    https://github.com/VitaKaninen
// @version      0.3.0
// @description  Stops YouTube from starting a video you did not ask for. A video may play only after you clicked the player or a thumbnail, or pressed a play key; anything else that calls play() is paused again immediately. Shows a "queued" badge while a requested play waits for data, and keeps a per-load timing log for comparing with/without blocking.
// @author       VitaKaninen
// @match        *://*.youtube.com/*
// @run-at       document-start
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @downloadURL  https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// @updateURL    https://raw.githubusercontent.com/VitaKaninen/YouTube-Autoplay-Blocker/main/YouTube-Autoplay-Blocker.user.js
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "settings";
  const TIMING_KEY = "timings";
  const TIMING_MAX = 100;
  const DEFAULTS = {
    enabled: true,           // master switch; timing log still records when off
    blockOnPageLoad: true,   // also block the first video after a full load / reload
    keyboardIsIntent: true,  // Space / k / MediaPlayPause count as "the user wants this"
    queuedBadge: true,       // "▶ queued" on the player while an accepted play() waits for data
    log: false,
  };
  const INTENT_SELECTOR = "#movie_player, ytd-thumbnail, ytd-playlist-panel-video-renderer, ytd-compact-video-renderer, ytd-rich-item-renderer, a[href*='/watch'], a[href*='/shorts/']";
  const PLAY_BUTTON_SELECTOR = ".ytp-play-button, .ytp-large-play-button, .html5-video-container";
  const PLAY_KEYS = new Set([" ", "k", "K", "MediaPlayPause"]);
  const BADGE_ID = "yt-autoplay-blocker-badge";

  let cfg = Object.assign({}, DEFAULTS, readSettings());
  let userWantsPlay = false;
  let currentVideoId = null;
  let video = null;
  let firstVideo = true;
  let rec = null;         // timing record for the current video
  let navStart = 0;       // performance.now() at the start of the current navigation

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

  function now() {
    return Math.round(performance.now() - navStart);
  }

  function log(...args) {
    if (cfg.log) console.log(`[Autoplay Blocker ${now()}ms]`, ...args);
  }

  function videoIdFromUrl() {
    const m = location.pathname.match(/^\/shorts\/([^/?]+)/);
    if (m) return m[1];
    return new URLSearchParams(location.search).get("v");
  }

  // ---- timing log
  function readTimings() {
    try { return JSON.parse(GM_getValue(TIMING_KEY, "[]")); } catch (e) { return []; }
  }

  function startRecord(id) {
    rec = {
      when: new Date().toISOString().slice(0, 19).replace("T", " "),
      video: id,
      blocking: cfg.enabled,
      spa: !firstVideo,
      playerMs: null, firstAutoPlayMs: null, clickMs: null, loadstartMs: null, metaMs: null,
      mediaReqMs: null, mediaRespMs: null, canplayMs: null, playingMs: null,
      clicks: 0, blocked: 0,
    };
  }

  function mark(field, value) {
    if (rec && rec[field] === null) {
      rec[field] = value === undefined ? now() : value;
      if (field === "playingMs") flushRecord();
    }
  }

  function flushRecord() {
    const list = readTimings();
    list.push(rec);
    while (list.length > TIMING_MAX) list.shift();
    GM_setValue(TIMING_KEY, JSON.stringify(list));
  }

  function printTimings() {
    const list = readTimings();
    if (!list.length) { console.log("[Autoplay Blocker] no timings recorded yet"); return; }
    console.table(list);
    const summarise = (rows, label) => {
      if (!rows.length) return;
      const med = (k) => {
        const v = rows.map((r) => r[k]).filter((x) => x !== null).sort((a, b) => a - b);
        return v.length ? v[Math.floor(v.length / 2)] : "-";
      };
      console.log(`${label}: n=${rows.length}  median player=${med("playerMs")}  click=${med("clickMs")}  loadstart=${med("loadstartMs")}  mediaReq=${med("mediaReqMs")}  mediaResp=${med("mediaRespMs")}  meta=${med("metaMs")}  canplay=${med("canplayMs")}  playing=${med("playingMs")}`);
    };
    summarise(list.filter((r) => r.blocking && !r.spa), "blocking ON, full load ");
    summarise(list.filter((r) => !r.blocking && !r.spa), "blocking OFF, full load");
    summarise(list.filter((r) => r.blocking && r.spa), "blocking ON, SPA nav   ");
    summarise(list.filter((r) => !r.blocking && r.spa), "blocking OFF, SPA nav  ");
  }

  // ---- queued badge
  function badge(show) {
    const old = document.getElementById(BADGE_ID);
    if (!show) { if (old) old.remove(); return; }
    if (old || !cfg.queuedBadge) return;
    const player = document.getElementById("movie_player");
    if (!player) return;
    const el = document.createElement("div");
    el.id = BADGE_ID;
    el.textContent = "▶ queued";
    Object.assign(el.style, {
      position: "absolute", top: "12px", left: "12px", zIndex: "9999", pointerEvents: "none",
      padding: "4px 10px", borderRadius: "6px", font: "600 13px/1.4 Roboto, Arial, sans-serif",
      color: "#cdd6f4", background: "rgba(30,30,46,.85)", border: "1px solid #89b4fa",
    });
    player.appendChild(el);
  }

  // ---- video hookup
  // Forget the intent flag whenever the watch target changes.
  function syncVideo() {
    const id = videoIdFromUrl();
    const el = document.querySelector("video.html5-main-video");
    const idChanged = id !== null && id !== currentVideoId;
    const elChanged = el && el !== video;
    if (idChanged || (elChanged && id === null)) {
      log("new video", id, el ? "(element)" : "(no element yet)");
      userWantsPlay = !cfg.enabled || (firstVideo && !cfg.blockOnPageLoad);
      startRecord(id);
      firstVideo = false;
      currentVideoId = id;
      badge(false);
    }
    if (elChanged) {
      video = el;
      hookVideo(el);
    }
    if (el) mark("playerMs");
  }

  // Pause any play() the user did not ask for; record the lifecycle.
  function hookVideo(el) {
    if (el.dataset.autoplayBlockerHooked) return;
    el.dataset.autoplayBlockerHooked = "1";
    el.addEventListener("play", () => {
      log("play event, readyState", el.readyState);
      if (userWantsPlay) { if (el.readyState < 3) badge(true); return; }
      mark("firstAutoPlayMs");
      if (rec) rec.blocked++;
      log("blocked play");
      el.pause();
    });
    el.addEventListener("loadstart", () => { log("loadstart"); mark("loadstartMs"); });
    el.addEventListener("loadedmetadata", () => { log("loadedmetadata"); mark("metaMs"); });
    el.addEventListener("canplay", () => { log("canplay"); mark("canplayMs"); });
    el.addEventListener("playing", () => { log("playing"); mark("playingMs"); badge(false); });
    el.addEventListener("pause", () => { log("pause event"); badge(false); });
  }

  function grantIntent(reason) {
    if (!userWantsPlay) log("intent:", reason);
    userWantsPlay = true;
  }

  function isTextTarget(t) {
    return t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
  }

  function notePlayRequest(reason) {
    log("play request:", reason, "paused =", video && video.paused, "readyState", video && video.readyState);
    if (rec) rec.clicks++;
    mark("clickMs");
  }

  document.addEventListener("mousedown", (e) => {
    if (e.target.closest(INTENT_SELECTOR)) grantIntent("mousedown");
    if (e.target.closest(PLAY_BUTTON_SELECTOR)) notePlayRequest("click");
  }, true);

  document.addEventListener("keydown", (e) => {
    if (isTextTarget(e.target) || !PLAY_KEYS.has(e.key)) return;
    if (cfg.keyboardIsIntent) grantIntent("key " + e.key);
    notePlayRequest("key " + e.key);
  }, true);

  window.addEventListener("yt-navigate-start", () => { navStart = performance.now(); });

  // First media segment request: when it left and when it came back.
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) {
      if (!/googlevideo\.com\/videoplayback/.test(e.name)) continue;
      mark("mediaReqMs", Math.round(e.startTime - navStart));
      mark("mediaRespMs", Math.round(e.responseEnd - navStart));
    }
  }).observe({ type: "resource", buffered: true });

  // ---- menu
  function buildMenu() {
    const toggle = (label, key) => {
      GM_registerMenuCommand(`${cfg[key] ? "☑" : "☐"} ${label}`, () => {
        cfg[key] = !cfg[key];
        saveSettings();
        buildMenu();
      }, { id: key });
    };
    toggle("Blocking enabled", "enabled");
    toggle("Block first video on page load", "blockOnPageLoad");
    toggle("Keyboard play counts as intent", "keyboardIsIntent");
    toggle("Show \"queued\" badge", "queuedBadge");
    toggle("Console logging", "log");
    GM_registerMenuCommand("Print timing log to console", printTimings, { id: "print" });
    GM_registerMenuCommand("Clear timing log", () => GM_setValue(TIMING_KEY, "[]"), { id: "clear" });
  }
  buildMenu();

  new MutationObserver(syncVideo).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener("yt-navigate-finish", syncVideo);
})();
