/**
 * 西柚洞察每日无感更新（CI / 本机均可）
 * 环境变量：
 *   XYDC_API_KEY          西柚 OpenAPI Key
 *   DASHBOARD_ACCESS_CODE 与邀请链接相同的访问码
 * 可选：
 *   PRODUCTS_JSON          覆盖默认 config/products.json 路径
 *   OUT_FILE               默认 js/keywords.enc.js
 */
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";

const API_BASE = "https://openapi.xydc.com";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productsPath = process.env.PRODUCTS_JSON || path.join(root, "config", "products.json");
const outFile = process.env.OUT_FILE || path.join(root, "js", "keywords.enc.js");
const accessCode = process.env.DASHBOARD_ACCESS_CODE;
const apiKey = process.env.XYDC_API_KEY;

if (!apiKey) {
  console.error("missing XYDC_API_KEY");
  process.exit(1);
}
if (!accessCode) {
  console.error("missing DASHBOARD_ACCESS_CODE");
  process.exit(1);
}

function addDays(value, days) {
  const d = new Date(`${value}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dateInLosAngeles() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const v = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${v.year}-${v.month}-${v.day}`;
}

async function callXydc(pathName, body) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const res = await fetch(`${API_BASE}${pathName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-auth-version": "2.0",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (res.ok) return payload;
    if ((res.status === 429 || res.status >= 500) && attempt < 2) {
      await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
      continue;
    }
    throw new Error(`xydc ${pathName} HTTP ${res.status} ${payload?.message || ""}`);
  }
  throw new Error(`xydc ${pathName} failed`);
}

function encryptJson(obj, code) {
  const key = crypto.createHash("sha256").update("dash-access:" + code).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plain = Buffer.from(JSON.stringify(obj), "utf8");
  const ct = Buffer.concat([cipher.update(plain), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    v: 1,
    alg: "AES-GCM",
    iv: iv.toString("base64"),
    ct: Buffer.concat([ct, tag]).toString("base64"),
  };
}

const products = JSON.parse(fs.readFileSync(productsPath, "utf8"));
const executedAt = new Date().toISOString();
const trendEnd = addDays(dateInLosAngeles(), -1);
const trendStart = addDays(trendEnd, -29);

console.log(`xydc daily: ${products.length} ASINs, trend ${trendStart}..${trendEnd}`);

const traffic = await callXydc("/v1/asins/traffic", {
  entities: products.map((p) => ({ country: "US", asin: p.asin })),
});

const keywordResults = [];
const trendResults = [];
for (const p of products) {
  keywordResults.push(
    await callXydc("/v1/asins/research/list/period", {
      asin: p.asin,
      country: "US",
      page: 1,
      pageSize: 100,
      period: "last7days",
      sort: { field: "traffic", order: "desc" },
    })
  );
  trendResults.push(
    await callXydc("/v1/asins/trafficScore/trend/daily", {
      asin: p.asin,
      country: "US",
      startDate: trendStart,
      endDate: trendEnd,
    })
  );
}

// Lightweight normalize (aligned with xydc-normalize.js)
const trafficList = Array.isArray(traffic) ? traffic : traffic?.list || traffic?.data || [];
const summary = products.map((p, i) => {
  const hit =
    trafficList.find((t) => t.asin === p.asin) ||
    (trafficList[i] && trafficList[i].asin === p.asin ? trafficList[i] : null) ||
    {};
  const kw = keywordResults[i]?.list || keywordResults[i]?.data?.list || keywordResults[i]?.data || [];
  const list = Array.isArray(kw) ? kw : kw.list || [];
  const totalKeywords = Number(kw.total ?? list.length ?? 0);
  return {
    asin: p.asin,
    msku: p.msku,
    productName: p.productName,
    totalTrafficScore: Number(hit.totalTrafficScore ?? hit.totalTraffic ?? 0),
    organicTrafficScore: Number(hit.organicTrafficScore ?? hit.organicTraffic ?? 0),
    advertisingTrafficScore: Number(hit.advertisingTrafficScore ?? hit.advertisingTraffic ?? 0),
    allKeywordCount: totalKeywords,
    organicKeywordCount: Number(hit.organicKeywordCount ?? 0),
    advertisingKeywordCount: Number(hit.advertisingKeywordCount ?? 0),
    snapshotThrough: trendEnd,
  };
});

const performance = products.flatMap((p, i) => {
  const kw = keywordResults[i]?.list || keywordResults[i]?.data?.list || keywordResults[i]?.data || [];
  const list = Array.isArray(kw) ? kw : kw.list || [];
  return list.map((row) => ({
    msku: p.msku,
    productName: p.productName,
    asin: p.asin,
    searchTerm: row.searchTerm ?? row.searchTermName ?? row.keyword ?? "",
    trafficType: row.trafficType ?? row.trafficTypeCode ?? "both",
    totalTraffic: Number(row.totalTraffic ?? row.traffic ?? 0),
    organicTraffic: Number(row.organicTraffic ?? 0),
    advertisingTraffic: Number(row.advertisingTraffic ?? 0),
    totalGrowthRate: row.totalGrowthRate ?? null,
    organicRank: row.organicRank ?? null,
    advertisingRank: row.advertisingRank ?? null,
  }));
});

const daily = products.flatMap((p, i) => {
  const t = trendResults[i];
  const list = t?.list || t?.data?.list || t?.data || t?.rows || [];
  const rows = Array.isArray(list) ? list : [];
  return rows.map((row) => ({
    asin: p.asin,
    msku: p.msku,
    date: row.date ?? row.statDate ?? "",
    organicTrafficScore: Number(row.organicTrafficScore ?? 0),
    advertisingTrafficScore: Number(row.advertisingTrafficScore ?? 0),
    totalTrafficScore: Number(row.totalTrafficScore ?? 0),
  }));
});

const payload = {
  meta: {
    executedAt,
    trendStart,
    trendEnd,
    productCount: products.length,
    keywordCount: performance.length,
  },
  summary,
  performance,
  daily,
};

const pack = encryptJson(payload, accessCode);
const js =
  "window.DASH_KW_ENC = " +
  JSON.stringify(pack) +
  ";\nwindow.DASH_KW_META = " +
  JSON.stringify(payload.meta) +
  ";\n";
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, js);
console.log("wrote", outFile, "keywords", performance.length, "bytes", js.length);
