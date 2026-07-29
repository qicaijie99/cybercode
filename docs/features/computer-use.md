# Computer Use 功能指南


> **实现说明**：本功能高度借鉴 Claude Code 的 Computer Use 设计思路并完全独立实现。macOS 截图由随应用签名的 `CyberCode Computer Use` 原生 helper 负责；Linux 截图由内置 Rust helper 通过 X11 截图后端或 XDG Desktop Portal 完成；鼠标、键盘和应用管理由托管 Python bridge 完成。Windows 使用同一 bridge + Win32 API。用户不需要单独安装或配置这些组件。

---

## 目录

- [功能简介](#功能简介)
- [支持的设备与平台](#支持的设备与平台)
- [工作原理](#工作原理)
- [快速开始](#快速开始)
- [使用方式](#使用方式)
- [安全机制](#安全机制)
- [环境变量](#环境变量)
- [技术架构详解](#技术架构详解)
- [我们尝试过的方案](#我们尝试过的方案)
- [已知限制](#已知限制)
- [参考项目与致谢](#参考项目与致谢)

---

## 功能简介

Computer Use 让 AI 模型能够**直接控制你的电脑**——截屏、移动鼠标、点击按钮、输入文字、管理应用窗口。

支持的操作（共 24 个 MCP 工具）：

| 类别 | 工具 |
|------|------|
| 截屏 | `screenshot`、`zoom` |
| 鼠标 | `left_click`、`right_click`、`middle_click`、`double_click`、`triple_click`、`left_click_drag`、`mouse_move`、`left_mouse_down`、`left_mouse_up`、`cursor_position`、`scroll` |
| 键盘 | `type`、`key`、`hold_key` |
| 应用 | `open_application`、`switch_display` |
| 权限 | `request_access`、`list_granted_applications` |
| 剪贴板 | `read_clipboard`、`write_clipboard` |
| 其他 | `wait`、`computer_batch` |

---

## 支持的设备与平台

| 平台 | 芯片 | 状态 | 说明 |
|------|------|------|------|
| macOS | Apple Silicon (M1/M2/M3/M4) | ✅ 完整支持 | 内置签名截图 helper |
| macOS | Intel x86_64 | ✅ 完整支持 | 内置签名截图 helper |
| Windows | x64 | ✅ 完整支持 | 使用 `win32gui` + `psutil` + `pyperclip` + `screeninfo` 替代 macOS 专有 API |
| Linux | x86_64 | ✅ 支持 | X11/XWayland 支持截图与输入；原生 Wayland 通过系统 Portal 截图，静默全局输入受系统限制 |

### 运行环境要求

- **桌面端用户**：无需额外安装 Bun 或 Python；CyberCode 会按平台在后台准备私有运行组件
- **源码开发者**：[Bun](https://bun.sh) >= 1.1.0
- **macOS**：系统权限 Accessibility（辅助功能）+ Screen Recording（屏幕录制）
- **Windows**：无需额外权限配置
- **Linux**：无需安装 Python；Wayland 首次截图可能显示系统确认框，X11/XWayland 输入需要有效的 `DISPLAY`

---

## 工作原理

Computer Use 的核心是一个**截图-分析-操作**的闭环：

```
┌──────────────────────────────────────────────┐
│  AI 模型（Claude / 其他 Anthropic 协议模型）     │
│                                               │
│  1. 收到用户请求 "打开网易云搜索喜欢你"            │
│  2. 调用 screenshot 工具 → 收到屏幕截图           │
│  3. 模型分析截图像素，识别 UI 元素位置              │
│     → "搜索框在 (756, 342)"                     │
│  4. 调用 left_click { coordinate: [756, 342] }  │
│  5. 调用 type { text: "喜欢你" }                 │
│  6. 再次 screenshot → 确认结果 → 下一步...        │
└──────────────┬───────────────────────────────┘
               │ MCP Tool Call
               ▼
┌──────────────────────────────────────────────┐
│  TypeScript 工具层                              │
│  (vendor/computer-use-mcp)                     │
│                                               │
│  - 安全检查（应用白名单、TCC 权限）               │
│  - 坐标模式转换（pixels / normalized）           │
│  - 工具分发 → executor                          │
└──────────────┬───────────────────────────────┘
               │ Hybrid Bridge
               ▼
┌──────────────────────────────────────────────┐
│  macOS: CyberCode Computer Use.app            │
│         CoreGraphics 截图 + 固定 TCC 身份       │
│  Linux: cybercode-computer-use                │
│         X11 后端 / XDG Desktop Portal 截图      │
│                                               │
│  Python Bridge: mac / win / linux_helper.py   │
│  pyautogui.click(756, 342)  ← 鼠标/键盘控制    │
│  Windows: mss.grab()        ← 截图             │
│  Linux: X11/XWayland        ← 鼠标/键盘控制    │
│  macOS: NSWorkspace.open()  ← 应用管理          │
│  Windows: win32gui / psutil ← 应用管理          │
└──────────────────────────────────────────────┘
```

**关键：坐标分析完全由模型的视觉能力完成**——模型"看"截图就像人看屏幕一样，直接从像素中识别按钮、输入框等 UI 元素的位置。

---

## 快速开始

### 1. 自动准备运行组件

桌面端打开「设置 → Computer Use」，点击「自动准备」。CyberCode 会在后台下载与当前系统和 CPU 架构匹配的专用运行组件，并自动完成校验与配置；不需要安装 Python、修改 PATH 或使用管理员权限。

下载支持断点续传，并会在 GitHub 主线路不可用时自动尝试镜像线路。命令行端首次调用 Computer Use 时也会使用同一套自动准备流程。

> 从源码运行 CyberCode 的开发者仍需先执行 `bun install`。已有 `.runtime/venv/` 的用户会继续沿用原环境，不会被强制重新下载。

### 2. 授予 macOS 权限

#### Accessibility（辅助功能）

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

桌面端用户授权 **CyberCode**；从源码或命令行运行时，授权对应的终端应用（如 iTerm、Terminal、Ghostty）。

#### Screen Recording（屏幕录制）

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

桌面端请允许 **CyberCode Computer Use**。第一次点击截图或“打开屏幕录制设置”时，CyberCode 会自动注册这个 helper；授权后直接重试即可。该固定 Bundle ID 会随正式签名版本复用权限，不需要每次升级重新授权。

从源码运行且没有构建原生 helper 时，才需要给对应终端应用授权。

### 4. 启动

```bash
./bin/cybercode
```

### 5. 使用

在对话中用自然语言请求即可：

```
> 帮我打开网易云音乐，搜索一首歌
> 截个屏看看当前桌面
> 帮我在 VS Code 里打开终端
```

---

## 使用方式

首次使用 Computer Use 时，系统会弹出**应用授权对话框**，你需要选择允许 CyberCode 操作的应用。

- 模型会先调用 `request_access` 请求权限
- 你在终端中确认允许哪些应用
- 之后模型就可以截图、点击、输入了

---

## 安全机制

| 机制 | 说明 |
|------|------|
| **应用白名单** | 每次会话需要明确授权允许操作的应用 |
| **并发保护** | 同一时间只有一个 CyberCode 会话可使用 Computer Use（文件锁机制） |
| **剪贴板保护** | 通过剪贴板输入文本时会自动保存和恢复原始剪贴板内容 |
| **操作确认** | 敏感操作（如系统快捷键）需要额外授权 |

> 注意：由于底层改为 Python bridge，原生方案中的全局 Escape 快捷键中止和操作前自动隐藏应用功能暂不可用。可使用 `Ctrl+C` 中止。

---

## 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `CLAUDE_COMPUTER_USE_ENABLED` | `1` | 设为 `0` 可禁用 Computer Use |
| `CLAUDE_COMPUTER_USE_COORDINATE_MODE` | `pixels` | 坐标模式：`pixels` 或 `normalized_0_100` |
| `CLAUDE_COMPUTER_USE_CLIPBOARD_PASTE` | `1` | 是否启用剪贴板粘贴输入 |
| `CLAUDE_COMPUTER_USE_MOUSE_ANIMATION` | `1` | 是否启用鼠标动画 |
| `CLAUDE_COMPUTER_USE_HIDE_BEFORE_ACTION` | `0` | 操作前是否隐藏其他窗口 |
| `CLAUDE_COMPUTER_USE_DEBUG` | `0` | 调试模式 |

---

## 技术架构详解

### 整体分层

```
src/
├── vendor/computer-use-mcp/     ← MCP 工具定义与分发（12 个文件）
│   ├── tools.ts                 ← 24 个工具的 schema 定义
│   ├── toolCalls.ts             ← 安全检查 + 工具分发
│   ├── mcpServer.ts             ← MCP 服务器创建
│   ├── types.ts                 ← 全部类型定义
│   └── ...
├── utils/computerUse/
│   ├── executor.ts              ← 执行器（调用 Python bridge）
│   ├── pythonBridge.ts          ← 原生截图 / Python 输入路由
│   ├── nativeCapture.ts         ← macOS / Linux 原生 helper 通信
│   ├── hostAdapter.ts           ← 权限检查适配器
│   ├── gates.ts                 ← 功能开关（已绕过灰度）
│   ├── wrapper.tsx              ← MCP 工具覆写层
│   ├── setup.ts                 ← MCP 配置初始化
│   └── ...
├── runtime/
│   ├── mac_helper.py            ← macOS Python 实现
│   ├── win_helper.py            ← Windows Python 实现
│   ├── linux_helper.py          ← Linux 输入与截图兜底
│   ├── requirements.txt         ← macOS Python 依赖
│   ├── requirements-win.txt     ← Windows Python 依赖
│   └── requirements-linux.txt   ← Linux Python 依赖
├── desktop/computer-use-macos/
│   ├── main.swift               ← 原生截图与权限请求
│   └── Info.plist               ← com.cybercode.computer-use
└── desktop/computer-use-linux/
    └── src/main.rs              ← X11 / XDG Desktop Portal 截图
```

### 灰度控制绕过

官方 Claude Code 中 Computer Use 通过三层门控限制访问：

| 层级 | 原始机制 | 我们的处理 |
|------|----------|-----------|
| 编译时 | `feature('CHICAGO_MCP')` (Bun 编译宏) | 替换为 `true` |
| 订阅检查 | `hasRequiredSubscription()` (Max/Pro) | `getChicagoEnabled()` 直接返回 `true` |
| 远程配置 | GrowthBook `tengu_malort_pedway` | 同上，不再依赖远程配置 |
| 默认禁用 | `isDefaultDisabledBuiltin('computer-use')` | `isDefaultDisabledBuiltin()` 返回 `false` |

### 混合 Bridge 工作机制

```typescript
// pythonBridge.ts
async function callPythonHelper<T>(command: string, payload: object): Promise<T> {
  if (
    (process.platform === 'darwin' || process.platform === 'linux') &&
    isNativeCaptureCommand(command)
  ) {
    return callNativeCaptureHelper(command, payload)
  }
  await ensureBootstrapped()  // 复用已有环境，或后台准备专用运行组件
  
  // 调用用户目录下的私有 Python，不依赖系统 PATH
  const result = execFile(pythonBin, ['mac_helper.py', command, '--payload', JSON.stringify(payload)])
  
  return JSON.parse(result.stdout)  // { ok: true, result: T }
}
```

首次运行自动完成：
1. 识别 Windows x64、Linux x64、macOS Apple Silicon 或 macOS Intel
2. 从 GitHub 主线路或镜像线路后台下载带依赖的私有 Python 运行组件
3. 按平台携带依赖：
   - **macOS**: `mss`, `Pillow`, `pyautogui`, `pyobjc-*`（`requirements.txt`）
   - **Windows**: `mss`, `Pillow`, `pyautogui`, `win32gui`, `psutil`, `pyperclip`, `screeninfo`（`requirements-win.txt`）
   - **Linux**: `mss`, `Pillow`, `pyautogui`, `psutil`, `pyperclip`, `screeninfo`（`requirements-linux.txt`）
4. 执行 SHA-256 校验、启动验证与原子切换；中断后可继传

已存在的 `.runtime/venv/` 会继续复用，不强制老用户重新下载。

---

## 我们尝试过的方案

### 方案一：从 Claude Code 二进制提取原生 .node 模块 ❌

**思路**：从已安装的 Claude Code 二进制 (`~/.local/share/claude/versions/2.1.91`，189MB Mach-O) 中定位并提取嵌入的原生 NAPI 模块。

**实施**：
- 成功从 Bun `$bunfs` 虚拟文件系统中提取了 `computer-use-swift.node` (ARM64 424KB + x64 430KB) 和 `computer-use-input.node` (ARM64 836KB + x64 821KB)
- 同步方法（TCC 权限检查、显示枚举）正常工作
- 创建了 npm 包装包并通过 workspace 注册

**失败原因**：
- Swift 异步方法（`screenshot.captureExcluding`）的 continuation 永远不会 resume
- 根因：提取的 .node 文件是针对 Claude Code 内置的 Bun 运行时编译的，与用户系统的 Bun 版本的 N-API 异步实现不兼容
- 错误信息：`SWIFT TASK CONTINUATION MISUSE: captureScreenWithExclusion leaked its continuation without resuming it`

### 方案二：创建空 Stub 包 ❌

**思路**：为 `@ant/computer-use-mcp`、`@ant/computer-use-input`、`@ant/computer-use-swift` 创建最小化的 stub 包，使代码能编译加载。

**失败原因**：代码能编译但 MCP 服务器注册后无法执行任何实际操作——截图、点击等全部报错。

### 方案三：Python Bridge 替代原生模块 ✅

**思路**：参考 [wimi321/macos-computer-use-skill](https://github.com/wimi321/macos-computer-use-skill)，用 Python 子进程替代所有原生模块调用。

**优势**：
- 不依赖特定 Bun/Node 版本的 NAPI 原生模块
- 纯 Python 操作层，专用运行组件在后台自动准备
- 鼠标、键盘、应用管理全部可用，并为 Windows 与 Linux 提供截图
- macOS ARM64 / x86_64、Windows x64 与 Linux x64 均支持

### 方案四：签名原生截图 helper + Python 输入控制 ✅（当前方案）

macOS 的屏幕像素读取迁移到独立的 `CyberCode Computer Use.app`。它拥有固定 Bundle ID，并与正式桌面端使用同一 Apple Team 签名；系统录屏权限因此归属于稳定 helper，而不是某次启动的 Bun/Python 子进程。Linux 桌面端内置对应的 Rust helper：X11 优先使用桌面已有截图后端，Wayland 优先使用 XDG Desktop Portal。浏览器页面截图仍优先走 `agent-browser`，不需要桌面录屏权限。

---

## 已知限制

| 限制 | 说明 |
|------|------|
| 原生 Wayland 输入受限 | Wayland 不允许应用静默注入全局鼠标键盘事件；截图可通过系统 Portal 完成，输入在 X11/XWayland 会话下可用 |
| 无全局 Escape 中止 | 原生方案用 CGEventTap 实现，Python 版暂不支持，用 `Ctrl+C` 代替 |
| 操作前不自动隐藏窗口 | 原生方案的 `prepareDisplay` 依赖 Swift，Python 版未实现 |
| 输入操作有进程开销 | 鼠标和键盘仍由 Python 子进程执行；截图已改为轻量原生 helper |
| 像素验证关闭 | `pixelValidation` 默认关闭 |

---

## 参考项目与致谢

本功能的实现参考了以下开源项目，在此致以感谢：

| 项目 | 许可证 | 贡献 |
|------|--------|------|
| [wimi321/macos-computer-use-skill](https://github.com/wimi321/macos-computer-use-skill) | MIT | Python bridge 架构、`mac_helper.py` 运行时、`executor.ts` 适配方案。该项目从 Claude Code 工作流中提取了可复用的 TypeScript 逻辑，并用完全公开的 Python 库替代了私有原生模块 |
| [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp) | MIT | 独立的 Computer Use MCP 服务器实现（基于 nut.js），跨平台可用。在方案调研阶段提供了参考 |
| [paoloanzn/free-code](https://github.com/paoloanzn/free-code) | - | Feature flag 系统分析和构建系统参考 |
| [oboard/claude-code-rev](https://github.com/oboard/claude-code-rev) | - | 早期社区项目，提供了 stub 包的参考实现 |

### 底层依赖

| 库 | 平台 | 用途 |
|----|------|------|
| [pyautogui](https://github.com/asweigart/pyautogui) | 跨平台 | 鼠标和键盘控制 |
| [mss](https://github.com/BoboTiG/python-mss) | 跨平台 | 屏幕截图 |
| [Pillow](https://github.com/python-pillow/Pillow) | 跨平台 | 图像处理和压缩 |
| [pyobjc](https://github.com/ronaldoussoren/pyobjc) | macOS | Cocoa/Quartz 框架绑定（应用管理、显示枚举） |
| [pywin32](https://github.com/mhammond/pywin32) | Windows | Win32 API 绑定（窗口管理） |
| [psutil](https://github.com/giampaolo/psutil) | Windows | 进程管理（应用列表、进程操作） |
| [pyperclip](https://github.com/asweigart/pyperclip) | Windows | 剪贴板操作 |
| [screeninfo](https://github.com/rr-/screeninfo) | Windows | 显示器信息（多屏支持） |
| [ashpd](https://github.com/bilelmoussaoui/ashpd) | Linux | 调用 XDG Desktop Portal 截图接口 |
| [XDG Desktop Portal Screenshot](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html) | Linux | Wayland 标准屏幕截图通道 |
