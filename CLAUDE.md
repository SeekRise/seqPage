# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

SeqPage — Chrome 新标签页个人导航工作台扩展。技术栈：**Manifest V3 + Vue 3（`<script setup>` + Composition API）+ TypeScript（strict）+ Vite 7 + SortableJS + Naive UI**。本地优先：数据全部存 `chrome.storage.local`，零后端、零 CDN、运行时依赖为 `vue`、`sortablejs`、`naive-ui`（CSS-in-JS 运行时注入样式，无外部 CSS/资源请求，兼容 MV3 CSP）。

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
| `npm run shot` / `npm run measure` / `npm run icons` | 截图 / 布局测量 / 由 `icon.jfif` 生成扩展图标 |

除 `dev`/`build` 外的测试命令需要本机装有 Chrome 或 Edge，未找到时自动跳过并返回成功（测试退出码为 0 不代表真的跑过了）。没有单元测试框架——验证依赖 `tools/` 下的自研 Node 脚本（smoke-test.mjs、verify-dist.mjs 等）。

**注意 `dev` 与 `smoke` 都不走真实的 `chrome.storage` 路径**：`smoke-test.mjs` 刻意用 headless Chrome 以普通网页方式加载，并在页面脚本前把 `chrome.storage` 置空，强制应用走 localStorage 回退（避免污染真实用户配置）。因此涉及 storage/repository 的改动，自动化脚本只能验证「回退路径」，**真实扩展环境（`chrome-extension://`）必须手动加载 `dist/` 验证**。

`@/` 是唯一路径别名（`vite.config.ts` 的 resolve.alias + `tsconfig.app.json` 的 paths 双处配置，改一处必改另一处），指向 `src/`；跨目录引用一律用 `@/`。

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

**关键约定：组件绝不直接调用 repository**，一切读写经 `store.ts`。**唯一例外**是 `composables/useSearchHistory.ts`——搜索历史刻意存在 store 文档之外（独立键 `mynavi:searchHistory`），因此它直接 import `storage.ts` 的 `readRaw`/`writeRaw`。新增功能不要效仿这个例外。

`store.ts` 之外的服务层各司其职，都被 store 或组件复用：

| 文件 | 职责 | 约束 |
| --- | --- | --- |
| `services/navigation.ts` | 纯数据操作：排序连续化、完整性修复、演示数据生成 | 不碰存储，只接收/返回数据 |
| `services/search.ts` | 本地搜索索引（预建小写化检索文本）+ 打分排序 | 纯只读计算，零网络请求 |
| `services/importExport.ts` | 导入校验 / 导出负载 / 文件下载 | **校验全部通过后才由调用方覆盖**，导入失败绝不清空现有配置 |
| `services/favicon.ts` | 图标候选地址生成 | 与 `composables/useFavicon.ts` 配合完成多级降级 |

`utils/constants.ts` 与 `utils/validators.ts` 是校验与常量的**单一来源**：搜索引擎地址模板集中在 `SEARCH_ENGINES`（组件中不得再硬编码搜索地址），导入校验与表单校验共用同一套 `FIELD_LIMITS` 上限与 `validators.ts` 解析函数——改一处即同时生效于两条入口。

### 布局与视觉（改版后）

- 页面结构：**左侧边栏 184px（可隐藏）+ 顶部工具栏（56px）+ 可选时钟区 + 多列分区卡片**。
- **操作入口刻意去重，改 UI 时不要重新摊开**：
  - 顶栏右侧只有一个主要动作「添加」（菜单含 添加网站 / 新建分区）与一个「更多」菜单
    （收藏 / 最近访问、批量管理）。收藏与批量**不再常驻顶栏**。
  - **设置只有一个入口**，在侧边栏底部；顶栏不放设置按钮。
  - 页面新增/重命名/删除/排序统一走侧栏每项右侧的「页面操作」菜单（`pageMenuItems`）；
    侧栏不摆独立的「新建导航页面」按钮，底部也**不再有「页面管理」入口**
    （`PageManagerModal` 已整体移除，改 UI 时不要重新摊开这个入口）。
  - **新建分区也在同一份页面菜单里**（侧栏任意页面右键即可）。在非当前页上操作会
    先切到该页再弹表单（`requestCreateSection(pageId)`），建完立刻能看到结果。
    模板里必须写成 `requestCreateSection()`——直接写方法名会把 MouseEvent 当成 pageId。
  - 分区标题栏只有折叠 + 更多操作，编辑/排序/删除在菜单里（`sectionMenuItems`）。
  - 搜索框旁原有的「快捷添加当前网页」`+` 与「添加 → 添加网站」是同一个方法，已移除。
