import fs from "fs";
import crypto from "crypto";
const path = "C:/Users/xcp17/Documents/ChatGPT/数据大盘表/amazon-dashboard/src/data.json";
const j = JSON.parse(fs.readFileSync(path, "utf8"));
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

const pd = j.queries.product_daily.rows;
const dates = [...new Set(pd.map((r) => r.date))].sort();
const products = [...new Set(pd.map((r) => r.msku).filter((x) => x && x !== "-"))];
console.log("date range", dates[0], "->", dates[dates.length - 1], "days", dates.length);
console.log("msku count", products.length);

function agg(rows) {
  const o = {
    units: 0, sales: 0, orders: 0, netSales: 0, b2bUnits: 0, b2bSales: 0,
    promoUnits: 0, promoSales: 0, promoOrders: 0, promotionDiscount: 0,
    refundUnits: 0, refundAmount: 0, grossProfit: 0, orderProfit: 0, returnUnits: 0,
    sessions: 0, pageViews: 0, adSpend: 0, adSales: 0, adOrders: 0, adImpressions: 0, adClicks: 0,
    naturalOrders: 0, spSpend: 0, sbSpend: 0, sbvSpend: 0, sdSpend: 0,
    reviews: 0, availableInventory: 0, fbaAvailable: 0,
  };
  for (const r of rows) for (const k of Object.keys(o)) o[k] += num(r[k]);
  return o;
}

const byMsku = new Map();
for (const r of pd) {
  if (!r.msku || r.msku === "-") continue;
  if (!byMsku.has(r.msku)) {
    byMsku.set(r.msku, {
      msku: r.msku, productName: r.productName, asin: r.asin,
      parentAsin: r.parentAsin, brand: r.brand, rows: [],
    });
  }
  byMsku.get(r.msku).rows.push(r);
}

const productTotals = [...byMsku.values()]
  .map((p) => {
    const t = agg(p.rows);
    return {
      msku: p.msku, productName: p.productName, asin: p.asin,
      parentAsin: p.parentAsin, brand: p.brand, ...t,
      conversionRate: t.sessions ? round((t.orders / t.sessions) * 100, 2) : 0,
      acos: t.adSales ? round((t.adSpend / t.adSales) * 100, 2) : null,
      orderMargin: t.sales ? round((t.orderProfit / t.sales) * 100, 2) : 0,
    };
  })
  .sort((a, b) => b.sales - a.sales);

const daily = dates.map((d) => {
  const t = agg(pd.filter((r) => r.date === d));
  return {
    date: d, ...t,
    conversionRate: t.sessions ? round((t.orders / t.sessions) * 100, 2) : 0,
    acos: t.adSales ? round((t.adSpend / t.adSales) * 100, 2) : null,
  };
});

