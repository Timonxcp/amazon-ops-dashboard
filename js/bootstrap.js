/** Module entry: unlock + render + weekly import */
import { decryptPack } from "./crypto-util.js";
import { initImportUi, loadRawOverlay } from "./import-ui.js";
import { rebuildAggregates } from "./aggregate.js";

// app.js is a classic script that reads window.DASH_* — load it after unlock.
const STORE_KEY = "dash_invite_key_v1";

function readKeyFromLocation() {
  const hash = location.hash.replace(/^#/, "");
  const params = new URLSearchParams(hash.includes("=") ? hash : "");
  return (params.get("k") || new URLSearchParams(location.search).get("k") || "").trim();
}

function loadSavedKey() {
  try {
    return localStorage.getItem(STORE_KEY);
  } catch {
    return null;
  }
}

function saveKey(key) {
  try {
    localStorage.setItem(STORE_KEY, key);
  } catch (_) {}
}

function showGate(msg) {
  document.getElementById("gate")?.classList.remove("is-hidden");
  document.getElementById("app")?.classList.add("is-hidden");
  const err = document.getElementById("gate-error");
  if (err && msg) err.textContent = msg;
}

function showApp() {
  document.getElementById("gate")?.classList.add("is-hidden");
  document.getElementById("app")?.classList.remove("is-hidden");
}

async function unlock(secret) {
  const encPack = window.__DASH_ENC_OVERRIDE__ || window.DASH_ENC;
  const kwPack = window.DASH_KW_ENC;
  if (!encPack) throw new Error("missing data pack");

  // Prefer local overlay pack from weekly import if fresher
  let data;
  try {
    const localPack = JSON.parse(localStorage.getItem("dash_data_pack_v1") || "null");
    data = localPack ? await decryptPack(localPack, secret) : await decryptPack(encPack, secret);
  } catch (e) {
    data = await decryptPack(encPack, secret);
  }

  let keywords = null;
  if (kwPack) {
    try {
      keywords = await decryptPack(kwPack, secret);
    } catch (_) {
      keywords = null;
    }
  }
  if (!keywords && data.keywords) {
    keywords = {
      summary: data.keywords.summary || [],
      performance: data.keywords.performance || [],
      daily: data.keywords.daily || [],
    };
  }

  // Merge weekly raw overlay if present (extends/replaces query rows)
  const overlay = loadRawOverlay();
  if (overlay && data.queries) {
    for (const id of ["product_daily", "campaign_daily", "placement_daily"]) {
      const base = data.queries[id]?.rows || [];
      const extra = overlay[id] || [];
      const map = new Map(base.map((r) => [r.key, r]));
      for (const r of extra) map.set(r.key, r);
      data.queries[id] = { rows: [...map.values()] };
    }
  } else if (overlay && !data.queries) {
    data.queries = {
      product_daily: { rows: overlay.product_daily || [] },
      campaign_daily: { rows: overlay.campaign_daily || [] },
      placement_daily: { rows: overlay.placement_daily || [] },
    };
  }

  window.__KEYWORDS__ = keywords;
  window.__APP_DATA__ = data;
  window.DASH_DATA = rebuildAggregates(data, keywords);
  saveKey(secret);
  showApp();
}

function bindGate() {
  const form = document.getElementById("gate-form");
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const code = document.getElementById("gate-code")?.value?.trim();
    if (!code) return;
    try {
      await unlock(code);
      await bootApp();
    } catch (_) {
      const err = document.getElementById("gate-error");
      if (err) err.textContent = "访问码不正确。";
    }
  });
}

async function bootApp() {
  // Dynamic classic script load for app.js
  await new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "js/app.js";
    s.onload = resolve;
    s.onerror = reject;
    document.body.appendChild(s);
  });
  initImportUi({
    onApplied: () => {
      // soft reload to re-render from overlay
      location.reload();
    },
  });
}

async function main() {
  if (window.DASH_META?.title) document.title = window.DASH_META.title;
  const fromLoc = readKeyFromLocation();
  const saved = loadSavedKey();
  const candidate = (fromLoc || saved || "").trim();
  if (candidate) {
    try {
      await unlock(candidate);
      if (fromLoc && location.hash) {
        history.replaceState(null, "", location.pathname + location.search);
      }
      await bootApp();
      return;
    } catch (_) {
      /* gate */
    }
  }
  showGate(candidate ? "访问码无效或已过期，请重新使用邀请链接。" : "");
  bindGate();
}

main();