- 顶栏下拉用 Naive UI 的 `NDropdown`（自带定位、Esc 与点击外部关闭）；
  收藏面板是自建浮层，它的点击外部关闭在 `App.vue` 的 `onDocumentPointerDown` 里。
- `.app` 的 DOM 顺序固定为 `[Sidebar, main]`，视觉左右用 `flex-direction` 翻转
  （默认 `row`，`[data-sidebar-position='right']` 才 `row-reverse`）。
  **不要调整这两个子元素的顺序**：Vue 会按下标复用未加 key 的片段子节点，
  插入元素会让 Sidebar 与 main 一起重建，拖拽实例与滚动位置都会丢。
- 侧边栏隐藏用 `display: none`（`.app--sidebar-hidden`），**绝不能用 `v-if`**；
  状态存在 `settings.sidebarVisible`。
- **多列网格用容器查询（`@container workbench`），不是视口媒体查询**：
  决定列数的是「扣掉侧边栏、再被 `--content-max-width` 封顶」后的可用宽度，
  视口宽度在这个布局里是错的度量（隐藏侧边栏会改列数但视口不变）。
  容器（`container: workbench / inline-size`）打在 `.app__content` 上——只有这层
  同时受侧边栏宽度与 max-width 约束。断点 650/1000/1400 → 2/3/4 列。
- `.app__sections` 用 `align-items: start`，卡片高度才由内容决定而不被同行拉平。
- 视觉基调：浅灰底 + 纯白卡片 + 细边框 + 极轻阴影 + 少量蓝色强调。
  **刻意不做玻璃拟态**（`backdrop-filter` 已移除）、不做渐变、不做霓虹。
- 密度设置 `cardDensity` 通过 `--row-padding`（网站条目内边距）与 `--section-min-width`
  生效——不是 `min-height`：图标固定 32px，用 min-height 定高在多数取值下会被内容顶开。
- `--panel-opacity` 通过 `color-mix` 用在 `.section-panel` 背景上（此前是无人消费的死变量）。

### 存储模型

- 整份配置是**单一物理键** `mynavi:state` 下的一个 JSON 文档（原子写入、读取路径唯一）；搜索历史单独放 `mynavi:searchHistory`。
- 写操作走**串行写队列**，采用「乐观更新 + 失败回滚」；存储层从不抛异常，统一返回 `Result` 由 UI 决定提示。
- 所有写操作走 `store.ts` 内部的 `mutate()` 统一入口（备份快照 → 变更 → 持久化 → 失败回滚）；新写操作应复用它，不要自己拼持久化逻辑。
- 每次写入前把「下一个状态」序列化成 JSON 与 `persistedSnapshot` 比对，**完全一致则跳过写盘**（拖拽等操作常算出等价状态）。高频操作（排序/移动）传 `{ debounceMs: 0 }` 合并写入——注意这条路径**立即返回 `ok: true` 而不等待落盘**，所以它不承担错误提示职责，需要落盘结果时用 `store.flush()`。
- `replaceState(next, { force: true })` 是**解除 `writeProtected` 的唯一入口**，只能由用户在二次确认后触发（导入 / 恢复默认 / 清空数据三条路径）。任何新增的「整体覆盖」功能都必须走这条既有路径，不得另开旁路。
- `writeProtected` 只读保护：读取失败（数据损坏）时进入冻结模式，拦截所有写入，防止空状态覆盖用户数据——这是刻意的数据安全底线，`npm run corrupt` 锁定该行为。
- 历史构建曾把数组存成以数字为键的对象（`{"0":{…}}`），读取时自动还原，`npm run legacy` 锁定该兼容路径。改动 storage/repository 时这两个测试必须保持通过。

### 数据模型（src/types/index.ts）

- 实体：`NavigationPage` → `Section`（pageId 关联）→ `Website`（pageId + sectionId 关联），外加 `AppSettings`、`RecentVisit`。
- 所有实体用稳定唯一 ID（`createId()`），**绝不用数组下标**；排序用独立 `order` 字段，重排后连续化。
- **修改数据结构时必须将 `SCHEMA_VERSION` +1，并在 repository.ts 补迁移逻辑**（当前为 v2）。
  纯增量的新设置字段同时要在 `validators.ts` 的 `parseSettings` 里补回填——那是老用户读取时
  真正生效的默认值来源，漏了会得到 `undefined`；迁移分支本身只负责版本号与结构，可不发提示。
