# Worktree 驾驶舱 / Git Worktree Cockpit

v0.1 是强只读插件。它只在用户选择并获得短期授权的普通 Git 仓库中安全探测 Git，通过固定的 Git worktree list / status porcelain 参数读取状态，导出 Markdown/JSON 快照；裸仓库暂不支持。

不会执行 stage、clean、reset、remove、force、创建或删除工作树。界面里的创建/移除入口只会给出 dry plan，明确不会运行命令。所有 Git 可执行文件必须是已验证的绝对路径，调用始终 `shell:false`。

执行 Git 前会重新核对已授权仓库的 realpath 与文件身份，并使用无可选锁、禁用 fsmonitor 的只读参数。Git 不能绑定一个已打开的仓库目录描述符执行，因此同账户恶意并发替换仍是平台级边界；插件不将此描述为完全无竞态。

## 验证

`npm test && npm run build`

只读 Git 参数、三平台路径与可执行文件候选、生命周期边界、源码/产物一致性和 Chromium 渲染已验证；真实 Windows、macOS、Linux ZTools 宿主加载与对话框尚未测试，Windows/Linux 的 Git 进程执行仍属于契约测试。
