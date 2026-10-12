# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

My Navi — Chrome 新标签页个人导航工作台扩展。技术栈：**Manifest V3 + Vue 3（`<script setup>` + Composition API）+ TypeScript（strict）+ Vite 7 + SortableJS**。本地优先：数据全部存 `chrome.storage.local`，零后端、零 CDN、运行时依赖仅 `vue` 和 `sortablejs`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | Vite 开发服务器（localhost:5173），存储自动回退 localStorage |
| `npm run build` | 类型检查（vue-tsc）+ 生产构建到 `dist/` |
| `npm run build:only` | 只构建，跳过类型检查 |
| `npm run type-check` | 仅类型检查（无 ESLint/Prettier，这就是唯一的静态检查） |
| `npm run verify` | 构建产物自检：manifest、图标、权限最小化、CSP、无 CDN/eval 等 |
| `npm run smoke` | headless Chrome 真实加载 `dist/` 的运行时冒烟测试 |
| `npm run legacy` | 旧「对象映射」存储格式的兼容性回归测试 |
| `npm run corrupt` | 不可解析数据的只读保护测试（验证绝不覆盖用户数据） |
| `npm run check` | 全量验证：type-check → build:only → verify → legacy → corrupt → smoke |
| `npm run shot` / `npm run measure` / `npm run icons` | 截图 / 布局测量 / 重新生成图标 |

除 `dev`/`build` 外的测试命令需要本机装有 Chrome 或 Edge，未找到时自动跳过并返回成功（测试退出码为 0 不代表真的跑过了）。没有单元测试框架——验证依赖 `tools/` 下的自研 Node 脚本（smoke-test.mjs、verify-dist.mjs 等）。

手动验收流程：`npm run build` → `chrome://extensions/` 开发者模式 → 加载已解压的扩展程序 → 选择 **`dist/` 目录**（不是项目根目录）→ 改代码后重新 build 并在扩展页点「重新加载」。

## 架构

### 数据流分层（核心）

```
components/（只读 state + 调用 store 语义化方法）
    ↓
services/store.ts        唯一状态真相 + 全部写操作 + 持久化编排（不引入 Pinia）
    ↓
services/repository.ts   NaviRepository 接口 + schemaVersion 版本迁移
    ↓
services/storage.ts      chrome.storage.local 封装（localStorage 回退）
```

**关键约定：组件绝不直接调用 repository**，一切读写经 `store.ts`。纯数据操作（排序、完整性修复、演示数据生成）在 `services/navigation.ts`，与存储无关、可被 store 复用。

### 存储模型

- 整份配置是**单一物理键** `mynavi:state` 下的一个 JSON 文档（原子写入、读取路径唯一）；搜索历史单独放 `mynavi:searchHistory`。
- 写操作走**串行写队列**，采用「乐观更新 + 失败回滚」；存储层从不抛异常，统一返回 `Result` 由 UI 决定提示。
- `writeProtected` 只读保护：读取失败（数据损坏）时进入冻结模式，拦截所有写入，防止空状态覆盖用户数据——这是刻意的数据安全底线，`npm run corrupt` 锁定该行为。
- 历史构建曾把数组存成以数字为键的对象（`{"0":{…}}`），读取时自动还原，`npm run legacy` 锁定该兼容路径。改动 storage/repository 时这两个测试必须保持通过。

### 数据模型（src/types/index.ts）

- 实体：`NavigationPage` → `Section`（pageId 关联）→ `Website`（pageId + sectionId 关联），外加 `AppSettings`、`RecentVisit`。
- 所有实体用稳定唯一 ID（`createId()`），**绝不用数组下标**；排序用独立 `order` 字段，重排后连续化。
- **修改数据结构时必须将 `SCHEMA_VERSION` +1，并在 repository.ts 补迁移逻辑**。
- 删除页面/分区必须显式处理关联网站（级联删除或迁移），并在 UI 层二次确认。

### MV3 / CSP 硬约束（`npm run verify` 会自动检查，违反即构建失败级别的问题）

- `vite.config.ts` 的 `base: './'` 不可改——扩展页面跑在 `chrome-extension://` 协议下，绝对路径资源会 404。
- `manifest.json` 与静态资源放 `public/`，Vite 原样拷贝，`dist/` 即可直接加载的扩展目录。
- 禁止任何运行时远程资源（脚本/样式/字体/CDN）；禁止 `eval`、`new Function`、`v-html`。
- 权限最小化：仅 `storage`、`tabs`、`favicon`，不加 `host_permissions` 及高危权限。
- URL 处理统一走 `utils/url.ts`：拒绝 `javascript:`、`data:`、`file:` 协议，缺协议自动补 `https://`。
- 图标按多级降级策略（`useFavicon.ts` / `services/favicon.ts`）：手动地址 → 首字母 → chrome.favicon → 站点 favicon.ico → 第三方服务（可在设置关闭）→ 本地首字母图标（永不失败）。

### 有意不用的东西（改之前先了解原因）

- **不用组件库**（如 TDesign）：其 svg-sprite 依赖远程脚本，被 MV3 CSP 拦截；本项目自建弹窗/确认框/右键菜单/图标等轻量组件（约 600 行，零运行时依赖）。
- **不用 Pinia**：`store.ts` 是手写的轻量状态中心。
- **不用跨分区拖拽**：跨分区移动走「移动到其它分区」菜单（对触屏更友好，属已确认的取舍）。

## 其他注意事项

- `.npmrc` 已将 registry 指向 npmmirror（国内镜像）。沙箱中 `npm install` 若因 esbuild postinstall 报 `spawn EPERM`，用 `npm install --ignore-scripts`，再用 `node tools/check-esbuild.mjs` 确认 esbuild 可用。
- TypeScript 为 strict 模式，无 `any`、无 `@ts-ignore`，这是项目明示的编码标准。
- 排查「配置没有恢复」类问题：扩展页控制台执行 `__MYNAVI__.bootTrace()` 查看启动轨迹、`__MYNAVI__.backend` 查看存储后端。
- 侧边栏左右切换的实现是容器 `flex-direction: row-reverse`，侧边栏始终是 DOM 第一个子元素——**切换位置不能重建组件**（否则 SortableJS 实例、折叠状态、滚动位置会丢失）。
