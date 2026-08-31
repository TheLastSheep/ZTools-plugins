# 字幕工坊 / Subtitle Workbench

一个本地优先的字幕剪辑台：导入 SRT/VTT，编辑、查找替换、平移时间、按速度换算并导出。质检会标出重叠、倒序、时长异常、阅读速度和空文本。

媒体轨道提取只会在宿主提供 runFFmpeg 能力时调用；首版不携带 FFmpeg。Python whisper 与 whisper.cpp 的命令方言不同，v0.1 不探测 PATH、也不运行转写二进制；不会上传媒体或伪造转写结果。

## 验证

`npm test && npm run build`

SRT/VTT transforms, platform-shaped paths, renderer safety, lifecycle cleanup, source/dist identity, and Chromium rendering are verified. Loading in real Windows, macOS, and Linux ZTools hosts, host dialogs, and host-provided FFmpeg execution remain untested.

保存通过系统保存对话框确认目标；若用户选择已有普通文件，原子 rename 会以该确认作为覆盖授权，符号链接目标会被拒绝。

音轨提取先写同目录随机临时 WAV，成功后才提升为最终文件；已有最终文件会先保留备份，并在提升失败时回滚。Windows 上该覆盖不是单一步骤原子替换，但旧文件会保留到新文件提升成功。由于 FFmpeg 无法使用已打开的输入文件描述符执行，首版会在启动前后复核路径身份；同账户恶意并发替换仍是平台级边界，不能宣称完全无竞态。

导出为 SRT 会规范化字幕并丢弃 VTT 专属的 STYLE、REGION 与 NOTE 文档块；保留 VTT 时这些元数据会随时间变换保留。
