# Amazon 美国站经营大盘 · 重设计规格

## 风格锚点

对标 **Stripe Dashboard / Linear Insights / Vercel Analytics** 的「深夜任务台」质感，而不是传统 Excel 式卡片堆叠。气质关键词：冷静、精密、发光数据、高信息密度但不吵。

## 色板

| 角色 | 色值 | 用途 |
|------|------|------|
| Void 背景 | `#070B10` | 页面底 |
| Surface | `#0F151D` | 卡片/面板 |
| Surface-2 | `#161E29` | 抬升行/hover |
| Border | `#243041` | 描边 |
| Ink | `#F2F7FC` | 主文字 |
| Muted | `#8A9BB0` | 次要文字 |
| Mint | `#3DDC97` | 利润 / 正向 |
| Electric | `#5B8CFF` | 销售额主序列 |
| Violet | `#C084FC` | 广告 |
| Amber | `#FFB454` | 预警 |
| Rose | `#FF6B8A` | 负向 / 风险 |

## 字体

- UI：`Inter, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- 数字：`"JetBrains Mono", ui-monospace, monospace` + `font-variant-numeric: tabular-nums`
- 层级：KPI 数字 40–48px / 500；区块眉题 11px 大写 + 0.12em 字距；正文 13–14px

## 布局系统

- 最大内容宽 1280px，两侧 24px gutter；区块间距 28px
- 顶栏 sticky：品牌 + 日期预设 + 粒度（日/周）+ MSKU 筛选
- 首屏 6 枚 KPI 玻璃条 → 信号雷达（决策）→ 图表双列 → 产品榜 → 广告 → 关键词
- 密度：桌面一行 3–4 KPI，图表高 260–320px；移动端单列

## 信息架构（替代原项目）

1. **总览信号** — 近 7 天 vs 前 7 天：销售、订单利润、广告花费、销量、转化率、ACoS
2. **优先动作** — 规则信号（广告无单 / 利润承压 / 流量转化双降等），与原「五项行动」同源逻辑但视觉重做
3. **经营趋势** — 销售额/利润/广告花费面积折线；Sessions 与销量；转化率与 ACoS
4. **产品作战榜** — MSKU 销售额、利润、转化、ACoS、库存
5. **广告结构** — SP/SB/SD 花费与产出、SP 广告位四象限
6. **关键词势能** — 自然 vs 广告流量得分、Top 搜索词

## 签名体验

1. KPI 数字 count-up + 环比 delta 色带（Mint/Rose）
2. 「信号卡」需关注时边缘微光 + 徽章
3. 图表渐变面积 + 十字准线联动
4. 顶部日期/粒度切换即时重绘，无整页刷新

## 技术

- 纯静态：`index.html` + `css/styles.css` + `js/app.js` + `js/data.js`
- 图表：ECharts 5（CDN）
- 数据：由 `scripts/build-data.mjs` 从历史 reviewed 快照聚合生成
- 部署：GitHub Pages（长期、免登录）
