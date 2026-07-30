# Data Migration and Portable USB Use

The desktop **Data Migration** page combines two workflows: moving accumulated Agent data between tools and creating a portable CyberCode work drive for another computer.

## Agent migration

1. Open **Data Migration → Agent Migration**.
2. Choose the source and destination Agent. CyberCode supports itself plus OpenClaw, WorkBuddy, Claude Code, Codex, Cursor, Trae, Hermes Agent, DeepSeek TUI, Kimi Code, and Pi.
3. Review the detected skills, memories, instructions, and project data. The UI marks items that can be copied directly, require conversion, or are incompatible.
4. Select only the required items, preview the operation, and start the migration.

Migration does not delete source data. When the destination already contains a file, CyberCode follows the destination format and preserves a backup or reports the conflict instead of silently overwriting unknown content.

## Create a portable USB work drive

1. Open **Data Migration → Portable USB**.
2. Select the root of a USB drive or removable disk. You can also select an existing `CyberCode-Portable` directory to update it.
3. Select projects and any required platforms: macOS Apple Silicon, macOS Intel, Windows x64, and Linux x64.
4. Read and confirm the credential warning, then start. Insufficient space, checksum failures, and destination conflicts stop the job with an actionable error.

The bundle can contain:

- CyberCode settings, skills, plugins, memories, and saved sign-in data.
- Selected projects and a cross-platform path registry.
- Verified CyberCode applications, launchers, and a SHA-256 list for the selected platforms.

If the current Release does not yet expose portable application assets, turn off **Include applications** to create a data-and-project-only bundle.

## Start on the destination computer

| System | Launcher |
| --- | --- |
| macOS | Double-click `Start-CyberCode.command` |
| Windows | Double-click `Start-CyberCode.cmd` |
| Linux x64 | Run `./Start-CyberCode.sh` |

The first launch extracts the matching app on the USB drive. The Linux launcher uses AppImage extract-and-run mode, so FUSE is not required. Launchers point CyberCode at the portable configuration and do not merge portable credentials into the destination computer's normal profile.

Project paths stored by sessions, scheduled tasks, and Code Graph are resolved through `portable-projects.json`. A project therefore remains available when `/Volumes/...`, a Windows drive letter, or a Linux mount point changes.

::: warning Protect account credentials
`data/config` may contain API keys, OAuth sessions, and website cookies. Protect the drive like a password, do not give it to untrusted people, and close portable CyberCode before safely ejecting it.
:::