- `theme` 默认 `light`、`sidebarPosition` 默认 `left`、`remoteFavicon` **默认 `false`**
  （默认不请求第三方 favicon 服务；降级链最后一级是本地首字母图标，永不失败）。
- 浅色页面背景色有**三个副本必须同步**：`variables.css` 的 `--bg-page`、
  `constants.ts` 的 `DEFAULT_BACKGROUND.color`、以及 `useTheme.ts` 里「是否默认背景」的判断。
  后者已改为与 `DEFAULT_BACKGROUND` 比较而非硬编码色值，改配色时只需同步前两处。
- 删除页面/分区必须显式处理关联网站（级联删除或迁移），并在 UI 层二次确认。
- **分区与网站的数量上限集中在 `CREATION_LIMITS`（constants.ts）**：每个导航页面最多
  4 个分区、每个分区最多 12 个网站（约一屏高度）。守卫分三层，缺一不可：
  `store.addSection` / `store.addWebsite`（数据层兜底）、`store.moveWebsites`
  （移动同样会让目标分区超限，必须一起守）、以及 UI 的菜单项 `disabled` +
  `SectionPanel` 的 `.section-panel__add` `disabled`（先拦住，别让用户点了才报错）。
  **只拦新增，不裁剪已有数据**：历史配置与导入的备份即使超限也原样保留，只是不能再加
  ——`FIELD_LIMITS` 里的宽松阈值继续只服务于导入校验，两者不要合并。
  演示数据（`demo.ts`）必须自身符合该上限，否则会自相矛盾。
- **背景图上传不新增字段**：`utils/image.ts` 把用户选的图片等比缩放到最长边 1920、
  编码成 WebP data URL（保留透明通道且比 PNG/JPEG 小），直接写进现有的
  `background.imageUrl`（该字段本就接受 `data:image/`）。因此它同时吃
  `chrome.storage.local`（约 10 MB）与导出文件（上限 5 MB）的额度，
  上限集中在 `constants.ts` 的 `BACKGROUND_IMAGE_LIMITS`——调大任何一个都要先算这两笔账。
  SVG 被排除（可内嵌脚本与外链，画进 canvas 还可能触发 taint）。
  存进去的 data URL 会跟着导出/导入走，`parseSettings` 对 `imageUrl` 不做截断，
  长度把关只能靠上传时的压缩。

### MV3 / CSP 硬约束（`npm run verify` 会自动检查，违反即构建失败级别的问题）

- `vite.config.ts` 的 `base: './'` 不可改——扩展页面跑在 `chrome-extension://` 协议下，绝对路径资源会 404。
- `manifest.json` 与静态资源放 `public/`，Vite 原样拷贝，`dist/` 即可直接加载的扩展目录。
- `public/background.js` 是 MV3 Service Worker，**刻意保持极简**：只做「点击工具栏图标打开工作台」和「首次安装打开一次引导」。不要在其中加入数据同步、网络请求或标签页监控——那会让 Worker 常驻并带来额外权限审查。扩展名称/描述改的是**两个字面量副本**（`manifest.json` 与 `_locales/zh_CN/messages.json`，`default_locale` 声明后 `verify` 会检查该目录存在），必须同步修改。
- 禁止任何运行时远程资源（脚本/样式/字体/CDN）；禁止 `eval`、`new Function`、`v-html`。
- 权限最小化：仅 `storage`、`tabs`、`favicon`，不加 `host_permissions` 及高危权限。
- URL 处理统一走 `utils/url.ts`：拒绝 `javascript:`、`data:`、`file:` 协议，缺协议自动补 `https://`。
- 图标按多级降级策略（`useFavicon.ts` / `services/favicon.ts`）：手动地址 → 首字母 → chrome.favicon → 站点 favicon.ico → 第三方服务（可在设置关闭）→ 本地首字母图标（永不失败）。

### 有意不用的东西（改之前先了解原因）

