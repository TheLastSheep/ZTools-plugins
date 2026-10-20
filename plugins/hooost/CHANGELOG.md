# Changelog


## 1.0.3 - 2026-10-17

- 修复 Linux 平台修改 hosts 时因无提权逻辑导致的写入失败：优先静默 sudo（root / NOPASSWD 用户无感），失败后回退 pkexec 图形授权
- 修复 Linux 平台数据目录误用 macOS「Library/Application Support」路径的问题，改为遵循 XDG 规范（~/.local/share/hooost）
- Linux 平台写入成功后刷新 systemd-resolved 的 DNS 缓存

## 1.0.2 - 2026-08-13

- 编辑器支持查找替换，配置列表支持重命名

## 1.0.1 - 2026-04-21

- 更新插件版本与发布配置。

## 1.0.0 - 2026-04-15

- 初次发布，将插件提交至 ZTools 插件仓库。
- 初始化结构
- 完善环境相关功能
- 修复不可用情况
- 修复mac下的授权卡死问题
