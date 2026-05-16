# Security And Memory Review

Reviewed scope:

- `extension/extension.js`
- `extension/package.json`
- `scripts/build-custom-dev-tools-vsix.ps1`

## Security Summary

The extension is local-first and does not contain telemetry, external translation calls, or internet exfiltration logic. It launches local tools such as Docker, Java, Python, MySQL, PostgreSQL, Redis, and SQLite through `execFile`/`spawn`, which avoids shell interpolation for normal runtime commands.

Database passwords are stored through VS Code `SecretStorage`; the JSON connection file stores connection metadata without password fields. The code also masks common password values in user-facing error messages.

## Changes Made For Public Sharing

- Removed external translation calls. Diagnostic/notification translation is local rule-based so package names, variables, and file paths are not sent outside the machine.
- Removed the bundled default background image. The initial value is now no image.
- Split the full-window background image mod into `extensions/workbench-background-mod`.
- Renamed the extension and internal command/view namespace to `Custom Dev Tools & Theme Kit` / `customDevTools`.
- Added `.gitignore` entries for generated VSIX files, backups, retired experiments, logs, and dependency folders.
- Kept the localhost notification DOM bridge local-only on `127.0.0.1`. It is enabled by default for native notification-center synchronization and can be disabled with `customDevToolsThemeKit.enableNotificationDomBridge: false`.
- Added a basic Webview Content Security Policy helper to extension-owned webviews.

## Remaining Risks

- The separate `Custom Workbench Background Mod` modifies VS Code's `workbench.html` and checksum metadata when the user applies a native background. This is outside the official VS Code extension API and should stay separate from the Marketplace-safe main extension.
- Docker database auto-detection reads container environment variables. That is useful for local sync, but the behavior should stay documented because those environment variables may contain secrets.
- Webview CSP still permits inline scripts because the views are generated as extension-owned HTML strings. A nonce-based CSP is a good next hardening step.
- Official VS Code APIs do not allow a VSIX to place one image behind the full native workbench. The main extension therefore limits global theming to official color customization settings.

## Memory Review

Expected baseline memory impact is small because the extension has no bundled runtime server, no large dependency tree, and no long-lived data model beyond TreeView providers and a small connection cache.

Long-lived runtime elements:

- One Docker `events` child process watcher while the extension is active.
- TreeView providers for Java/Spring, Python, Docker, Database, and Notifications.
- Optional Webview panels when the user opens controller tests, table data, ERD, or Redis views.

The main memory spikes come from:

- Large DB table views, because result rows are rendered into a Webview.
- ERD views with many tables, because layout and SVG markup are kept in the Webview.

Practical conclusion: the extension should not noticeably increase idle memory for normal use. Memory usage becomes meaningful only when multiple retained Webview panels are open or a very large table result is rendered.
