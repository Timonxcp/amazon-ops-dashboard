/**
 * 领星三份 Excel 导入：产品表现 / 广告活动报告 / SP广告位
 * 产出 product_daily / campaign_daily / placement_daily 行
 */
import { read, SSF, utils } from "./xlsx.mjs";

const PRODUCT_ADDITIVE = {
  units: "销量",
  sales: "销售额",
  orders: "订单量",
  netSales: "净销售额",
  b2bUnits: "B2B 销量",
  b2bSales: "B2B 销售额",
  promoUnits: "促销销量",
  promoSales: "促销销售额",
  promoOrders: "促销订单量",
  promotionDiscount: "促销折扣",
  refundUnits: "退款量",
  refundAmount: "退款金额",
  grossProfit: "结算毛利润",
  orderProfit: "订单毛利润",
  returnUnits: "退货量",
  sessionsBrowser: "Sessions-Browser",
  sessionsMobile: "Sessions/Mobile",
  sessions: "Sessions/Total",
  pageViewsBrowser: "PV/Browser",
  pageViewsMobile: "PV/Mobile",
  pageViews: "PV/Total",
  adSpend: "广告花费",
  adSales: "广告销售额",
  adOrders: "广告订单量",
  directAdOrders: "直接成交订单量",
  directAdSales: "直接成交销售额",
  adImpressions: "展示",
  adClicks: "点击",
  naturalOrders: "自然订单量",
  naturalClicks: "自然点击量",
  spSpend: "SP广告费",
  sbSpend: "SB广告费",
  sbvSpend: "SBV广告费",
  sdSpend: "SD广告费",
};

const PRODUCT_LATEST = {
  price: "价格",
  reviews: "评论数",
  availableInventory: "可用库存",
  fbaAvailable: "FBA/可售",
};

const CAMPAIGN_ADDITIVE = {
  impressions: "曝光量",
  clicks: "点击",
  spend: "花费-本币",
  sales: "销售额-本币",
  directSales: "直接成交销售额-本币",
  indirectSales: "间接成交销售额-本币",
  orders: "广告订单",
  directOrders: "直接成交订单",
  indirectOrders: "间接成交订单",
  units: "广告销量",
};

const PLACEMENT_ADDITIVE = {
  impressions: "曝光量",
  clicks: "点击",
  spend: "花费/本币",
  sales: "销售额/本币",
  directSales: "直接成交销售额/本币",
  indirectSales: "间接成交销售额/本币",
  orders: "广告订单",
  directOrders: "直接成交订单",
  indirectOrders: "间接成交订单",
  units: "广告销量",
};

export const IMPORT_SCHEMAS = [
  {
    queryId: "product_daily",
    label: "产品表现",
    hint: "领星 · 产品表现 / 导出 · 统计维度 ASIN · 按天",
    required: ["日期", "父ASIN", "ASIN", "MSKU", "销量", "销售额", "Sessions/Total", "广告花费"],
  },
  {
    queryId: "campaign_daily",
    label: "广告活动报告",
    hint: "领星 · 广告 · 广告活动报告 · 全类型",
    required: ["店铺名称", "类型", "广告活动", "有效状态", "日期", "曝光量", "点击", "花费-本币"],
  },
  {
    queryId: "placement_daily",
    label: "SP 广告位",
    hint: "领星 · 广告 · 广告位报告 · SP",
    required: ["店铺名称", "类型", "广告活动", "广告位", "日期", "曝光量", "点击", "花费/本币"],
  },
];

const normalizeHeader = (value) =>
  String(value ?? "")
    .replace(/[“”‘’'"]/gu, "")
    .replace(/[ \s]+/gu, " ")
    .replace(/[／/_-]+/gu, "/")
    .trim();

const HEADER_ALIASES = {
  "销售额/本币": ["广告销售额/本币"],
  "直接成交销售额/本币": ["直接销售额/本币"],
  "间接成交销售额/本币": ["间接销售额/本币"],
  "花费-本币": ["花费/本币", "花费/本币"],
  "销售额-本币": ["销售额/本币", "广告销售额-本币"],
};

function headerVariants(header) {
  const normalized = normalizeHeader(header);
  return [...new Set([normalized, ...(HEADER_ALIASES[normalized] ?? []).map(normalizeHeader)])];
}

export function numberValue(value) {
  if (value == null || value === "") return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  if (typeof value === "boolean") return value ? 1 : 0;
  let source = String(value).trim();
  if (!source || source === "--" || source === "/" || /无销售额|无数据/u.test(source)) return 0;
  const negative = /^\(.*\)$/u.test(source);
  const percent = source.endsWith("%");
  source = source.replace(/[,$￥¥%()\s]/gu, "");
  const parsed = Number(source);
  if (!Number.isFinite(parsed)) return 0;
  return (negative ? -parsed : parsed) / (percent ? 100 : 1);
}

const pad = (value) => String(value).padStart(2, "0");

export function dateValue(value) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    const parsed = SSF.parse_date_code(value);
    return parsed ? `${parsed.y}-${pad(parsed.m)}-${pad(parsed.d)}` : "";
  }
  const source = String(value ?? "").trim();
  if (!source) return "";
  let match = source.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})/u);
  if (match) return `${match[1]}-${pad(match[2])}-${pad(match[3])}`;
  match = source.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/u);
  if (match) return `${match[3]}-${pad(match[1])}-${pad(match[2])}`;
  const parsed = new Date(source);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString().slice(0, 10) : "";
}

function headerIndex(row) {
  return new Map(row.map((value, index) => [normalizeHeader(value), index]).filter(([header]) => header));
}

