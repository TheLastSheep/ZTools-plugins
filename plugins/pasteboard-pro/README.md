# PasteboardPro for ATools and ZTools

PasteboardPro 是 Paste 风格的本地优先剪贴板工作区。本目录包含两套独立 UI：ATools 使用 Svelte，ZTools 使用 Vue 3；两端共享行为契约、设计 token、加密同步协议和测试 fixture，但各自使用宿主原生能力完成捕获、粘贴、窗口和 OCR。

当前状态：**功能实现中，尚未达到可上线门槛。** 源码、类型、单元测试和 ZTools 10k/100k 搜索性能已通过；真实 macOS 双宿主、跨宿主 WebDAV、视觉截图矩阵、原生构建、签名与公证仍待完成。

## 核心能力

- 剪贴板历史与结构化类型：文本、富文本、HTML、URL、图片、PDF、颜色和文件。
- 搜索语法：普通文本以及 `type:`、`app:`、`device:`、`date:`、`pinboard:` 过滤器。
- Pinboards 创建、重命名、排序、分配与删除。
- Expanded/Compact 时间线、预览、Quick Look、图片旋转与 OCR。
- Quick Paste、纯文本粘贴、多选顺序粘贴和 Paste Stack。
- 新建文本、正文编辑、标题重命名、copy-only 与 direct-paste 路径。
- 历史天数、blob 预算、应用/内容排除规则和屏幕共享保护。
- `PasteboardPro/v1` 加密 WebDAV vault、HLC 字段时钟、墓碑与条件 ETag 更新。
- macOS job 会为已签名 helper 生成包含签名类型、Developer ID/Team ID、Hardened Runtime、Gatekeeper 状态与 SHA-256 的证明文件；最终 ZTools ZIP 会二次解包并要求内置 helper 哈希与该证明一致，同时验证根目录布局、禁止文件、路径穿越、符号链接、内联 source map 与绝对开发机路径。

旧 PasteboardPro 历史、Pinboards 和附件不会迁移；新插件从空 canonical store 开始。

## 目录结构

```text
apps/atools/           Svelte 插件 UI 与 ATools bridge adapter
apps/ztools/           Vue UI、Electron preload、窗口与 macOS helper
packages/core/         查询、选择、Pinboards、Paste Stack 与数据类型
packages/design-tokens 停靠、尺寸、颜色和视觉 token
packages/sync-protocol 加密 wire format、HLC merge 与 vault helpers
packages/contract-fixtures 跨实现固定 fixture
scripts/               workspace contract 与性能门禁
```

ATools 的最终数据读写、TaskRun、MCP/Agent 和系统动作位于 ATools Rust runtime；ZTools 的宿主动作位于 `apps/ztools/preload`。Renderer 不直接持有 WebDAV 凭据或派生密钥。

## 确定性验证

CI 使用 Node 24 与 pnpm 11.7.0：

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm --filter @pasteboard-pro/atools typecheck
pnpm --filter @pasteboard-pro/ztools typecheck
pnpm test
pnpm benchmark:search
```

当前已验证结果：

- TypeScript references：pass。
- Vue typecheck：pass。
- Svelte check：0 errors / 0 warnings。
- Vitest：33 files、230/230 tests。
- ZTools/shared query benchmark 最新隔离运行：10k P95 5.78ms、100k P95 37.57ms，门槛分别为 50ms 与 150ms。

性能 JSON 写入 `artifacts/pasteboardpro/search-performance.json`，PR 与 release workflow 会将其作为 artifact 上传。该报告只覆盖共享/ZTools JavaScript 查询路径，不能代替 ATools SQLite/Rust 搜索基准。

## 隐私与安全边界

- 历史和 blob 默认保存在宿主本地数据目录。
- WebDAV vault 对 record、blob 和 index 加密；凭据与派生密钥不写入 renderer 可读配置。
- ATools 与 ZTools 分别使用受限的系统 Keychain 路径保存密钥材料。
- 隐私规则支持 Bundle ID 排除、literal/wildcard/regex 内容规则和屏幕共享 content protection。
- Agent 搜索仅返回脱敏结构化元数据；OCR 正文不进入 Agent TaskRun 或 audit payload。
- Quick Look 使用绝对路径、普通进程参数和启动超时，不通过 shell 拼接命令。

## 平台说明

- macOS 是第一版完整 UI/交互与原生能力验收平台。
- Windows/Linux 可保留历史浏览、搜索、Pinboards、复制和元数据预览。
- Vision OCR、Quick Look、Accessibility direct paste、透明浮窗和屏幕共享保护依赖 macOS 原生能力；不支持时必须降级并明确提示。

## 尚未关闭的发布门禁

- Rust 写 → Node 读写 → Rust 读的真实 WebDAV 编排，以及 412、断网、损坏和明文泄漏场景。
- Expanded/Compact、四种停靠、明暗主题与 reduced-motion 的双宿主截图矩阵。
- ATools/ZTools 真实激活、捕获、粘贴、OCR、Quick Look、Paste Stack 与多屏 smoke。
- ATools SQLite/Rust 10k/100k 搜索基准。
- Rust/Swift/Vite 原生 CI、helper Developer ID 签名、Apple 公证和 assembled ZIP 内容验证。

最终 ZIP 内容验证器和 PR/release workflow 接线已经实现；实际发布门禁仍需当前分支远程构建生成 `pasteboardpro-archive-verification.json`，且 Developer ID/helper 公证步骤成功后才能关闭。

在这些门禁全部有真实 artifact 前，不应把插件标记为 release-ready。

ATools 仓库已提供专用 `PasteboardPro Cross-Host Acceptance` workflow。它会签出匹配的 ZTools ref，使用真实 Rust `sync_pasteboard_vault` 与本目录的 `syncZToolsVault` runtime 运行双向编排；只有远程 artifact `cross-host-sync.json` 生成且全部断言通过后，第一项门禁才能关闭。

ATools CI 同时已提供独立 `pasteboardpro-search-performance` job，使用真实 SQLite/Rust 搜索路径生成 `atools-search-performance.json`；该 artifact 通过后才能关闭 ATools 性能门禁。

本 workspace 已提供 Playwright 双宿主视觉矩阵：32 种停靠/主题/密度/动效组合会为 ATools 与 ZTools 各截图一次，另覆盖 search、Pinboard、Preview 和 Paste Stack 功能态，总计 72 张图片。独立 artifact 校验器会再次确认 72 个文件真实存在、两端各 36 张、32 组矩阵和 4 组功能态均成对、贴边圆角/viewport/reduced-motion/跨宿主几何证据完整。PR/release workflow 会在校验通过后上传 `visual-matrix.json`、截图、trace 和 Playwright JSON report；只有 artifact 生成并完成人工审核后，视觉门禁才能关闭。
