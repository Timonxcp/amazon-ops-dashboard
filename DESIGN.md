# Amazon 美国站经营大盘 · 重设计规格（浅色）

## 风格锚点

对标 **Stripe Dashboard（浅色）/ Notion / 纸质卷宗**：干净纸面、细线分割、留白克制、数据清晰。去掉暗黑霓虹，改为明亮专业报表气质。

## 色板

| 角色 | 色值 | 用途 |
|------|------|------|
| Paper 背景 | `#F4F1EA` | 页面底（暖纸） |
| Surface | `#FFFCF7` | 卡片 |
| Surface-2 | `#FFFFFF` | 抬升行 / 表头 |
| Border | `#E4DxCC` → `#E4DCCB` | 细边 |
| Ink | `#1C1917` | 主文字 |
| Muted | `#78716C` | 次要文字 |
| Accent | `#2F6FED` | 主强调（销售 / 链接） |
| Mint | `#0F9D6E` | 利润 / 正向 |
| Violet | `#7C5CFF` | 广告 |
| Amber | `#C47B00` | 预警 |
| Rose | `#D6455D` | 负向 / 风险 |

## 字体

- UI：`"Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
- 数字：等宽系统栈 + `tabular-nums`
- 层级：KPI 32–40px / 600；眉题 11px 大写字距；正文 13–14px

## 布局

- 内容宽 1280px，浅色卡片 + 1px 细边 + 极浅阴影
- 顶栏：纸白磨砂，品牌 + 日期 / 粒度 / MSKU
- 首屏 KPI 条 → 信号 → 趋势 → 产品榜 → 广告 → 关键词
- 信号卡用浅色底 + 左侧色条，不用发光边

## 访问控制（无感）

- 邀请链接：`index.html#k=<base64url-key>`
- 数据 `data.enc.js` 为 AES-256-GCM 密文；密钥只在链接 fragment / localStorage
- 首次打开即解密进入（无感）；无密钥显示浅色邀请说明页
- 公开仓库仅含密文，不含明文经营数据

## 技术

- 静态：`index.html` + `css/styles.css` + `js/app.js` + `js/data.enc.js` + `js/echarts.min.js`
- 构建：`scripts/build-data.mjs` 聚合并加密
- 部署：GitHub Pages（长期）+ 邀请链接收权
