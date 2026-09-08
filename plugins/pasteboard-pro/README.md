# Paste剪切板

Paste剪切板是一款 Paste 风格的本地优先剪贴板历史插件。它提供独立贴边浮窗、实时历史、搜索、分组、预览、快捷粘贴与连续粘贴队列，并为 ATools 和 ZTools 分别提供原生宿主实现。

> 内部插件 ID、包名和同步协议继续使用 `pasteboard-pro` / `PasteboardPro/v1`，用于保持安装、数据与跨宿主同步兼容；用户界面统一显示“Paste剪切板”。

## 界面截图

![Paste剪切板主界面](./screenshots/main.png)

## 核心功能

- 自动记录文本、富文本、HTML、URL、颜色、图片、PDF 和文件剪贴板内容。
- 首次运行后自动登记为随 ZTools 启动，并在后台持续监听剪贴板变化。
- 按内容、来源 App、日期、类型和分组搜索历史。
- 创建、重命名、排序和着色分组，支持拖动内容加入或移出分组。
- 预览文本、图片与 PDF，支持平台文件预览、图片旋转和 OCR。
- 使用方向键浏览，按 Enter 粘贴，按 Escape 关闭；macOS 支持 `Command + 1–9`，Windows/Linux 支持 `Ctrl + 1–9` 快捷粘贴。
- 将多项内容加入粘贴队列；macOS 关闭面板后连续按 `Command + V` 依次粘贴，Windows/Linux 按 Enter 后按选择顺序逐项粘贴。
- 新复制内容实时定位；图片优先加载轻量缩略图，避免阻塞历史列表。
- 支持紧凑布局和上、下、左、右贴边显示，始终跟随当前鼠标所在屏幕。
- 提供历史保留、附件预算、敏感内容排除、屏幕共享保护和暂停捕获。
- 使用端到端加密 WebDAV 同步正文、OCR、分组、图片、PDF 与外观配置。
- 主题色、纯色背景和背景图片持久保存在插件本地；选图时不会上传，只有启用 WebDAV 后才进入加密同步。
- 可从设置的隐私页清空全部剪贴板历史、插件自管附件和当前系统剪贴板。
- ZTools 3.2 可从工具栏截图：Shelf 只写入系统剪贴板，再由主窗口唯一的历史监听器入库；插件会 best-effort 传入 `autoConfirm=false`，但当前公开的一参数 wrapper 可能忽略它，因此不能保证进入截图编辑态。截图区域尺寸也只在宿主实际回传时显示。ZTools 3.2 还支持将本地图片和文件原生拖到外部应用。

## 使用方式

1. 在 ZTools 中搜索 `Paste剪切板`、`剪贴板`、`paste` 或 `clipboard`。
2. 首次打开后，插件会登记为随 ZTools 启动；后续无需手动打开即可持续记录复制内容。
3. 使用鼠标、方向键或搜索框定位内容，按 Enter 或点击卡片完成粘贴。
4. 多选后点击“队列”；macOS 可连续按 `Command + V`，Windows/Linux 在面板内按 Enter 逐项粘贴。
5. 在“设置 → 通用”中可跳转到 ZTools 的全局快捷键配置；Windows 请使用未被系统占用的组合，`Win + V` 保留给系统剪贴板历史。
6. 在设置中选择贴边位置、历史保留策略、附件预算和隐私规则。

## 平台支持

- macOS：完整支持历史捕获、独立贴边浮窗、直接粘贴、Quick Look、Vision OCR、屏幕共享保护和连续粘贴队列。
- Windows / Linux：支持历史捕获、搜索、分组、复制、直接粘贴、文件拖拽和系统文件预览；OCR 需要安装 Tesseract，图片旋转需要安装 ImageMagick。
- ATools：使用 Svelte UI 与 ATools 原生 bridge。
- ZTools：使用 Vue 3 UI、Electron preload；macOS 使用 Vision helper，Windows/Linux 使用系统安全存储和外部 Tesseract/ImageMagick 命令。
- 最低支持 ZTools 2.4；2.4–3.1 使用旧数据目录与浏览器拖拽路径。3.2 首次启动会校验迁移旧附件并重写数据库路径，完成后删除旧目录，之后仅使用宿主提供的插件专属 `pluginData`。

## 隐私与同步

- 历史和附件默认保存在宿主本地数据目录。
- 隐私规则在正文、OCR 和附件落盘前执行。
- WebDAV record、blob 和 index 均经过端到端加密。
- WebDAV 凭据与派生密钥不进入 renderer，本地密钥材料存放于系统钥匙串。
- 搜索工具仅返回脱敏的结构化元数据，不把 OCR 正文写入 Agent 审计内容。
- 附件清理只接受插件生成的内容寻址路径，并在删除前校验实际 SHA-256、`O_NOFOLLOW` 文件句柄、canonical 路径及 inode；校验异常时拒绝删除。Node.js 没有 `unlinkat`，因此这里不宣称能原子防御同一系统账号的恶意进程在最终 unlink 瞬间并发替换父目录。

