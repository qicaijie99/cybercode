#!/usr/bin/env python3
"""Linux Computer Use helper.

Screen-pixel commands normally use the bundled native helper. This module
provides X11 input, clipboard, application discovery, and an mss screenshot
fallback while keeping the same JSON protocol as the macOS/Windows helpers.
"""
from __future__ import annotations

import argparse
import base64
import configparser
import json
import os
import shlex
import shutil
import subprocess
import sys
import time
from io import BytesIO
from pathlib import Path
from typing import Any

os.environ.setdefault("PYTHONDONTWRITEBYTECODE", "1")
os.environ.setdefault("PYAUTOGUI_HIDE_SUPPORT_PROMPT", "1")

KEY_MAP = {
    "a": "a", "b": "b", "c": "c", "d": "d", "e": "e",
    "f": "f", "g": "g", "h": "h", "i": "i", "j": "j",
    "k": "k", "l": "l", "m": "m", "n": "n", "o": "o",
    "p": "p", "q": "q", "r": "r", "s": "s", "t": "t",
    "u": "u", "v": "v", "w": "w", "x": "x", "y": "y",
    "z": "z",
    "0": "0", "1": "1", "2": "2", "3": "3", "4": "4",
    "5": "5", "6": "6", "7": "7", "8": "8", "9": "9",
    "cmd": "win", "command": "win", "meta": "win", "super": "win",
    "ctrl": "ctrl", "control": "ctrl", "shift": "shift",
    "alt": "alt", "option": "alt", "opt": "alt", "fn": "fn",
    "escape": "esc", "esc": "esc", "enter": "enter", "return": "enter",
    "tab": "tab", "space": "space", "backspace": "backspace",
    "delete": "delete", "forwarddelete": "delete",
    "up": "up", "down": "down", "left": "left", "right": "right",
    "home": "home", "end": "end", "pageup": "pageup",
    "pagedown": "pagedown", "capslock": "capslock",
    "f1": "f1", "f2": "f2", "f3": "f3", "f4": "f4",
    "f5": "f5", "f6": "f6", "f7": "f7", "f8": "f8",
    "f9": "f9", "f10": "f10", "f11": "f11", "f12": "f12",
    "-": "-", "=": "=", "[": "[", "]": "]", "\\": "\\",
    ";": ";", "'": "'", ",": ",", ".": ".", "/": "/", "`": "`",
}


def normalize_key(name: str) -> str:
    key = name.strip().lower()
    if key not in KEY_MAP:
        raise ValueError(f"Unsupported key: {name}")
    return KEY_MAP[key]