function weekKey(dstr) {
  const d = new Date(dstr + "T00:00:00Z");
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

const byWeek = new Map();
for (const r of pd) {
  const wk = weekKey(r.date);
  if (!byWeek.has(wk)) byWeek.set(wk, []);
  byWeek.get(wk).push(r);
}

const weekly = [...byWeek.entries()]
  .sort((a, b) => a[0].localeCompare(b[0]))
  .map(([week, rows]) => {
    const t = agg(rows);
    return {
      week, ...t,
      conversionRate: t.sessions ? round((t.orders / t.sessions) * 100, 2) : 0,
      acos: t.adSales ? round((t.adSpend / t.adSales) * 100, 2) : null,
    };
  });

const cd = j.queries.campaign_daily.rows;
const channelTotals = {};
for (const r of cd) {
  const ch = r.channel || "OTHER";
  if (!channelTotals[ch]) {
    channelTotals[ch] = {
      channel: ch, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0,
    };
  }
  const t = channelTotals[ch];
  t.impressions += num(r.impressions);
  t.clicks += num(r.clicks);
  t.spend += num(r.spend);
  t.sales += num(r.sales);
  t.orders += num(r.orders);
  t.units += num(r.units);
}
const channels = Object.values(channelTotals)
  .map((t) => ({
    ...t,
    acos: t.sales ? round((t.spend / t.sales) * 100, 2) : null,
    roas: t.spend ? round(t.sales / t.spend, 2) : null,
    ctr: t.impressions ? round((t.clicks / t.impressions) * 100, 2) : 0,
    cvr: t.clicks ? round((t.orders / t.clicks) * 100, 2) : 0,
  }))
  .sort((a, b) => b.spend - a.spend);

const pl = j.queries.placement_daily.rows;
const placementTotals = {};
for (const r of pl) {
  const p = r.placement || "OTHER";
  if (!placementTotals[p]) {
    placementTotals[p] = {
      placement: p, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
    };
  }
  const t = placementTotals[p];
  t.impressions += num(r.impressions);
  t.clicks += num(r.clicks);
  t.spend += num(r.spend);
  t.sales += num(r.sales);
  t.orders += num(r.orders);
}
const placements = Object.values(placementTotals)
  .map((t) => ({
    ...t,
    acos: t.sales ? round((t.spend / t.sales) * 100, 2) : null,
    roas: t.spend ? round(t.sales / t.spend, 2) : null,
  }))
  .sort((a, b) => b.spend - a.spend);

const ks = j.queries.keyword_summary.rows.map((r) => ({
  asin: r.asin, msku: r.msku, productName: r.productName,
  totalTrafficScore: r.totalTrafficScore,
  previous7DaysTotalTrafficScore: r.previous7DaysTotalTrafficScore,
  totalTrafficScoreGrowthRate: r.totalTrafficScoreGrowthRate,
  organicTrafficScore: r.organicTrafficScore,
  advertisingTrafficScore: r.advertisingTrafficScore,
  organicTrafficScoreRatio: r.organicTrafficScoreRatio,
  advertisingTrafficScoreRatio: r.advertisingTrafficScoreRatio,
  allKeywordCount: r.allKeywordCount,
  organicKeywordCount: r.organicKeywordCount,
  advertisingKeywordCount: r.advertisingKeywordCount,
}));

const kp = j.queries.keyword_performance.rows
  .map((r) => ({
    msku: r.msku, productName: r.productName, searchTerm: r.searchTerm, trafficType: r.trafficType,
    totalTraffic: r.totalTraffic, organicTraffic: r.organicTraffic, advertisingTraffic: r.advertisingTraffic,
    totalGrowthRate: r.totalGrowthRate, organicRank: r.organicRank, advertisingRank: r.advertisingRank,
  }))
  .sort((a, b) => num(b.totalTraffic) - num(a.totalTraffic))
  .slice(0, 40);

function sumDaily(arr) {
  const o = {};
  for (const k of [
    "units", "sales", "orders", "netSales", "orderProfit", "grossProfit",
    "adSpend", "adSales", "adOrders", "sessions", "promoUnits", "promotionDiscount", "refundAmount",
  ]) {
    o[k] = round(
      arr.reduce((s, r) => s + num(r[k]), 0),
      2
    );
  }
  o.conversionRate = o.sessions ? round((o.orders / o.sessions) * 100, 2) : 0;
  o.acos = o.adSales ? round((o.adSpend / o.adSales) * 100, 2) : null;
  return o;
}

const productDaily = {};
for (const [msku, p] of byMsku) {
  productDaily[msku] = dates.map((d) => {
    const t = agg(p.rows.filter((r) => r.date === d));
    return {
      date: d,
      ...t,
      conversionRate: t.sessions ? round((t.orders / t.sessions) * 100, 2) : 0,
      acos: t.adSales ? round((t.adSpend / t.adSales) * 100, 2) : null,
    };
  });
}

const out = {
  meta: {
    title: "Amazon 美国站经营大盘",
    store: "BouncePixel-US",
    generatedAt: j.generatedAt,
    dateStart: dates[0],
    dateEnd: dates[dates.length - 1],
    dayCount: dates.length,
    mskuCount: products.length,
  },
  overall: sumDaily(daily),
  last7: sumDaily(daily.slice(-7)),
  prev7: sumDaily(daily.slice(-14, -7)),
  daily,
  weekly,
  products: productTotals,
  productDaily,
  channels,
  placements,
  keywordSummary: ks,
  topKeywords: kp,
};

const r2 = (v) => (typeof v === "number" && Number.isFinite(v) ? Math.round(v * 100) / 100 : v);
function roundDeep(obj) {
  if (Array.isArray(obj)) return obj.map(roundDeep);
  if (obj && typeof obj === "object") {
    const o = {};
    for (const [k, v] of Object.entries(obj)) o[k] = roundDeep(v);
    return o;
  }
  return r2(obj);
}

const payload = roundDeep(out);
const secretsPath = "E:/Mimo Project/ACCESS-SECRETS.local.md";
let accessCode = "";
if (fs.existsSync(secretsPath)) {
  const text = fs.readFileSync(secretsPath, "utf8");
  const m = text.match(/## 访问码[\s\S]*?\n\n([^\n]+)/);
  if (m) accessCode = m[1].trim();
}
if (!accessCode) accessCode = crypto.randomBytes(9).toString("base64url");
const key = crypto.createHash("sha256").update("dash-access:" + accessCode).digest();
const iv = crypto.randomBytes(12);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const payloadFull = {
  ...payload,
  queries: {
    product_daily: { rows: pd },
    campaign_daily: { rows: cd },
    placement_daily: { rows: pl },
  },
  keywords: {
    summary: ks,
    performance: kp,
    daily: j.queries.keyword_daily.rows,
    fetchedAt: j.generatedAt,
  },
};
const plainFull = Buffer.from(JSON.stringify(roundDeep(payloadFull)), "utf8");
const ctFull = Buffer.concat([cipher.update(plainFull), cipher.final()]);
const tagFull = cipher.getAuthTag();
const pack = {
  v: 1,
  alg: "AES-GCM",
  iv: iv.toString("base64"),
  ct: Buffer.concat([ctFull, tagFull]).toString("base64"),
};

fs.mkdirSync("E:/Mimo Project/js", { recursive: true });
const encJs =
  "window.DASH_ENC = " +
  JSON.stringify(pack) +
  ";\nwindow.DASH_META = " +
  JSON.stringify({
    title: payload.meta.title,
    store: payload.meta.store,
    dateStart: payload.meta.dateStart,
    dateEnd: payload.meta.dateEnd,
    dayCount: payload.meta.dayCount,
    mskuCount: payload.meta.mskuCount,
  }) +
  ";\n";
fs.writeFileSync("E:/Mimo Project/js/data.enc.js", encJs);

// Keyword pack (same access code) — also used by daily xydc refresh
const kwPlain = Buffer.from(
  JSON.stringify(
    roundDeep({
      meta: { executedAt: j.generatedAt, source: "bootstrap" },
      summary: ks,
      performance: kp,
      daily: j.queries.keyword_daily.rows,
    })
  ),
  "utf8"
);
const kwIv = crypto.randomBytes(12);
const kwCipher = crypto.createCipheriv("aes-256-gcm", key, kwIv);
const kwCt = Buffer.concat([kwCipher.update(kwPlain), kwCipher.final()]);
const kwTag = kwCipher.getAuthTag();
const kwPack = {
  v: 1,
  alg: "AES-GCM",
  iv: kwIv.toString("base64"),
  ct: Buffer.concat([kwCt, kwTag]).toString("base64"),
};
fs.writeFileSync(
  "E:/Mimo Project/js/keywords.enc.js",
  "window.DASH_KW_ENC = " +
    JSON.stringify(kwPack) +
    ";\nwindow.DASH_KW_META = " +
    JSON.stringify({ executedAt: j.generatedAt, productCount: ks.length, keywordCount: kp.length }) +
    ";\n"
);

const invite =
  "https://timonxcp.github.io/amazon-ops-dashboard/#k=" + accessCode;
const secretsBody = [
  "# 访问密钥（请勿提交到 git / 勿公开）",
  "",
  "## 无感邀请链接（推荐分发给同事）",
  invite,
  "",
  "## 访问码（门禁页可手动输入，与链接密钥相同）",
  accessCode,
  "",
  "> 重置：删除本文件后重跑 `node scripts/build-data.mjs`，并更新 GitHub Secret DASHBOARD_ACCESS_CODE。",
  "",
].join("\n");
if (!fs.existsSync(secretsPath) || !fs.readFileSync(secretsPath, "utf8").includes(accessCode)) {
  fs.writeFileSync(secretsPath, secretsBody);
}

console.log("wrote data.enc.js bytes", encJs.length);
console.log("accessCode saved (local only)");
console.log("overall sales", out.overall.sales, "profit", out.overall.orderProfit);
console.log("weekly", weekly.length, "daily", daily.length, "products", productTotals.length);
console.log("top products", productTotals.slice(0, 5).map((p) => p.msku + ":" + p.sales).join(" | "));
console.log("channels", channels.map((c) => c.channel + ":" + c.spend).join(" | "));
console.log("last7 sales", out.last7.sales, "prev7", out.prev7.sales);
