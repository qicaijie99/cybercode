#!/usr/bin/env python3
"""cleanup-tauri-windows.py — 清理孤儿 Tauri/X11 僵尸窗口

Tauri dev 多次启动后，pkill 杀不掉的 Tauri 进程会留下 X11 窗口。
用 xprop _NET_WM_PID 找到窗口所属进程，杀进程同时销毁窗口。

用法:
  python3 desktop/scripts/cleanup-tauri-windows.py          # 只清理 CyberCode
  python3 desktop/scripts/cleanup-tauri-windows.py --all    # 清理所有 Tauri/WebKit
"""

import Xlib.display
import subprocess
import re
import os
import signal
import argparse

WINDOW_NAME = "CyberCode"
HELPER_NAMES = ["cybercode-desktop", "WebKitWebProcess"]


def find_windows(name: str) -> list[str]:
    result = subprocess.run(
        ["xwininfo", "-root", "-tree"], capture_output=True, text=True
    )
    return re.findall(rf'(0x[0-9a-f]+)\s+"{re.escape(name)}"', result.stdout)


def kill_window(wid_hex: str, display) -> bool:
    wid = int(wid_hex, 16)
    try:
        w = display.create_resource_object("window", wid)
        w.destroy()
        display.flush()
        return True
    except Exception as e:
        print(f"  skip {wid_hex}: {e}")
        return False


def kill_processes_for_windows(wids: list[str]):
    pids = set()
    for wid_hex in wids:
        proc = subprocess.run(
            ["xprop", "-id", wid_hex, "_NET_WM_PID"],
            capture_output=True,
            text=True,
        )
        m = re.search(r"(\d+)", proc.stdout)
        if m:
            pids.add(m.group(1))

    for pid_str in pids:
        pid = int(pid_str)
        try:
            os.kill(pid, signal.SIGKILL)
            print(f"  killed PID {pid}")
        except ProcessLookupError:
            print(f"  PID {pid} already dead")
        except PermissionError:
            print(f"  PID {pid} permission denied (not ours?)")


def main():
    parser = argparse.ArgumentParser(description="Cleanup Tauri zombie windows")
    parser.add_argument("--all", action="store_true", help="Also clean helper/WebKit windows")
    args = parser.parse_args()

    display = Xlib.display.Display()

    main_wids = find_windows(WINDOW_NAME)
    helper_wids = find_windows(HELPER_NAMES[0]) + find_windows(HELPER_NAMES[1])

    print(f"Found {len(main_wids)} CyberCode window(s)")
    if args.all:
        print(f"Found {len(helper_wids)} helper/WebKit window(s)")

    # Kill processes first (destroying X11 connection cleans windows)
    wids_to_clean = main_wids + helper_wids if args.all else main_wids
    if wids_to_clean:
        kill_processes_for_windows(wids_to_clean)
    else:
        print("Nothing to clean up")
        display.close()
        return

    # Destroy any remaining windows
    destroyed = 0
    for wid_hex in wids_to_clean:
        if kill_window(wid_hex, display):
            destroyed += 1
    if destroyed > 0:
        print(f"Destroyed {destroyed} window(s)")

    # Verify
    remaining = len(find_windows(WINDOW_NAME))
    print(f"Remaining CyberCode windows: {remaining}")

    display.close()


if __name__ == "__main__":
    main()