- **组件库用 Naive UI，仅渐进式接入**：设置面板已迁移（`SettingsPanel.vue` + `App.vue` 根部的 `NConfigProvider`，主题桥接在 `src/composables/useNaiveTheme.ts`）；其余组件（AppModal、ConfirmDialog、Toast 等）仍是自建轻量组件，后续按需迁移。**禁止引入依赖远程资源的组件库**（如 TDesign 的 svg-sprite 走 CDN 脚本，会被 MV3 CSP 拦截）。
- **不用 Pinia**：`store.ts` 是手写的轻量状态中心。
- **不用跨分区拖拽**：跨分区移动走「移动到其它分区」菜单（对触屏更友好，属已确认的取舍）。
- **测试定位用 data-testid**：`SettingsPanel` 的关键控件带 `setting-{组}-{值}` 形式的 testid，测试脚本依赖它而非 Naive UI 内部 class（唯一例外：四分组数量断言用 `.n-tabs-tab`）。迁移其他组件时沿用此约定。
- **`NColorPicker` 只能用 `@update:value`，禁用 `@complete`**：受控用法（传了 `:value`）下
  它的 `complete` 读的是内部 `mergedValueRef`，而受控时那就是**变更前的 `props.value`**
  （见 `node_modules/vooks/es/use-merged-state.js`），于是回传的永远是旧颜色，
  表现为「取色器怎么点背景都不变」。但 `update:value` 会随拖动逐帧触发，
  所以取色与滑块统一走 `SettingsPanel` 的 `stageBackground()`
  （先写 CSS 变量做即时预览，停手 250ms 再合并成一次落盘）；
  模板里不要再直接 `emit` 背景变更，预览与落盘会在存储层面打架。

## 其他注意事项

- `.npmrc` 已将 registry 指向 npmmirror（国内镜像）。沙箱中 `npm install` 若因 esbuild postinstall 报 `spawn EPERM`，用 `npm install --ignore-scripts`，再用 `node tools/check-esbuild.mjs` 确认 esbuild 可用。
- TypeScript 为 strict 模式，无 `any`、无 `@ts-ignore`，这是项目明示的编码标准。
- 排查「配置没有恢复」类问题：扩展页控制台执行 `__MYNAVI__.bootTrace()` 查看启动轨迹、`__MYNAVI__.backend` 查看存储后端。该诊断桥在 `src/main.ts` 的 `exposeDiagnostics()`，另有 `writeProtected`（当前是否只读保护）、`flush()`（立即落盘）、`attemptWrites()`（逐个尝试各类写入并返回结果，用于验证保护确实生效）、`forceClear()`。**只调用 store 已有公开方法，不得为它加绕过持久化/回滚的旁路**；`tools/` 下的 corrupt/legacy/smoke 测试都依赖这个桥，改它的签名会连带改测试脚本。
- 首次运行写入演示数据（`data/demo.ts` + `meta.initialized` 标记），这是用户第一次打开时看到的内容。
- **测试脚本把类名与按钮文案当契约**，改动 UI 时优先保留而不是重命名：
  `.website-card*`、`.section-panel*`（含 `.section-panel__header .section-panel__collapse`
  这一后代关系、`.section-panel__header--collapsed`）、`.sidebar__item/__link/__page-name/__add/__tool`、
  `.app__page-title h1`（**两个脚本**都断言它）、`.app__empty button`；
  网站条目三个按钮的 `aria-label` 必须保持为 `收藏`/`取消收藏`/`编辑网站`/`删除网站`；
  设置入口（侧边栏底部 `.sidebar__tool`）必须有一个按钮文本精确为「设置」——
  脚本靠文本而非 testid 定位它；设置分组**必须保持 4 个**（`tabs.length === 4`），
  新增开关要放进既有的「外观」分组，不要加第 5 个 tab。
  「外观」里的主题模式与导航栏位置是**纯图标按钮**（文案只在 `title` / `aria-label`），
  脚本按 `setting-theme-{mode}` / `setting-sidebar-{side}` 定位，
  不要再往里塞文字标签——那会让两处断言重新变成文本匹配。
- 拖拽手柄必须是**独立元素**（`.section-panel__grip` / `.website-card__grip`），
  不要用整个容器或标题栏当 `handle`——那样点击其中的按钮会被拖拽吞掉。
  网站的 grip 必须是 `<button.website-card__main>` 的**兄弟节点**，嵌进去既非法也会误触打开。
- `.app__sections` 是分区拖拽容器，而 `useSortable` 用**后代**选择器收集 `[data-sortable-id]`，
  所以它里面**只能放 `.section-panel`**：时钟、空状态、占位卡片都必须放在它外面。
- 拖拽排序**没有任何自动化覆盖**（脚本都不模拟拖放），改动手柄或排序逻辑必须手动在浏览器里验证。
