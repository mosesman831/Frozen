/* Frozen content script — runs at document_start in every frame.
   Checks the current location against cached block state (via the
   background worker's verdict) and swaps the document for the block page.
   Also reports visits + time-on-site ticks for stats. */
"use strict";

(() => {
  if (location.protocol === "chrome-extension:") return;

  let blocked = false;
  const isTop = window.top === window;

  function blockNow(v) {
    if (blocked) return;
    blocked = true;
    const url = chrome.runtime.getURL("blocked.html") +
      "?u=" + encodeURIComponent(location.href) +
      "&b=" + encodeURIComponent(v.block_name || "") +
      "&r=" + encodeURIComponent(v.rule || "");
    try {
      document.documentElement.innerHTML = "";
      const ifr = document.createElement("iframe");
      ifr.src = url;
      ifr.style.cssText =
        "position:fixed;inset:0;width:100%;height:100%;border:0;z-index:2147483647;background:#0b0e14";
      document.documentElement.appendChild(ifr);
    } catch (e) {
      location.replace(url);
    }
  }

  function ask() {
    return chrome.runtime
      .sendMessage({ type: "verdict", url: location.href, title: document.title || "" })
      .catch(() => null);
  }

  // document_start check — kills the page before scripts/resources run
  ask().then((r) => {
    if (r && r.v && r.v.block) blockNow(r.v);
  });

  // background-initiated block (SPA history navigation)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "frozen-block" && msg.v && msg.v.block) blockNow(msg.v);
  });

  // title/keyword rules need a late check once <title> exists
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      ask().then((r) => {
        if (r && r.v && r.v.block) blockNow(r.v);
      });
    });
  }
  new MutationObserver(() => {
    if (document.title) {
      ask().then((r) => {
        if (r && r.v && r.v.block) blockNow(r.v);
      });
    }
  }).observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
  });

  // ---- stats (top frame only) ----
  if (isTop) {
    const host = FrozenRules.canonicalHost(location.href);
    chrome.runtime.sendMessage({ type: "visit", domain: host }).catch(() => {});
    setInterval(() => {
      if (document.visibilityState === "visible") {
        chrome.runtime
          .sendMessage({ type: "tick", domain: host, seconds: 15 })
          .catch(() => {});
      }
    }, 15000);
  }
})();