def json_output(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def error_output(message: str, code: str = "runtime_error") -> None:
    json_output({"ok": False, "error": {"code": code, "message": message}})


def _pyautogui():
    if not os.environ.get("DISPLAY"):
        raise RuntimeError(
            "Linux desktop input requires an X11/XWayland DISPLAY. "
            "Wayland blocks silent synthetic input; screen capture remains available through the system portal."
        )
    import pyautogui

    pyautogui.FAILSAFE = False
    pyautogui.PAUSE = 0
    return pyautogui


def get_displays() -> list[dict[str, Any]]:
    from screeninfo import get_monitors

    displays: list[dict[str, Any]] = []
    for idx, monitor in enumerate(get_monitors()):
        name = getattr(monitor, "name", None) or f"Display {idx + 1}"
        displays.append({
            "id": idx,
            "displayId": idx,
            "width": int(monitor.width),
            "height": int(monitor.height),
            "scaleFactor": 1.0,
            "originX": int(monitor.x),
            "originY": int(monitor.y),
            "isPrimary": bool(getattr(monitor, "is_primary", idx == 0)),
            "name": name,
            "label": name,
        })
    return displays


def choose_display(display_id: int | None) -> dict[str, Any]:
    displays = get_displays()
    if not displays:
        raise RuntimeError("No active Linux displays found")
    if display_id is None:
        return next((item for item in displays if item["isPrimary"]), displays[0])
    return next(
        (
            item
            for item in displays
            if item["displayId"] == display_id or item["id"] == display_id
        ),
        displays[0],
    )


def capture_display(
    display_id: int | None,
    resize: tuple[int, int] | None = None,
) -> dict[str, Any]:
    import mss
    from PIL import Image

    display = choose_display(display_id)
    monitor = {
        "left": display["originX"],
        "top": display["originY"],
        "width": display["width"],
        "height": display["height"],
    }
    with mss.mss() as capture:
        raw = capture.grab(monitor)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    return {
        "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width,
        "height": image.height,
        "displayWidth": display["width"],
        "displayHeight": display["height"],
        "displayId": display["displayId"],
        "originX": display["originX"],
        "originY": display["originY"],
        "display": display,
    }


def capture_region(
    region: dict[str, int],
    resize: tuple[int, int] | None = None,
) -> dict[str, Any]:
    import mss
    from PIL import Image

    with mss.mss() as capture:
        raw = capture.grab(region)
        image = Image.frombytes("RGB", raw.size, raw.rgb)
    if resize:
        image = image.resize(resize, Image.Resampling.LANCZOS)
    buffer = BytesIO()
    image.save(buffer, format="JPEG", quality=75, optimize=True)
    return {
        "base64": base64.b64encode(buffer.getvalue()).decode("ascii"),
        "width": image.width,
        "height": image.height,
    }


def _desktop_roots() -> list[Path]:
    roots = [
        Path.home() / ".local/share/applications",
        Path("/usr/local/share/applications"),
        Path("/usr/share/applications"),
    ]
    return [root for root in roots if root.is_dir()]


def _desktop_entry(path: Path) -> dict[str, Any] | None:
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    try:
        parser.read(path, encoding="utf-8")
        entry = parser["Desktop Entry"]
    except Exception:
        return None
    if entry.get("Type", "Application") != "Application":
        return None
    if entry.getboolean("NoDisplay", fallback=False):
        return None
    display_name = entry.get("Name", fallback=path.stem).strip()
    if not display_name:
        return None
    return {
        "bundleId": path.stem,
        "displayName": display_name,
        "path": str(path),
    }


def installed_apps() -> list[dict[str, Any]]:
    results: dict[str, dict[str, Any]] = {}
    for root in _desktop_roots():
        for path in root.glob("*.desktop"):
            app = _desktop_entry(path)
            if app:
                results.setdefault(app["bundleId"], app)
    return sorted(results.values(), key=lambda app: app["displayName"].lower())


def running_apps() -> list[dict[str, Any]]:
    import psutil

    results: dict[str, dict[str, Any]] = {}
    for process in psutil.process_iter(["name", "exe"]):
        try:
            name = (process.info.get("name") or "").strip()
            executable = process.info.get("exe") or ""
        except (psutil.AccessDenied, psutil.NoSuchProcess):
            continue
        if not name:
            continue
        bundle_id = Path(executable).stem if executable else name
        results.setdefault(bundle_id, {
            "bundleId": bundle_id,
            "displayName": name,
        })
    return sorted(results.values(), key=lambda app: app["displayName"].lower())


def _xdotool(*args: str) -> str:
    if not shutil.which("xdotool"):
        return ""
    result = subprocess.run(
        ["xdotool", *args],
        check=False,
        capture_output=True,
        text=True,
    )
    return result.stdout.strip() if result.returncode == 0 else ""


def frontmost_app() -> dict[str, str] | None:
    window_id = _xdotool("getactivewindow")
    if not window_id:
        return None
    pid = _xdotool("getwindowpid", window_id)
    name = _xdotool("getwindowname", window_id)
    bundle_id = pid
    if pid:
        try:
            import psutil

            bundle_id = psutil.Process(int(pid)).name()
        except Exception:
            pass
    if not bundle_id and not name:
        return None
    return {
        "bundleId": bundle_id or name,
        "displayName": name or bundle_id,
    }


def app_under_point(_x: int, _y: int) -> dict[str, str] | None:
    return frontmost_app()


def find_window_displays(bundle_ids: list[str]) -> list[dict[str, Any]]:
    displays = [item["displayId"] for item in get_displays()]
    return [{"bundleId": bundle_id, "displayIds": displays} for bundle_id in bundle_ids]


def open_app(bundle_id: str) -> None:
    if shutil.which("gtk-launch"):
        result = subprocess.run(["gtk-launch", bundle_id], check=False)
        if result.returncode == 0:
            return
    app = next(
        (item for item in installed_apps() if item["bundleId"] == bundle_id),
        None,
    )
    if not app:
        raise RuntimeError(f"App not found for identifier: {bundle_id}")
    parser = configparser.ConfigParser(interpolation=None, strict=False)
    parser.read(app["path"], encoding="utf-8")
    command = parser["Desktop Entry"].get("Exec", fallback="")
    parts = [
        part
        for part in shlex.split(command)
        if not (part.startswith("%") and len(part) == 2)
    ]
    if not parts:
        raise RuntimeError(f"App has no launch command: {bundle_id}")
    subprocess.Popen(parts, start_new_session=True)


def read_clipboard() -> str:
    import pyperclip

    try:
        return pyperclip.paste() or ""
    except Exception:
        return ""


def write_clipboard(text: str) -> None:
    import pyperclip

    pyperclip.copy(text)


def paste_clipboard() -> None:
    _pyautogui().hotkey("ctrl", "v", interval=0.02)


def check_permissions() -> dict[str, bool | None]:
    input_available = bool(os.environ.get("DISPLAY"))
    capture_available = bool(
        os.environ.get("WAYLAND_DISPLAY")
        or os.environ.get("DISPLAY")
    )
    return {
        # Linux has no macOS-style TCC accessibility gate. Keep the shared
        # permission gate open so Wayland screenshot tools remain usable; each
        # input command still checks DISPLAY and fails immediately when the
        # compositor does not expose X11/XWayland input.
        "accessibility": True,
        "screenRecording": capture_available,
        "inputAvailable": input_available,
    }


def click(
    x: int,
    y: int,
    button: str,
    count: int,
    modifiers: list[str] | None,
) -> None:
    gui = _pyautogui()
    gui.moveTo(x, y)
    normalized = [normalize_key(value) for value in modifiers or []]
    for key in normalized:
        gui.keyDown(key)
    try:
        gui.click(x=x, y=y, button=button, clicks=count, interval=0.08)
    finally:
        for key in reversed(normalized):
            gui.keyUp(key)


def scroll(x: int, y: int, delta_x: int, delta_y: int) -> None:
    gui = _pyautogui()
    gui.moveTo(x, y)
    if delta_y:
        gui.scroll(delta_y, x=x, y=y)
    if delta_x:
        gui.hscroll(delta_x, x=x, y=y)


def key_action(sequence: str, repeat: int = 1) -> None:
    gui = _pyautogui()
    parts = [normalize_key(part) for part in sequence.split("+") if part.strip()]
    for _ in range(max(1, repeat)):
        if len(parts) == 1:
            gui.press(parts[0])
        else:
            gui.hotkey(*parts, interval=0.02)
        time.sleep(0.01)


def hold_keys(keys: list[str], duration_ms: int) -> None:
    gui = _pyautogui()
    normalized = [normalize_key(key) for key in keys]
    for key in normalized:
        gui.keyDown(key)
    try:
        time.sleep(max(duration_ms, 0) / 1000)
    finally:
        for key in reversed(normalized):
            gui.keyUp(key)


def resize_from(payload: dict[str, Any]) -> tuple[int, int] | None:
    if payload.get("targetWidth") and payload.get("targetHeight"):
        return int(payload["targetWidth"]), int(payload["targetHeight"])
    return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command")
    parser.add_argument("--payload", default="{}")
    args = parser.parse_args()
    payload = json.loads(args.payload)

    try:
        command = args.command
        if command == "check_permissions":
            result: Any = check_permissions()
        elif command == "list_displays":
            result = get_displays()
        elif command == "get_display_size":
            result = choose_display(payload.get("displayId"))
        elif command == "screenshot":
            result = capture_display(payload.get("displayId"), resize_from(payload))
        elif command == "resolve_prepare_capture":
            result = capture_display(
                payload.get("preferredDisplayId"),
                resize_from(payload),
            )
            result["hidden"] = []
            result["resolvedDisplayId"] = result["displayId"]
        elif command == "zoom":
            region = {
                "left": int(payload["x"]),
                "top": int(payload["y"]),
                "width": int(payload["width"]),
                "height": int(payload["height"]),
            }
            result = capture_region(region, resize_from(payload))
        elif command == "prepare_for_action":
            result = []
        elif command == "preview_hide_set":
            result = []
        elif command == "find_window_displays":
            result = find_window_displays(list(payload.get("bundleIds") or []))
        elif command == "key":
            key_action(str(payload["keySequence"]), int(payload.get("repeat") or 1))
            result = True
        elif command == "hold_key":
            hold_keys(
                list(payload.get("keyNames") or []),
                int(payload.get("durationMs") or 0),
            )
            result = True
        elif command == "type":
            _pyautogui().write(str(payload.get("text") or ""), interval=0.008)
            result = True
        elif command == "click":
            click(
                int(payload["x"]),
                int(payload["y"]),
                str(payload.get("button") or "left"),
                int(payload.get("count") or 1),
                payload.get("modifiers"),
            )
            result = True
        elif command == "drag":
            gui = _pyautogui()
            from_point = payload.get("from")
            if from_point:
                gui.moveTo(int(from_point["x"]), int(from_point["y"]))
            gui.dragTo(
                int(payload["to"]["x"]),
                int(payload["to"]["y"]),
                duration=0.2,
                button="left",
            )
            result = True
        elif command == "move_mouse":
            _pyautogui().moveTo(int(payload["x"]), int(payload["y"]))
            result = True
        elif command == "scroll":
            scroll(
                int(payload["x"]),
                int(payload["y"]),
                int(payload.get("deltaX") or 0),
                int(payload.get("deltaY") or 0),
            )
            result = True
        elif command == "mouse_down":
            _pyautogui().mouseDown(button="left")
            result = True
        elif command == "mouse_up":
            _pyautogui().mouseUp(button="left")
            result = True
        elif command == "cursor_position":
            x, y = _pyautogui().position()
            result = {"x": int(x), "y": int(y)}
        elif command == "frontmost_app":
            result = frontmost_app()
        elif command == "app_under_point":
            result = app_under_point(int(payload["x"]), int(payload["y"]))
        elif command == "list_installed_apps":
            result = installed_apps()
        elif command == "list_running_apps":
            result = running_apps()
        elif command == "open_app":
            open_app(str(payload["bundleId"]))
            result = True
        elif command == "read_clipboard":
            result = read_clipboard()
        elif command == "write_clipboard":
            write_clipboard(str(payload.get("text") or ""))
            result = True
        elif command == "paste_clipboard":
            paste_clipboard()
            result = True
        else:
            error_output(f"Unknown command: {command}", code="bad_command")
            return 2
        json_output({"ok": True, "result": result})
        return 0
    except Exception as exc:
        error_output(str(exc))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
