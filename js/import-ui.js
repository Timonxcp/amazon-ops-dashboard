/** 业绩 Excel 导入 UI + 合并后续处理 */
import { parseWorkbook, mergeQueryRows, IMPORT_SCHEMAS } from "./excel-import.js";
import { encryptPack, decryptPack } from "./crypto-util.js";

const STORE_RAW = "dash_raw_v1";
const STORE_KEY = "dash_invite_key_v1";

function $(id) {
  return document.getElementById(id);
}

function loadSecret() {
  try {
    return localStorage.getItem(STORE_KEY) || "";
  } catch {
    return "";
  }
}

function saveRaw(raw) {
  try {
    localStorage.setItem(STORE_RAW, JSON.stringify(raw));
  } catch {
    /* quota — skip */
  }
}

export function loadRawOverlay() {
  try {
    const t = localStorage.getItem(STORE_RAW);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

function summarize(parsedList) {
  const byQuery = {};
  for (const p of parsedList) {
    if (!byQuery[p.queryId]) byQuery[p.queryId] = { ...p, rows: [...p.rows] };
    else {
      byQuery[p.queryId].rows = mergeQueryRows(byQuery[p.queryId].rows, p.rows);
      byQuery[p.queryId].rowCount = byQuery[p.queryId].rows.length;
      byQuery[p.queryId].dateStart = [byQuery[p.queryId].dateStart, p.dateStart].filter(Boolean).sort()[0];
      byQuery[p.queryId].dateEnd = [byQuery[p.queryId].dateEnd, p.dateEnd].filter(Boolean).sort().slice(-1)[0];
    }
  }
  return byQuery;
}

function renderPreview(host, byQuery, missing) {
  const rows = IMPORT_SCHEMAS.map((schema) => {
    const hit = byQuery[schema.queryId];
    const missingLabel = missing.includes(schema.queryId) ? "待导入" : "已识别";
    return `<tr>
      <td><strong>${schema.label}</strong><div style="color:var(--muted);font-size:11px">${schema.hint}</div></td>
      <td>${hit ? hit.sheetName || "—" : "—"}</td>
      <td class="num">${hit ? hit.rowCount : 0}</td>
      <td>${hit ? `${hit.dateStart || "?"} → ${hit.dateEnd || "?"}` : "—"}</td>
      <td>${hit ? "✓ " + missingLabel : missing.includes(schema.queryId) ? "✗ 缺少" : "—"}</td>
    </tr>`;
  }).join("");
  host.innerHTML = `
    <table class="data-table" style="min-width:640px">
      <thead><tr><th>文件</th><th>工作表</th><th class="num">行数</th><th>日期范围</th><th>状态</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

async function rebuildFromRaw(raw, secret) {
  // Keep keyword pack untouched; replace performance queries in DASH_DATA-like structure
  const payload = {
    meta: {
      ...(window.DASH_META || {}),
      generatedAt: new Date().toISOString(),
      source: "weekly-excel-import",
    },
    queries: {
      product_daily: { rows: raw.product_daily || [] },
      campaign_daily: { rows: raw.campaign_daily || [] },
      placement_daily: { rows: raw.placement_daily || [] },
    },
    // keywords stay in separate pack; fill from current if present
    keywords: raw.keywords || window.__KEYWORDS__ || {
      summary: [],
      performance: [],
      daily: [],
      fetchedAt: null,
    },
  };
  // Runtime aggregates computed by app via rebuildAggregates(raw)
  const pack = await encryptPack(payload, secret);
  return pack;
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/javascript;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function initImportUi({ onApplied }) {
  const openBtn = $("btn-import");
  const modal = $("import-modal");
  const fileInput = $("import-files");
  const previewHost = $("import-preview");
  const applyBtn = $("import-apply");
  const closeBtn = $("import-close");
  const status = $("import-status");
  let parsedMap = null;

  if (!openBtn || !modal) return;

  const close = () => {
    modal.classList.add("is-hidden");
    parsedMap = null;
    previewHost.innerHTML = "";
    status.textContent = "";
    applyBtn.disabled = true;
    fileInput.value = "";
  };

  openBtn.addEventListener("click", () => {
    modal.classList.remove("is-hidden");
  });
  closeBtn?.addEventListener("click", close);
  $("import-close-2")?.addEventListener("click", close);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  fileInput.addEventListener("change", async () => {
    status.textContent = "解析中…";
    applyBtn.disabled = true;
    parsedMap = null;
    const files = [...fileInput.files];
    if (!files.length) {
      status.textContent = "";
      return;
    }
    try {
      const parsedList = [];
      for (const file of files) {
        const buf = await file.arrayBuffer();
        const parts = parseWorkbook(buf, file.name);
        parsedList.push(...parts);
      }
      const byQuery = summarize(parsedList);
      const found = Object.keys(byQuery);
      const missing = IMPORT_SCHEMAS.map((s) => s.queryId).filter((id) => !found.includes(id));
      parsedMap = byQuery;
      renderPreview(previewHost, byQuery, missing);
      status.textContent = missing.length
        ? `已识别 ${found.length}/3 份。仍缺：${missing
            .map((id) => IMPORT_SCHEMAS.find((s) => s.queryId === id).label)
            .join("、")}。可先应用已识别部分。`
        : "三份文件均已识别，可导入合并。";
      applyBtn.disabled = found.length === 0;
    } catch (err) {
      status.textContent = "解析失败：" + (err?.message || err);
    }
  });

  applyBtn.addEventListener("click", async () => {
    if (!parsedMap) return;
    const secret = loadSecret();
    if (!secret) {
      status.textContent = "未解锁访问码，无法写入本地或导出加密包。";
      return;
    }
    status.textContent = "合并与加密中…";
    try {
      const overlay = loadRawOverlay() || { product_daily: [], campaign_daily: [], placement_daily: [] };
      for (const queryId of Object.keys(parsedMap)) {
        overlay[queryId] = mergeQueryRows(overlay[queryId] || [], parsedMap[queryId].rows);
      }
      overlay.keywords = window.__KEYWORDS__ || overlay.keywords || null;
      overlay.updatedAt = new Date().toISOString();
      saveRaw(overlay);

      const pack = await rebuildFromRaw(overlay, secret);
      // Persist as current performance pack overlay
      try {
        localStorage.setItem("dash_data_pack_v1", JSON.stringify(pack));
      } catch (_) {}
      downloadText(
        "data.enc.js",
        "window.DASH_ENC = " +
          JSON.stringify(pack) +
          ";\nwindow.DASH_META = " +
          JSON.stringify(window.DASH_META || {}) +
          ";\n"
      );
      status.textContent =
        "已合并到本地，并下载 data.enc.js。请替换仓库中 js/data.enc.js 后推送，线上同事即可看到本周数据。";
      onApplied?.(overlay);
    } catch (err) {
      status.textContent = "处理失败：" + (err?.message || err);
    }
  });
}
