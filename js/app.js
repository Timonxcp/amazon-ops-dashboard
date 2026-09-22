/* Amazon 美国站经营大盘 · 浅色 + 无感邀请门禁 */
(() => {
  const ENC = window.DASH_ENC;
  const META = window.DASH_META || {};
  const gateEl = document.getElementById("gate");
  const appEl = document.getElementById("app");
  const errorEl = document.getElementById("gate-error");
  const STORE_KEY = "dash_invite_key_v1";

  const COLORS = {
    accent: "#2F6FED",
    mint: "#0F9D6E",
    violet: "#7C5CFF",
    amber: "#C47B00",
    rose: "#D6455D",
    muted: "#78716C",
    ink: "#1C1917",
    border: "#E4DCCB",
  };

  const CHANNEL_LABEL = { SP: "SP", SD: "SD", SB: "SB", SB2: "SB", SBV: "SB", OTHER: "其他" };
  const PLACEMENT_LABEL = {
    "TOP OF SEARCH": "搜索结果顶部（首页）",
    "PRODUCT PAGE": "商品页面",
    "REST OF SEARCH": "搜索结果的其余位置",
    "OFF AMAZON": "OFF AMAZON（站外）",
  };

  const state = { range: "all", grain: "day", msku: "all" };
  const charts = {};
  let DATA = null;

  function b64ToBytes(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function deriveKey(secret) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("dash-access:" + secret));
    return new Uint8Array(digest);
  }

  async function decryptPayload(secret) {
    if (!ENC) throw new Error("missing ciphertext");
    const keyBytes = await deriveKey(String(secret).trim());
    const iv = b64ToBytes(ENC.iv);
    const raw = b64ToBytes(ENC.ct);
    const ct = raw.slice(0, raw.length - 16);
    const tag = raw.slice(raw.length - 16);
    const data = new Uint8Array(ct.length + tag.length);
    data.set(ct, 0);
    data.set(tag, ct.length);
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, ["decrypt"]);
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
    return JSON.parse(new TextDecoder().decode(plain));
  }

  function readKeyFromLocation() {
    const hash = location.hash.replace(/^#/, "");
    const params = new URLSearchParams(hash.includes("=") ? hash : "");
    const fromHash = params.get("k");
    if (fromHash) return fromHash;
    const q = new URLSearchParams(location.search);
    return q.get("k");
  }

  function saveKey(key) {
    try {
      localStorage.setItem(STORE_KEY, key);
    } catch (_) {}
  }

  function loadSavedKey() {
    try {
      return localStorage.getItem(STORE_KEY);
    } catch (_) {
      return null;
    }
  }

  function showGate(msg) {
    gateEl.classList.remove("is-hidden");
    appEl.classList.add("is-hidden");
    if (msg) errorEl.textContent = msg;
  }

  function showApp() {
    gateEl.classList.add("is-hidden");
    appEl.classList.remove("is-hidden");
  }

  // --- formatters / chart / render (same model as previous) ---
  const fmtMoney = (v, digits = 0) => {
    if (v == null || Number.isNaN(v)) return "—";
    const sign = v < 0 ? "-" : "";
    const abs = Math.abs(v);
    return `${sign}$${abs.toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    })}`;
  };
  const fmtInt = (v) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));
  const fmtPct = (v, digits = 1) => (v == null || Number.isNaN(v) ? "—" : `${Number(v).toFixed(digits)}%`);
  const deltaPct = (cur, prev) => {
    if (prev == null || prev === 0) return cur ? 100 : 0;
    return ((cur - prev) / Math.abs(prev)) * 100;
  };
  const toneClass = (d, lowerIsBetter = false) => {
    if (Math.abs(d) < 0.05) return "flat";
    const good = lowerIsBetter ? d < 0 : d > 0;
    return good ? "up" : "down";
  };
  const toneText = (d) => {
    const arrow = Math.abs(d) < 0.05 ? "→" : d > 0 ? "↑" : "↓";
    return `${arrow} ${Math.abs(d).toFixed(1)}%`;
  };

  function seriesFor(msku) {
    if (msku === "all") return DATA.daily;
    return DATA.productDaily?.[msku] || DATA.daily;
  }

  function resolveWindow(rows) {
    if (!rows.length) return { current: [], previous: [], label: "无数据" };
    const endIdx = rows.length - 1;
    let startIdx = 0;
    if (state.range !== "all") startIdx = Math.max(0, rows.length - Number(state.range));
    const current = rows.slice(startIdx, endIdx + 1);
    const span = current.length;
    const prevEnd = startIdx - 1;
    const previous = prevEnd >= 0 ? rows.slice(Math.max(0, prevEnd - span + 1), prevEnd + 1) : [];
    const label = `${current[0].date} → ${current[current.length - 1].date} · ${span} 天`;
    return { current, previous, label };
  }

  function sumRows(rows) {
    const keys = [
      "units", "sales", "orders", "netSales", "orderProfit", "grossProfit",
      "adSpend", "adSales", "adOrders", "sessions", "promoUnits", "promotionDiscount", "refundAmount",
    ];
    const o = {};
    for (const k of keys) o[k] = rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
    o.conversionRate = o.sessions ? (o.orders / o.sessions) * 100 : 0;
    o.acos = o.adSales ? (o.adSpend / o.adSales) * 100 : null;
    o.orderMargin = o.sales ? (o.orderProfit / o.sales) * 100 : 0;
    return o;
  }

  function toGrain(rows) {
    if (state.grain === "day" || !rows.length) return rows.map((r) => ({ ...r, label: r.date }));
    const map = new Map();
    for (const r of rows) {
      const d = new Date(r.date + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const week = d.toISOString().slice(0, 10);
      if (!map.has(week)) map.set(week, []);
      map.get(week).push(r);
    }
    return [...map.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([week, list]) => ({ ...sumRows(list), date: week, label: week }));
  }

  function countUp(el, target, format) {
    const duration = 700;
    const start = performance.now();
    function frame(now) {
      const t = Math.min(1, (now - start) / duration);
      el.textContent = format(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function renderKpis(cur, prev) {
    const host = document.getElementById("kpi-strip");
    const items = [
      { key: "sales", label: "销售额", fmt: (v) => fmtMoney(v, 0), lower: false, sub: "窗口合计" },
      { key: "orderProfit", label: "订单利润", fmt: (v) => fmtMoney(v, 0), lower: false, sub: "窗口合计" },
      { key: "adSpend", label: "广告花费", fmt: (v) => fmtMoney(v, 0), lower: true, sub: "窗口合计" },
      { key: "units", label: "销量", fmt: (v) => fmtInt(v), lower: false, sub: "窗口合计" },
      { key: "conversionRate", label: "转化率", fmt: (v) => fmtPct(v, 2), lower: false, sub: "订单 / Sessions" },
      { key: "acos", label: "综合 ACoS", fmt: (v) => (v == null ? "—" : fmtPct(v, 1)), lower: true, sub: "广告花费 / 广告销售" },
    ];
    host.innerHTML = items
      .map((item) => {
        const c = cur[item.key] ?? 0;
        const p = prev ? prev[item.key] : null;
        const d = p == null ? 0 : deltaPct(c, p);
        const tone = p == null ? "flat" : toneClass(d, item.lower);
        const badge = p == null ? "本期" : toneText(d);
        return `
          <article class="kpi">
            <div class="kpi-label">${item.label}</div>
            <div class="kpi-value" data-kpi="${item.key}">—</div>
            <div class="kpi-delta ${tone}">${badge}${p == null ? "" : ' <span style="opacity:.75">vs 前周期</span>'}</div>
            <div class="kpi-sub">${item.sub}</div>
          </article>`;
      })
      .join("");
    for (const item of items) countUp(host.querySelector(`[data-kpi="${item.key}"]`), cur[item.key] ?? 0, item.fmt);
  }

  function judgeSignals(cur, prev) {
    const signals = [];
    const adOrders = cur.adOrders || 0;
    const adSpend = cur.adSpend || 0;
    const adSales = cur.adSales || 0;
    const profit = cur.orderProfit || 0;
    const sales = cur.sales || 0;
    const sessions = cur.sessions || 0;
    const units = cur.units || 0;
    const orders = cur.orders || 0;
    const promoDiscount = cur.promotionDiscount || 0;
    const conversionRate = cur.conversionRate || 0;
    const refund = cur.refundAmount || 0;
    const prevAdSpend = prev?.adSpend ?? 0;
    const prevAdSales = prev?.adSales ?? 0;
    const prevSessions = prev?.sessions ?? 0;
    const prevConversion = prev?.conversionRate ?? 0;
    const prevProfit = prev?.orderProfit ?? 0;

    if (adSpend > 0 && adOrders === 0) {
      signals.push({ tone: "critical", badge: "需检查", title: "广告无转化", note: "本窗口有广告花费但没有广告订单，优先检查投放与否词。", metrics: [["花费", fmtMoney(adSpend)], ["广告订单", "0"], ["ACoS", adSales ? fmtPct((adSpend / adSales) * 100) : "—"]] });
    } else if (prev && adSpend > prevAdSpend * 1.15 && adSales < prevAdSales * 0.95 && prevAdSales > 0) {
      signals.push({ tone: "watch", badge: "效率承压", title: "广告预算", note: "广告花费上升、广告销售下降，需复核预算与投放结构。", metrics: [["花费", fmtMoney(adSpend)], ["广告销售", fmtMoney(adSales)], ["ACoS", adSales ? fmtPct((adSpend / adSales) * 100) : "—"]] });
    } else {
      signals.push({ tone: "neutral", badge: "保持观察", title: "广告预算", note: "结合花费、广告订单与 ACoS 变化评估是否加减预算。", metrics: [["花费", fmtMoney(adSpend)], ["广告销售", fmtMoney(adSales)], ["ACoS", adSales ? fmtPct((adSpend / adSales) * 100) : "—"]] });
    }

    if (sales > 0 && profit < 0) {
      signals.push({ tone: "critical", badge: "利润风险", title: "促销折扣", note: "窗口订单利润为负，需检查折扣力度与实际利润。", metrics: [["折扣", fmtMoney(promoDiscount)], ["订单利润", fmtMoney(profit)], ["毛利率", fmtPct((profit / sales) * 100)]] });
    } else if (prev && promoDiscount > 0 && profit < prevProfit && prevProfit > 0) {
      signals.push({ tone: "watch", badge: "检查折扣", title: "促销折扣", note: "折扣仍在发生且利润同比下降，复核促销强度。", metrics: [["折扣", fmtMoney(promoDiscount)], ["订单利润", fmtMoney(profit)], ["销量", fmtInt(units)]] });
    } else {
      signals.push({ tone: profit > 0 ? "good" : "neutral", badge: profit > 0 ? "有利润贡献" : "保持观察", title: "促销折扣", note: "结合促销销量、折扣和利润判断是否延续活动。", metrics: [["折扣", fmtMoney(promoDiscount)], ["订单利润", fmtMoney(profit)], ["销量", fmtInt(units)]] });
    }

    const sessDown = prev && prevSessions > 0 && sessions < prevSessions * 0.9;
    const convDown = prev && prevConversion > 0 && conversionRate < prevConversion * 0.9;
    if (sessDown && convDown) {
      signals.push({ tone: "watch", badge: "双项下降", title: "流量转化", note: "流量与转化同时下降，需同时检查流量来源和 Listing。", metrics: [["Sessions", fmtInt(sessions)], ["转化率", fmtPct(conversionRate, 2)], ["订单", fmtInt(orders)]] });
    } else if (convDown) {
      signals.push({ tone: "watch", badge: "转化下降", title: "流量转化", note: "流量未明显下降但转化走弱，优先检查 Listing、价格与优惠。", metrics: [["Sessions", fmtInt(sessions)], ["转化率", fmtPct(conversionRate, 2)], ["订单", fmtInt(orders)]] });
    } else if (sessDown) {
      signals.push({ tone: "neutral", badge: "流量下降", title: "流量转化", note: "转化相对稳定，优先检查流量获取与关键词覆盖。", metrics: [["Sessions", fmtInt(sessions)], ["转化率", fmtPct(conversionRate, 2)], ["订单", fmtInt(orders)]] });
    } else {
      signals.push({ tone: "good", badge: "表现稳定", title: "流量转化", note: "流量与转化未出现同步恶化，维持现有节奏。", metrics: [["Sessions", fmtInt(sessions)], ["转化率", fmtPct(conversionRate, 2)], ["订单", fmtInt(orders)]] });
    }

    const refundRatio = sales ? (refund / sales) * 100 : 0;
    signals.push(refundRatio > 5
      ? { tone: "watch", badge: "退款偏高", title: "售后退款", note: "退款金额占销售额偏高，抽查差评/退货原因。", metrics: [["退款", fmtMoney(refund)], ["占销售", fmtPct(refundRatio)], ["销售", fmtMoney(sales)]] }
      : { tone: "good", badge: "正常", title: "售后退款", note: "退款占比处于可控区间。", metrics: [["退款", fmtMoney(refund)], ["占销售", fmtPct(refundRatio)], ["销售", fmtMoney(sales)]] });
    return signals;
  }

  function renderSignals(cur, prev) {
    const rank = { critical: 0, watch: 1, neutral: 2, good: 3 };
    const top = judgeSignals(cur, prev).sort((a, b) => rank[a.tone] - rank[b.tone]).slice(0, 4);
    document.getElementById("signal-grid").innerHTML = top
      .map((s) => `
      <article class="signal" data-tone="${s.tone}">
        <span class="signal-badge">${s.badge}</span>
        <h3>${s.title}</h3>
        <p>${s.note}</p>
        <div class="signal-metrics">
          ${s.metrics.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join("")}
        </div>
      </article>`)
      .join("");
  }

  function ensureChart(id) {
    if (!window.echarts) return null;
    if (!charts[id]) charts[id] = echarts.init(document.getElementById(id));
    return charts[id];
  }

  const baseTooltip = () => ({
    trigger: "axis",
    backgroundColor: "rgba(255,252,247,0.98)",
    borderColor: COLORS.border,
    textStyle: { color: COLORS.ink, fontSize: 12 },
    axisPointer: { type: "line", lineStyle: { color: "rgba(120,113,108,0.25)" } },
  });

  function axisCommon(labels) {
    return {
      xAxis: {
        type: "category",
        data: labels,
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: COLORS.muted, fontSize: 10 },
        splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } },
      },
    };
  }

  function renderFinancialChart(rows) {
    const chart = ensureChart("chart-financial");
    if (!chart) return;
    const ax = axisCommon(rows.map((r) => r.label));
    chart.setOption({
      color: [COLORS.accent, COLORS.mint, COLORS.violet],
      tooltip: baseTooltip(),
      legend: { data: ["销售额", "订单利润", "广告花费"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 12 },
      grid: { left: 48, right: 24, top: 36, bottom: 28 },
      xAxis: ax.xAxis,
      yAxis: ax.yAxis,
      series: [
        {
          name: "销售额", type: "line", smooth: true, showSymbol: false,
          areaStyle: {
            color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
              { offset: 0, color: "rgba(47,111,237,0.22)" },
              { offset: 1, color: "rgba(47,111,237,0.02)" },
            ]),
          },
          lineStyle: { width: 2, color: COLORS.accent },
          data: rows.map((r) => r.sales),
        },
        { name: "订单利润", type: "line", smooth: true, showSymbol: false, lineStyle: { width: 2, color: COLORS.mint }, data: rows.map((r) => r.orderProfit) },
        { name: "广告花费", type: "line", smooth: true, showSymbol: false, lineStyle: { width: 2, color: COLORS.violet }, data: rows.map((r) => r.adSpend) },
      ],
    });
  }

  function renderDemandChart(rows) {
    const chart = ensureChart("chart-demand");
    if (!chart) return;
    chart.setOption({
      color: [COLORS.muted, COLORS.accent],
      tooltip: baseTooltip(),
      legend: { data: ["Sessions", "销量"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 8 },
      grid: { left: 44, right: 16, top: 36, bottom: 28 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 10 },
      },
      yAxis: [
        { type: "value", axisLabel: { color: COLORS.muted, fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } } },
        { type: "value", axisLabel: { color: COLORS.muted, fontSize: 10 }, splitLine: { show: false } },
      ],
      series: [
        { name: "Sessions", type: "bar", barMaxWidth: 12, itemStyle: { color: "rgba(120,113,108,0.28)", borderRadius: [3, 3, 0, 0] }, data: rows.map((r) => r.sessions) },
        { name: "销量", type: "line", yAxisIndex: 1, smooth: true, showSymbol: false, lineStyle: { width: 2, color: COLORS.accent }, data: rows.map((r) => r.units) },
      ],
    });
  }

  function renderEfficiencyChart(rows) {
    const chart = ensureChart("chart-efficiency");
    if (!chart) return;
    chart.setOption({
      color: [COLORS.mint, COLORS.rose],
      tooltip: { ...baseTooltip(), valueFormatter: (v) => (v == null ? "—" : `${Number(v).toFixed(2)}%`) },
      legend: { data: ["转化率", "综合 ACoS"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 8 },
      grid: { left: 44, right: 44, top: 36, bottom: 28 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 10 },
      },
      yAxis: {
        type: "value",
        axisLabel: { color: COLORS.muted, fontSize: 10, formatter: "{value}%" },
        splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } },
      },
      series: [
        { name: "转化率", type: "line", smooth: true, showSymbol: false, lineStyle: { width: 2, color: COLORS.mint }, data: rows.map((r) => (r.conversionRate == null ? null : +r.conversionRate.toFixed(2))) },
        { name: "综合 ACoS", type: "line", smooth: true, showSymbol: false, lineStyle: { width: 2, color: COLORS.rose }, data: rows.map((r) => (r.acos == null ? null : +r.acos.toFixed(2))) },
      ],
    });
  }

  function renderChannelChart() {
    const chart = ensureChart("chart-channels");
    if (!chart) return;
    const groups = {};
    for (const c of DATA.channels) {
      const key = CHANNEL_LABEL[c.channel] || c.channel;
      if (!groups[key]) groups[key] = { channel: key, spend: 0, sales: 0 };
      groups[key].spend += c.spend;
      groups[key].sales += c.sales;
    }
    const rows = Object.values(groups).sort((a, b) => b.spend - a.spend);
    chart.setOption({
      color: [COLORS.violet, COLORS.accent],
      tooltip: baseTooltip(),
      legend: { data: ["花费", "广告销售"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 8 },
      grid: { left: 48, right: 16, top: 36, bottom: 28 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.channel),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 11 },
      },
      yAxis: { type: "value", axisLabel: { color: COLORS.muted, fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } } },
      series: [
        { name: "花费", type: "bar", barMaxWidth: 28, itemStyle: { color: COLORS.violet, borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.spend) },
        { name: "广告销售", type: "bar", barMaxWidth: 28, itemStyle: { color: COLORS.accent, borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.sales) },
      ],
    });
  }

  function renderPlacementChart() {
    const chart = ensureChart("chart-placements");
    if (!chart) return;
    const rows = DATA.placements.map((p) => ({ ...p, label: PLACEMENT_LABEL[p.placement] || p.placement }));
    chart.setOption({
      color: [COLORS.amber, COLORS.mint],
      tooltip: baseTooltip(),
      legend: { data: ["花费", "广告销售"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 8 },
      grid: { left: 48, right: 16, top: 36, bottom: 48 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.label),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 10, interval: 0, rotate: 18 },
      },
      yAxis: { type: "value", axisLabel: { color: COLORS.muted, fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } } },
      series: [
        { name: "花费", type: "bar", barMaxWidth: 22, itemStyle: { color: COLORS.amber, borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.spend) },
        { name: "广告销售", type: "bar", barMaxWidth: 22, itemStyle: { color: COLORS.mint, borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.sales) },
      ],
    });
  }

  function renderKeywordChart() {
    const chart = ensureChart("chart-keyword-score");
    if (!chart) return;
    const rows = DATA.keywordSummary;
    chart.setOption({
      color: [COLORS.mint, COLORS.violet],
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: "rgba(255,252,247,0.98)", borderColor: COLORS.border, textStyle: { color: COLORS.ink, fontSize: 12 } },
      legend: { data: ["自然流量得分", "广告流量得分"], textStyle: { color: COLORS.muted, fontSize: 11 }, top: 4, right: 8 },
      grid: { left: 48, right: 16, top: 36, bottom: 40 },
      xAxis: {
        type: "category",
        data: rows.map((r) => r.msku),
        axisLine: { lineStyle: { color: COLORS.border } },
        axisLabel: { color: COLORS.muted, fontSize: 10, interval: 0, rotate: 12 },
      },
      yAxis: { type: "value", axisLabel: { color: COLORS.muted, fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(228,220,203,0.9)" } } },
      series: [
        { name: "自然流量得分", type: "bar", stack: "score", barMaxWidth: 34, itemStyle: { color: COLORS.mint }, data: rows.map((r) => r.organicTrafficScore || 0) },
        { name: "广告流量得分", type: "bar", stack: "score", barMaxWidth: 34, itemStyle: { color: COLORS.violet, borderRadius: [4, 4, 0, 0] }, data: rows.map((r) => r.advertisingTrafficScore || 0) },
      ],
    });
  }

  function renderProductTable() {
    const tbody = document.querySelector("#product-table tbody");
    const rows = state.msku === "all" ? DATA.products : DATA.products.filter((p) => p.msku === state.msku);
    tbody.innerHTML = rows
      .map((p, idx) => {
        const color = [COLORS.accent, COLORS.mint, COLORS.violet, COLORS.amber, COLORS.rose][idx % 5];
        return `
        <tr data-msku="${p.msku}" class="${state.msku === p.msku ? "is-active" : ""}">
          <td><span class="msk-tag"><span class="msk-dot" style="background:${color}"></span>${p.msku}</span></td>
          <td title="${p.productName || ""}">${p.productName || "—"}</td>
          <td class="num">${fmtMoney(p.sales)}</td>
          <td class="num">${fmtInt(p.units)}</td>
          <td class="num">${fmtInt(p.orders)}</td>
          <td class="num ${p.orderProfit < 0 ? "tone-down" : "tone-up"}">${fmtMoney(p.orderProfit)}</td>
          <td class="num">${fmtPct(p.orderMargin, 1)}</td>
          <td class="num">${fmtPct(p.conversionRate, 2)}</td>
          <td class="num">${p.acos == null ? "—" : fmtPct(p.acos, 1)}</td>
          <td class="num">${fmtMoney(p.adSpend)}</td>
          <td class="num">${fmtInt(p.sessions)}</td>
        </tr>`;
      })
      .join("");
    tbody.querySelectorAll("tr").forEach((tr) => {
      tr.addEventListener("click", () => {
        const msku = tr.getAttribute("data-msku");
        state.msku = state.msku === msku ? "all" : msku;
        document.getElementById("msku-filter").value = state.msku;
        renderAll();
      });
    });
  }

  function renderAdTables() {
    document.querySelector("#channel-table tbody").innerHTML = DATA.channels
      .map((c) => {
        const label = CHANNEL_LABEL[c.channel] || c.channel;
        return `<tr>
          <td>${label}${label !== c.channel ? ` <span style="color:var(--muted)">(${c.channel})</span>` : ""}</td>
          <td class="num">${fmtInt(c.impressions)}</td>
          <td class="num">${fmtInt(c.clicks)}</td>
          <td class="num">${fmtPct(c.ctr, 2)}</td>
          <td class="num">${fmtMoney(c.spend)}</td>
          <td class="num">${fmtMoney(c.sales)}</td>
          <td class="num">${c.acos == null ? "—" : fmtPct(c.acos, 1)}</td>
          <td class="num">${c.roas == null ? "—" : Number(c.roas).toFixed(2)}</td>
          <td class="num">${fmtInt(c.orders)}</td>
          <td class="num">${fmtPct(c.cvr, 2)}</td>
        </tr>`;
      })
      .join("");

    document.querySelector("#placement-table tbody").innerHTML = DATA.placements
      .map((p) => `<tr>
          <td>${PLACEMENT_LABEL[p.placement] || p.placement}</td>
          <td class="num">${fmtInt(p.impressions)}</td>
          <td class="num">${fmtInt(p.clicks)}</td>
          <td class="num">${fmtMoney(p.spend)}</td>
          <td class="num">${fmtMoney(p.sales)}</td>
          <td class="num">${p.acos == null ? "—" : fmtPct(p.acos, 1)}</td>
          <td class="num">${p.roas == null ? "—" : Number(p.roas).toFixed(2)}</td>
          <td class="num">${fmtInt(p.orders)}</td>
        </tr>`)
      .join("");
  }

  function renderKeywordTable() {
    const rows = DATA.topKeywords.filter((k) => state.msku === "all" || k.msku === state.msku);
    document.querySelector("#keyword-table tbody").innerHTML = rows
      .slice(0, 30)
      .map((k) => {
        const type = k.trafficType === "organic" ? "自然" : k.trafficType === "advertising" ? "广告" : k.trafficType === "both" ? "自然+广告" : "未分类";
        return `<tr>
          <td>${k.searchTerm}</td>
          <td>${k.msku}</td>
          <td>${type}</td>
          <td class="num">${fmtInt(k.totalTraffic)}</td>
          <td class="num">${fmtInt(k.organicTraffic)}</td>
          <td class="num">${fmtInt(k.advertisingTraffic)}</td>
          <td class="num">${k.organicRank == null ? "—" : fmtInt(k.organicRank)}</td>
        </tr>`;
      })
      .join("");
  }

  function renderMeta(win) {
    document.getElementById("active-range-label").textContent = (state.msku === "all" ? "" : state.msku + " · ") + win.label;
    document.getElementById("brand-meta").textContent = `${DATA.meta.store} · ${DATA.meta.dateStart} → ${DATA.meta.dateEnd}`;
    document.getElementById("footer-meta").textContent =
      `数据窗口 ${DATA.meta.dateStart} – ${DATA.meta.dateEnd} · ${DATA.meta.dayCount} 天 · ${DATA.meta.mskuCount} 个 MSKU`;
    document.getElementById("chart-fin-note").textContent = state.grain === "day" ? "按日" : "按周";
  }

  function renderAll() {
    const rows = seriesFor(state.msku);
    const win = resolveWindow(rows);
    const cur = sumRows(win.current);
    const prev = win.previous.length ? sumRows(win.previous) : null;
    renderMeta(win);
    renderKpis(cur, prev);
    renderSignals(cur, prev);
    const grainRows = toGrain(win.current);
    renderFinancialChart(grainRows);
    renderDemandChart(grainRows);
    renderEfficiencyChart(grainRows);
    renderChannelChart();
    renderPlacementChart();
    renderProductTable();
    renderAdTables();
    renderKeywordChart();
    renderKeywordTable();
  }

  function bindControls() {
    document.querySelectorAll("#range-presets button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#range-presets button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.range = btn.dataset.range;
        renderAll();
      });
    });
    document.querySelectorAll("#grain-switch button").forEach((btn) => {
      btn.addEventListener("click", () => {
        document.querySelectorAll("#grain-switch button").forEach((b) => b.classList.remove("is-active"));
        btn.classList.add("is-active");
        state.grain = btn.dataset.grain;
        renderAll();
      });
    });
    const select = document.getElementById("msku-filter");
    select.innerHTML =
      `<option value="all">全部 MSKU</option>` +
      DATA.products.map((p) => `<option value="${p.msku}">${p.msku}</option>`).join("");
    select.addEventListener("change", () => {
      state.msku = select.value;
      renderAll();
    });
    window.addEventListener("resize", () => Object.values(charts).forEach((c) => c.resize()));
  }

  async function tryUnlock(secret) {
    const data = await decryptPayload(secret);
    DATA = data;
    saveKey(secret);
    showApp();
    bindControls();
    renderAll();
  }

  async function boot() {
    if (META?.title) document.title = META.title;
    const fromLoc = readKeyFromLocation();
    const saved = loadSavedKey();
    const candidate = (fromLoc || saved || "").trim();
    if (candidate) {
      try {
        await tryUnlock(candidate);
        if (fromLoc && location.hash) history.replaceState(null, "", location.pathname + location.search);
        return;
      } catch (_) {
        /* fall through to gate */
      }
    }
    showGate(candidate ? "访问码无效或已过期，请重新使用邀请链接。" : "");

    document.getElementById("gate-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      errorEl.textContent = "";
      const code = document.getElementById("gate-code").value.trim();
      if (!code) return;
      try {
        await tryUnlock(code);
      } catch (err) {
        errorEl.textContent = "访问码不正确。";
      }
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
