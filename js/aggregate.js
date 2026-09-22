/** From raw query rows → dashboard aggregates */
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const round = (v, d = 2) => Math.round(v * 10 ** d) / 10 ** d;

function agg(rows) {
  const o = {
    units: 0, sales: 0, orders: 0, netSales: 0, b2bUnits: 0, b2bSales: 0,
    promoUnits: 0, promoSales: 0, promoOrders: 0, promotionDiscount: 0,
    refundUnits: 0, refundAmount: 0, grossProfit: 0, orderProfit: 0, returnUnits: 0,
    sessions: 0, pageViews: 0, adSpend: 0, adSales: 0, adOrders: 0, adImpressions: 0, adClicks: 0,
    naturalOrders: 0, spSpend: 0, sbSpend: 0, sbvSpend: 0, sdSpend: 0,
  };
  for (const r of rows) for (const k of Object.keys(o)) o[k] += num(r[k]);
  return o;
}

function enrich(t) {
  return {
    ...t,
    conversionRate: t.sessions ? round((t.orders / t.sessions) * 100) : 0,
    acos: t.adSales ? round((t.adSpend / t.adSales) * 100) : null,
    orderMargin: t.sales ? round((t.orderProfit / t.sales) * 100) : 0,
  };
}

export function rebuildAggregates(data, keywords) {
  const pd = data.queries?.product_daily?.rows || [];
  const cd = data.queries?.campaign_daily?.rows || [];
  const pl = data.queries?.placement_daily?.rows || [];

  const dates = [...new Set(pd.map((r) => r.date))].sort();
  const daily = dates.map((date) => enrich({ date, ...agg(pd.filter((r) => r.date === date)) }));

  const byMsku = new Map();
  for (const r of pd) {
    if (!r.msku || r.msku === "-") continue;
    if (!byMsku.has(r.msku)) byMsku.set(r.msku, { msku: r.msku, productName: r.productName, asin: r.asin, rows: [] });
    byMsku.get(r.msku).rows.push(r);
  }
  const products = [...byMsku.values()]
    .map((p) => ({ msku: p.msku, productName: p.productName, asin: p.asin, ...enrich(agg(p.rows)) }))
    .sort((a, b) => b.sales - a.sales);

  const productDaily = {};
  for (const [msku, p] of byMsku) {
    productDaily[msku] = dates.map((date) => enrich({ date, ...agg(p.rows.filter((r) => r.date === date)) }));
  }

  const channelTotals = {};
  for (const r of cd) {
    const ch = r.channel || "OTHER";
    if (!channelTotals[ch]) channelTotals[ch] = { channel: ch, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0, units: 0 };
    const t = channelTotals[ch];
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.spend += num(r.spend);
    t.sales += num(r.sales);
    t.orders += num(r.orders);
    t.units += num(r.units);
  }
  const channels = Object.values(channelTotals).map((t) => ({
    ...t,
    acos: t.sales ? round((t.spend / t.sales) * 100) : null,
    roas: t.spend ? round(t.sales / t.spend) : null,
    ctr: t.impressions ? round((t.clicks / t.impressions) * 100) : 0,
    cvr: t.clicks ? round((t.orders / t.clicks) * 100) : 0,
  })).sort((a, b) => b.spend - a.spend);

  const placementTotals = {};
  for (const r of pl) {
    const p = r.placement || "OTHER";
    if (!placementTotals[p]) placementTotals[p] = { placement: p, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
    const t = placementTotals[p];
    t.impressions += num(r.impressions);
    t.clicks += num(r.clicks);
    t.spend += num(r.spend);
    t.sales += num(r.sales);
    t.orders += num(r.orders);
  }
  const placements = Object.values(placementTotals).map((t) => ({
    ...t,
    acos: t.sales ? round((t.spend / t.sales) * 100) : null,
    roas: t.spend ? round(t.sales / t.spend) : null,
  })).sort((a, b) => b.spend - a.spend);

  const sumDaily = (arr) => {
    const o = agg(arr);
    return enrich(o);
  };

  return {
    meta: {
      title: data.meta?.title || "Amazon 美国站经营大盘",
      store: data.meta?.store || "BouncePixel-US",
      generatedAt: data.meta?.generatedAt,
      dateStart: dates[0] || "",
      dateEnd: dates[dates.length - 1] || "",
      dayCount: dates.length,
      mskuCount: products.length,
    },
    overall: sumDaily(daily),
    last7: sumDaily(daily.slice(-7)),
    prev7: sumDaily(daily.slice(-14, -7)),
    daily,
    products,
    productDaily,
    channels,
    placements,
    keywordSummary: keywords?.summary || data.keywordSummary || [],
    topKeywords: keywords?.performance || data.topKeywords || [],
    queries: data.queries,
  };
}
