# Computer Use Guide


> **Implementation Note**: This feature is an independent implementation inspired by the Computer Use design in Claude Code. On macOS, screenshots are owned by the signed `CyberCode Computer Use` native helper. Linux uses a bundled Rust helper with X11 capture backends or the XDG Desktop Portal. Mouse, keyboard, and app management use the managed Python bridge, while Windows adds Win32 APIs. These components are bundled and configured automatically.

---

## Table of Contents

- [Overview](#overview)
- [Supported Platforms](#supported-platforms)
- [How It Works](#how-it-works)
- [Quick Start](#quick-start)
- [Usage](#usage)
- [Security](#security)
- [Environment Variables](#environment-variables)
- [Technical Architecture](#technical-architecture)
- [Approaches We Tried](#approaches-we-tried)
- [Known Limitations](#known-limitations)
- [References and Credits](#references-and-credits)

---

## Overview

Computer Use allows AI models to **directly control your computer** — taking screenshots, moving the mouse, clicking buttons, typing text, and managing application windows.

24 MCP tools are available:

| Category | Tools |
|----------|-------|
| Screenshot | `screenshot`, `zoom` |
| Mouse | `left_click`, `right_click`, `middle_click`, `double_click`, `triple_click`, `left_click_drag`, `mouse_move`, `left_mouse_down`, `left_mouse_up`, `cursor_position`, `scroll` |
| Keyboard | `type`, `key`, `hold_key` |
| Apps | `open_application`, `switch_display` |
| Permissions | `request_access`, `list_granted_applications` |
| Clipboard | `read_clipboard`, `write_clipboard` |
| Other | `wait`, `computer_batch` |

---

## Supported Platforms

| Platform | Architecture | Status | Notes |
|----------|-------------|--------|-------|
| macOS | Apple Silicon (M1/M2/M3/M4) | ✅ Fully supported | Bundled signed capture helper |
| macOS | Intel x86_64 | ✅ Fully supported | Bundled signed capture helper |
| Windows | x64 | ✅ Fully supported | Uses `win32gui`, `psutil`, `pyperclip`, and `screeninfo` for platform integration |
| Linux | x86_64 | ✅ Supported | Capture and input on X11/XWayland; native Wayland capture through the system portal, with silent global input restricted by the OS |

### Requirements

- **Desktop users:** no separate Bun or Python installation. CyberCode prepares its private platform runtime in the background.
- **Source contributors:** [Bun](https://bun.sh) >= 1.1.0.
- macOS permissions: Accessibility + Screen Recording
- Linux: no Python installation; Wayland may show a system confirmation on first capture, and X11/XWayland input requires a valid `DISPLAY`.

---

## How It Works

Computer Use operates through a **screenshot → analyze → act** feedback loop:

```
┌────────────────────────────────────────────────────┐
│  AI Model (Claude / any Anthropic-protocol model)   │
│                                                     │
│  1. Receives user request: "open Music app"         │
│  2. Calls screenshot tool → receives screen image   │
│  3. Model analyzes pixels, identifies UI elements   │
│     → "search box is at (756, 342)"                 │
│  4. Calls left_click { coordinate: [756, 342] }     │
│  5. Calls type { text: "search query" }             │
│  6. Calls screenshot again → verify → next step...  │
└───────────────┬────────────────────────────────────┘
                │ MCP Tool Call
                ▼
┌────────────────────────────────────────────────────┐
│  TypeScript Tool Layer (vendor/computer-use-mcp)    │
│  - Security checks (app allowlist, TCC permissions) │
│  - Coordinate transformation                        │
│  - Tool dispatch → executor                         │
└───────────────┬────────────────────────────────────┘
                │ Hybrid Bridge
                ▼
┌────────────────────────────────────────────────────┐
│  macOS: CyberCode Computer Use.app                  │
│         CoreGraphics capture + stable TCC identity  │
│  Linux: cybercode-computer-use                      │
│         X11 backend / XDG Desktop Portal capture    │
│                                                    │
│  Python Bridge: mac / win / linux_helper.py         │
│  pyautogui.click(756, 342)   ← mouse/keyboard       │
│  Windows: mss.grab(monitor)  ← screenshot           │
│  Linux: X11/XWayland         ← mouse/keyboard       │
│  NSWorkspace.open(bundleId)  ← app management        │
└────────────────────────────────────────────────────┘
```

**Key**: Coordinate analysis is performed entirely by the model's vision capabilities — it "sees" the screenshot like a human sees a screen, identifying buttons, text fields, and other UI elements directly from pixels.

---

## Quick Start

### 1. Prepare the private runtime automatically

In the desktop app, open **Settings → Computer Use** and select **Prepare Automatically**. CyberCode downloads the private runtime matching the current operating system and CPU architecture, verifies it, and configures it in the background. No system Python, PATH changes, or administrator access are required.

Downloads resume after interruptions and automatically try mirror routes when the primary GitHub route is unavailable. The CLI uses the same preparation flow on its first Computer Use invocation.

> Contributors running from source still need `bun install`. Existing `.runtime/venv/` installations remain compatible and are not forced to download again.

### 2. Grant macOS permissions

**Accessibility:**

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"
```

Desktop users should authorize **CyberCode**. Source and CLI users should authorize their terminal app (iTerm, Terminal, Ghostty, and so on).

**Screen Recording:**

```bash
open "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture"
```

Desktop users should allow **CyberCode Computer Use**. The first screenshot attempt, or the Open Screen Recording Settings button, registers the helper automatically. Retry after granting access. Its fixed bundle identifier lets properly signed releases retain permission across app updates.

Only source or CLI runs without the native helper need to authorize the terminal application.

### 4. Start

```bash
./bin/cybercode
```

### 5. Use

Just ask in natural language:

```
> Take a screenshot of my desktop
> Open Safari and search for something
> Type "hello" in the text editor
```

---

## Security

| Mechanism | Description |
|-----------|-------------|
| **App allowlist** | Each session requires explicit authorization for which apps CyberCode can interact with |
| **Concurrency lock** | Only one CyberCode session can use Computer Use at a time (file lock) |
| **Clipboard guard** | Original clipboard content is saved and restored when typing via clipboard |
| **Sensitive action gates** | System keyboard shortcuts require additional authorization |

> Note: Since we replaced the native modules with Python bridge, the global Escape hotkey abort and auto-hide features from the original implementation are not available. Use `Ctrl+C` to abort instead.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CLAUDE_COMPUTER_USE_ENABLED` | `1` | Set to `0` to disable Computer Use |
| `CLAUDE_COMPUTER_USE_COORDINATE_MODE` | `pixels` | Coordinate mode: `pixels` or `normalized_0_100` |
| `CLAUDE_COMPUTER_USE_CLIPBOARD_PASTE` | `1` | Enable clipboard-based text input |
| `CLAUDE_COMPUTER_USE_MOUSE_ANIMATION` | `1` | Enable mouse animation |
| `CLAUDE_COMPUTER_USE_DEBUG` | `0` | Debug mode |

---

## Technical Architecture

### Gate Bypass

The official Claude Code gates Computer Use behind three layers:

| Layer | Original Mechanism | Our Approach |
|-------|-------------------|--------------|
| Compile-time | `feature('CHICAGO_MCP')` (Bun macro) | Replaced with `true` |
| Subscription | `hasRequiredSubscription()` (Max/Pro only) | `getChicagoEnabled()` returns `true` directly |
| Remote config | GrowthBook `tengu_malort_pedway` | Same — no remote dependency |
| Default-disabled | `isDefaultDisabledBuiltin('computer-use')` | Returns `false` |

### Hybrid Bridge

On macOS, display enumeration, full-screen capture, zoom capture, and passive
Screen Recording checks route through the native helper before Python bootstrap.
The helper is installed under `~/.cyber/computer-use/` with the fixed bundle ID
`com.cybercode.computer-use`. Mouse, keyboard, clipboard, and app operations
continue through the managed Python runtime. Linux routes screen-pixel commands
through its bundled Rust helper, using X11 tools when available and the XDG
Desktop Portal on Wayland. Windows keeps the Python capture path.

On first invocation, the bridge automatically selects a platform asset, downloads
it from the primary or mirror route with resume support, verifies its SHA-256
checksum, validates Python and required imports, then atomically activates it.
The runtime already contains CPython and all required packages, so it does not
touch the system PATH or require administrator access. Existing `.runtime/venv/`
environments remain compatible.

---

## Approaches We Tried

### Approach 1: Extract native .node modules from Claude Code binary ❌

Extracted `computer-use-swift.node` and `computer-use-input.node` from the installed Claude Code Mach-O binary. Synchronous methods worked, but async Swift methods (screenshot) hung due to N-API async incompatibility between Bun versions.

### Approach 2: Create empty stub packages ❌

Stub packages allowed compilation but provided no actual functionality.

### Approach 3: Python Bridge

Replaced all native module calls with Python subprocess calls via `callPythonHelper()`. The operation layer is readable and portable, while CyberCode distributes a private runtime for macOS ARM64, macOS x64, Windows x64, and Linux x64.

### Approach 4: Signed native capture helper + Python input ✅ (current)

macOS screen pixels now come from the standalone `CyberCode Computer Use.app`.
Its stable bundle ID and release Team signature keep Screen Recording permission
attached to the helper rather than a transient Bun or Python process. Browser
page screenshots still prefer `agent-browser` and do not require desktop Screen
Recording permission. Linux ships a compact Rust helper for X11 and XDG Desktop
Portal capture, while input remains on the managed X11/XWayland bridge.

---

## Known Limitations

| Limitation | Description |
|------------|-------------|
| Native Wayland input is restricted | Wayland does not permit silent global mouse and keyboard injection; portal capture works, while input is available in X11/XWayland sessions |
| No global Escape abort | Original used CGEventTap; use `Ctrl+C` instead |
| No auto-hide windows | Original's `prepareDisplay` relied on Swift |
| Input subprocess latency | Mouse and keyboard still use Python subprocesses; screenshots use the lightweight native helper |

---

## References and Credits

| Project | License | Contribution |
|---------|---------|-------------|
| [wimi321/macos-computer-use-skill](https://github.com/wimi321/macos-computer-use-skill) | MIT | Python bridge architecture, `mac_helper.py` runtime, executor adaptation |
| [domdomegg/computer-use-mcp](https://github.com/domdomegg/computer-use-mcp) | MIT | Independent Computer Use MCP server (nut.js based), used as reference |
| [paoloanzn/free-code](https://github.com/paoloanzn/free-code) | - | Feature flag system analysis |
| [oboard/claude-code-rev](https://github.com/oboard/claude-code-rev) | - | Early community project, stub package reference |

### Underlying Libraries

| Library | Purpose |
|---------|---------|
| [pyautogui](https://github.com/asweigart/pyautogui) | Mouse and keyboard control |
| [mss](https://github.com/BoboTiG/python-mss) | Screenshot capture |
| [Pillow](https://github.com/python-pillow/Pillow) | Image processing and compression |
| [pyobjc](https://github.com/ronaldoussoren/pyobjc) | macOS Cocoa/Quartz framework bindings |
| [ashpd](https://github.com/bilelmoussaoui/ashpd) | Rust bindings for the Linux XDG Desktop Portal |
| [XDG Desktop Portal Screenshot](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.Screenshot.html) | Standard Wayland screenshot channel |
