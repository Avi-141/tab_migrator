# Tab Migrator (macOS, Chrome + Firefox)

A tiny export/import tool to move **all open tabs** from your old Mac (M1) to your new Mac (M4).

- **Chrome** export: AppleScript (JXA) — no extra dependencies.
- **Firefox** export: reads the live session backup (`*.jsonlz4`) — requires `pip install lz4`.
- **Import**: opens the saved tabs into **new windows** of Chrome/Firefox on the M4.
- Profiles: exact Chrome/Firefox **profiles are not preserved**; tabs are restored as windows/tabs.

> If you already use **Chrome Sync** and **Firefox Sync**, enable them — that is the fastest official method. This tool is a belt‑and‑suspenders backup that works even without signing in.

## Requirements
- macOS (tested with modern macOS versions)
- Python 3.9+
- For Firefox export only: `pip install lz4`

## Files
- `export_tabs.py` — run this on your **old Mac (M1)`
- `import_tabs.py` — run this on your **new Mac (M4)`
- `tabs_backup.json` — produced by the exporter; feed it to the importer

## Usage

### 1) Export on M1
```bash
python3 export_tabs.py            # exports Chrome + Firefox if available
# or
python3 export_tabs.py --chrome   # Chrome only
python3 export_tabs.py --firefox  # Firefox only
# Output => tabs_backup.json (override with --out)
```

If you see a warning for Firefox about `lz4`, install it:
```bash
pip3 install lz4
python3 export_tabs.py --firefox
```

### 2) Move the JSON
Copy `tabs_backup.json` to your M4 (AirDrop, USB, etc.).

### 3) Import on M4
```bash
python3 import_tabs.py tabs_backup.json
# or target a specific browser:
python3 import_tabs.py tabs_backup.json --chrome
python3 import_tabs.py tabs_backup.json --firefox
```

This will create new windows and open all saved URLs. (It doesn’t restore tab groups or pinned state.)

## Notes & Limitations
- Chrome profile attribution isn’t exposed via AppleScript; this tool restores tabs, not profile metadata.
- Firefox export reads the most recent `recovery.jsonlz4`/`previous.jsonlz4` or `sessionstore.jsonlz4`.
- Some corporate/profiles can block AppleScript or remote openings; run locally with permissions granted.
- If you have **hundreds** of tabs, imports stagger openings (a small delay) to avoid app freezes.

## Troubleshooting
- **Chrome export failed**: Ensure Chrome is running and has at least one window; grant Accessibility permission if prompted.
- **Firefox export failed**: Open Firefox first so a recent `*.jsonlz4` exists; `pip install lz4` must be present.
- **Nothing opens on import**: Confirm app names are standard (“Google Chrome”, “Firefox”) and not Canary/Beta.