function rawAt(row, index, header) {
  for (const variant of headerVariants(header)) {
    const at = index.get(variant);
    if (at != null) return row[at];
  }
  return null;
}

function hasHeader(index, header) {
  return headerVariants(header).some((variant) => index.has(variant));
}

function detectSchema(matrix) {
  for (let rowIndex = 0; rowIndex < Math.min(8, matrix.length); rowIndex += 1) {
    const index = headerIndex(matrix[rowIndex] ?? []);
    for (const schema of IMPORT_SCHEMAS) {
      if (schema.required.every((header) => hasHeader(index, header))) {
        return { schema, index, dataStart: rowIndex + 1 };
      }
    }
  }
  return null;
}

export function parseWorkbook(buffer, fallbackName = "") {
  const wb = read(buffer, { type: "array", cellDates: true });
  const results = [];
  for (const name of wb.SheetNames) {
    const sheet = wb.Sheets[name];
    const matrix = utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null, blankrows: false });
    const candidate = detectSchema(matrix);
    if (!candidate) continue;
    results.push(buildRows(candidate, matrix, fallbackName || name));
  }
  return results;
}

function buildRows({ schema, index, dataStart }, matrix, sheetName) {
  const text = (value) => (value == null ? "" : String(value).trim());
  const rows = [];
  if (schema.queryId === "product_daily") {
    const groups = new Map();
    for (let i = dataStart; i < matrix.length; i += 1) {
      const row = matrix[i] ?? [];
      const date = dateValue(rawAt(row, index, "日期"));
      const msku = text(rawAt(row, index, "MSKU"));
      if (!date) continue;
      const identity = {
        date,
        store: text(rawAt(row, index, "店铺")) || "BouncePixel-US",
        parentAsin: text(rawAt(row, index, "父ASIN")) || "-",
        asin: text(rawAt(row, index, "ASIN")) || "-",
        msku: msku || "-",
        sku: text(rawAt(row, index, "SKU")),
        productName: text(rawAt(row, index, "品名")),
        title: text(rawAt(row, index, "标题")),
        brand: text(rawAt(row, index, "品牌")),
      };
      const key = `${identity.date}|${identity.store}|${identity.parentAsin}|${identity.asin}|${identity.msku}|${identity.sku}`;
      if (!groups.has(key)) {
        groups.set(key, {
          key,
          ...identity,
          ...Object.fromEntries(Object.keys(PRODUCT_ADDITIVE).map((field) => [field, 0])),
          ...Object.fromEntries(Object.keys(PRODUCT_LATEST).map((field) => [field, 0])),
        });
      }
      const target = groups.get(key);
      for (const [field, header] of Object.entries(PRODUCT_ADDITIVE)) {
        target[field] += numberValue(rawAt(row, index, header));
      }
      for (const [field, header] of Object.entries(PRODUCT_LATEST)) {
        const raw = rawAt(row, index, header);
        if (raw != null && raw !== "") target[field] = numberValue(raw);
      }
    }
    rows.push(...groups.values());
    return {
      queryId: schema.queryId,
      label: schema.label,
      sheetName,
      rowCount: rows.length,
      rows,
      dateStart: rows.reduce((m, r) => (r.date < m || !m ? r.date : m), ""),
      dateEnd: rows.reduce((m, r) => (r.date > m ? r.date : m), ""),
    };
  }

  const additive = schema.queryId === "campaign_daily" ? CAMPAIGN_ADDITIVE : PLACEMENT_ADDITIVE;
  const groups = new Map();
  for (let i = dataStart; i < matrix.length; i += 1) {
    const row = matrix[i] ?? [];
    const date = dateValue(rawAt(row, index, "日期"));
    if (!date) continue;
    const identity = {
      date,
      store: text(rawAt(row, index, "店铺名称")),
      country: text(rawAt(row, index, "国家")) || "US",
      channel: text(rawAt(row, index, "类型")) || "SP",
      portfolio: text(rawAt(row, index, "广告组合")),
      campaign: text(rawAt(row, index, "广告活动")),
    };
    if (schema.queryId === "placement_daily") {
      identity.placement = text(rawAt(row, index, "广告位")) || "其他";
    } else {
      identity.status = text(rawAt(row, index, "有效状态"));
    }
    const key =
      schema.queryId === "placement_daily"
        ? `${date}|${identity.store}|${identity.channel}|${identity.portfolio}|${identity.campaign}|${identity.placement}`
        : `${date}|${identity.store}|${identity.channel}|${identity.portfolio}|${identity.campaign}|${identity.status}`;
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        ...identity,
        ...Object.fromEntries(Object.keys(additive).map((field) => [field, 0])),
      });
    }
    const target = groups.get(key);
    for (const [field, header] of Object.entries(additive)) {
      target[field] += numberValue(rawAt(row, index, header));
    }
  }
  rows.push(...groups.values());
  return {
    queryId: schema.queryId,
    label: schema.label,
    sheetName,
    rowCount: rows.length,
    rows,
    dateStart: rows.reduce((m, r) => (r.date < m || !m ? r.date : m), ""),
    dateEnd: rows.reduce((m, r) => (r.date > m ? r.date : m), ""),
  };
}

export function mergeQueryRows(existingRows = [], incomingRows = []) {
  const map = new Map(existingRows.map((row) => [row.key, row]));
  for (const row of incomingRows) map.set(row.key, row);
  return [...map.values()].sort((a, b) => String(a.key).localeCompare(String(b.key)));
}

export function classifyFiles(fileList) {
  // Returns [{file, parsePromise}] after reading; classification happens after parse.
  return [...fileList];
}