## 技术实现

- ATools：Svelte 5 + TypeScript。
- ZTools：Vue 3 + TypeScript + Electron preload。
- 共享包：查询与选择状态、分组与粘贴队列、设计 token、加密同步协议和跨宿主 fixture。
- macOS helper：Swift Vision OCR；由插件目录内的 `build-plugin.sh` 编译并临时签名，无需修改仓库构建脚本。
- 可视化验证：Playwright 覆盖双宿主、四种停靠、明暗主题、紧凑布局、减弱动效及关键功能态。

## 本地开发

```bash
corepack pnpm@9.15.9 install --frozen-lockfile
corepack pnpm@9.15.9 --filter @pasteboard-pro/ztools dev
```

ZTools 开发页面默认由 Vite 启动；ATools 与 ZTools 使用独立 UI，不共享前端框架。

## 验证

CI 使用仓库通用的多平台插件构建任务；插件自身要求 Node.js 20+ 与仓库现有的 pnpm 9：

```bash
pnpm typecheck
pnpm --filter @pasteboard-pro/atools typecheck
pnpm --filter @pasteboard-pro/ztools typecheck
pnpm typecheck:visual
pnpm test:contract
pnpm test:release-archive
pnpm test:visual-artifact
pnpm test:visual-contract
pnpm test
pnpm benchmark:search
pnpm test:visual
pnpm verify:visual-artifact
```

仓库通用构建器会读取插件根目录的 `plugin.json`，在对应平台 runner 上构建；macOS 编译并临时签名 Vision helper，Windows/Linux 跳过该 helper 并使用对应平台命令，最后从 `dist/ztools` 打包 ZIP。native 构建逻辑仍限制在插件目录内。

## 大数据量列表回归

ZTools 时间线按可视范围动态挂载 30～50 张卡片（结果不足 30 条时全部挂载，超大视口优先覆盖完整可视范围），支持横向、纵向与紧凑模式。键盘定位按完整列表索引滚动；拖拽只保留已挂载的源卡片，选中集合仍包含屏幕外记录。搜索始终针对全部已加载记录，挂载数量不会截断搜索结果。历史刷新请求会合并，查询与原生文件拖拽索引共用一次数据库读取。

```bash
# 启动时序用例直接验证生产 renderer，先生成它：
pnpm --filter @pasteboard-pro/ztools build:renderer
pnpm exec playwright test --config playwright.performance.config.ts
# 如本地没有 Playwright 自带浏览器，可使用已安装的 Chrome：
PLAYWRIGHT_CHANNEL=chrome pnpm exec playwright test --config playwright.performance.config.ts
# 可选：与虚拟列表改动之前的提交比较相同 10,000 条记录的组件挂载耗时
PB_BENCH_REF=bd12eb67 PLAYWRIGHT_CHANNEL=chrome pnpm exec playwright test --config playwright.performance.config.ts
```

报告位于 `artifacts/virtual-timeline/`。基准仅测量列表组件挂载，不包含数据库、IPC 和宿主窗口创建时间。当前历史仍一次读取最多 10,000 条；本次没有实现数据库游标分页。

## 窗口首次显示

Shelf 和独立面板以隐藏状态创建。宿主 DOM-ready 后等待 renderer 的 `pasteboard-pro:window-ready` 信号；Vue 在主题、首屏数据和 DOM 更新完成后发出该信号。已就绪标记支持晚到的宿主回调，窗口不再主动刷新。macOS 的首次 `show()` 可能重新放置外接屏窗口，因此显示时先设为透明，调用 show/focus 后重新校准最新屏幕坐标，再恢复可见；尺寸补偿仅在实际 bounds 不匹配时执行。旧宿主不提供透明度 API 时仍立即校准显示后的坐标。加载期间关闭或替换窗口不会在异步加载结束后抢焦点；初始化失败时显示可关闭的错误提示。

`apps/ztools/tests/window.test.ts` 覆盖首次显示、连续打开、关闭重开和加载失败；`tests/performance/window-startup.spec.ts` 对生产 renderer 验证延迟主题/历史、空历史、错误状态、独立编辑窗口以及万条历史搜索。浏览器测试不代替 ZTools 原生窗口的视觉验收。

## 目录结构

```text
apps/atools/                ATools Svelte UI 与 bridge adapter
apps/ztools/                ZTools Vue UI、preload、窗口与 macOS helper
packages/core/              查询、选择、分组、粘贴队列与数据类型
packages/design-tokens/     停靠、尺寸、颜色和视觉 token
packages/sync-protocol/     加密 wire format、HLC merge 与 vault helpers
packages/contract-fixtures/ 跨宿主固定 fixture
screenshots/                PR 与插件说明截图
scripts/                    workspace、性能、视觉与发布包门禁
```

## 发布边界

插件保持本地优先且核心浏览、搜索、分组和复制能力不依赖模型、账号或网络。远程 PR 构建与视觉 artifact 全部通过后，才应将对应提交标记为可发布版本。
