# 数据迁移与 U 盘便携使用

桌面端右侧栏的 **数据迁移** 统一提供两种能力：在不同 Agent 之间迁移长期积累，或制作可以带到另一台电脑使用的 CyberCode 便携工作盘。

## Agent 迁移

1. 打开 **数据迁移 → Agent 迁移**。
2. 选择来源和目标 Agent。CyberCode 支持自身以及 OpenClaw、WorkBuddy、Claude Code、Codex、Cursor、Trae、Hermes Agent、DeepSeek TUI、Kimi Code 和 Pi。
3. 扫描后检查 Skills、记忆、规则和项目资料。界面会标出可直接迁移、需要转换或不兼容的内容。
4. 只勾选需要的项目，先预览，再执行迁移。

迁移不会删除来源数据。遇到目标端已有同名文件时，CyberCode 会按目标格式处理并保留必要的备份或提示，不会静默覆盖未知内容。

## 制作 U 盘便携工作盘

1. 打开 **数据迁移 → U 盘便携迁移**。
2. 选择 U 盘或移动磁盘根目录。也可以直接选择已有的 `CyberCode-Portable` 目录进行更新。
3. 选择要带走的项目，以及 macOS Apple Silicon、macOS Intel、Windows x64、Linux x64 中需要的平台。
4. 阅读凭据安全提示并确认，然后开始迁移。空间不足、包校验失败或目标目录冲突时，任务会停止并显示原因。

便携包包含：

- 当前 CyberCode 配置、Skills、插件、记忆和已保存的登录信息。
- 选中的项目及跨系统路径注册表。
- 所选平台的已校验 CyberCode 应用、启动脚本和 SHA-256 清单。

如果当前 Release 暂时没有便携应用清单，可以关闭 **包含四平台应用**，先制作仅含数据和项目的迁移包。

## 在目标电脑启动

| 系统 | 启动文件 |
| --- | --- |
| macOS | 双击 `Start-CyberCode.command` |
| Windows | 双击 `Start-CyberCode.cmd` |
| Linux x64 | 运行 `./Start-CyberCode.sh` |

第一次启动会在 U 盘内解压对应应用。Linux 启动器使用 AppImage 的解包运行模式，不要求系统安装 FUSE。启动脚本会把配置根目录指向 U 盘，不会把便携账号和设置写回目标电脑的普通 CyberCode 配置。

会话、定时任务和代码图谱中保存的项目路径会通过 `portable-projects.json` 映射到当前 U 盘挂载位置，因此 macOS 的 `/Volumes/...`、Windows 盘符和 Linux 挂载目录变化后仍可找到已迁移项目。

::: warning 保护账号凭据
`data/config` 可能包含 API Key、OAuth 会话和网页 Cookie。请像保护密码一样保管 U 盘，不要交给不可信的人；退出从 U 盘启动的 CyberCode 后，再安全弹出磁盘。
:::
