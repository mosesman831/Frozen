/* FrozenRules — JS port of frozen-common/src/rules.rs.
   Loaded before content.js (shared isolated world) and importScripts'd by
   the background service worker. Rule kinds: domain, wildcard, url, keyword,
   regex, path, title, yt_channel. negated => exception (allow) rule. */
"use strict";

const FrozenRules = (() => {
  function canonicalHost(input) {
    let s = String(input || "").trim().toLowerCase();
    s = s.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // strip scheme
    s = s.split("/")[0].split("?")[0].split("#")[0]; // strip path/query
    s = s.split("@").pop(); // strip credentials
    s = s.replace(/:\d+$/, ""); // strip port
    s = s.replace(/\.$/, ""); // trailing dot
    return s.replace(/^www\./, "");
  }

  function splitUrl(url) {
    const host = canonicalHost(url);
    let s = String(url || "").toLowerCase().replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
    const idx = s.indexOf("/");
    const path = idx >= 0 ? s.slice(idx + 1) : "";
    return { host, path: path.split("#")[0] };
  }

  function wildcardToRegex(glob) {
    const esc = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp("^" + esc.replace(/\*/g, ".*").replace(/\?/g, ".") + "$", "i");
  }

  function matchUrl(url, rules, title) {
    const { host, path } = splitUrl(url);
    const full = url.toLowerCase();
    const tl = (title || "").toLowerCase();
    // exceptions first
    for (const r of rules) {
      if (!r.negated) continue;
      if (oneMatch(r, host, path, full, tl)) return null;
    }
    for (const r of rules) {
      if (r.negated) continue;
      if (oneMatch(r, host, path, full, tl)) return r;
    }
    return null;
  }

  function oneMatch(r, host, path, full, title) {
    const v = String(r.value || "").toLowerCase();
    switch (r.kind) {
      case "domain":
        return host === v || host.endsWith("." + v);
      case "wildcard":
        return wildcardToRegex(v).test(full) || wildcardToRegex(v).test(host);
      case "url":
        return full.includes(v);
      case "keyword":
        return full.includes(v) || title.includes(v);
      case "path":
        return path.startsWith(v.replace(/^\//, ""));
      case "title":
        return title.includes(v);
      case "regex":
        try { return new RegExp(r.value, "i").test(full); } catch { return false; }
      default:
        return false;
    }
  }

  /* allBlocks: BlockListInfo.blocks (with .active resolved by svc).
     Returns {block:true, block_id, block_name, rule} | {block:false} */
  function verdict(url, allBlocks, title) {
    // whitelist blocks: if any active whitelist doesn't match, it's a block
    for (const b of allBlocks) {
      if (!b.active || !b.allow_mode) continue;
      if (b.block_all_internet && !oneMatchRules(url, b.rules, title)) {
        return { block: true, block_id: b.id, block_name: b.name, rule: "<internet>" };
      }
      if (!b.block_all_internet && !matchUrl(url, b.rules, title)) {
        return { block: true, block_id: b.id, block_name: b.name, rule: "<whitelist>" };
      }
    }
    for (const b of allBlocks) {
      if (!b.active || b.allow_mode) continue;
      const hit = matchUrl(url, b.rules, title);
      if (hit) return { block: true, block_id: b.id, block_name: b.name, rule: hit.value };
    }
    return { block: false };
  }

  function oneMatchRules(url, rules, title) {
    const { host, path } = splitUrl(url);
    for (const r of rules) {
      if (r.negated) continue;
      if (oneMatch(r, host, path, url.toLowerCase(), (title || "").toLowerCase())) return true;
    }
    return false;
  }

  return { canonicalHost, splitUrl, matchUrl, verdict };
})();

if (typeof module !== "undefined") module.exports = FrozenRules;
