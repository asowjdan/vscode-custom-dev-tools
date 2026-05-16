# Security Notes

Custom Dev Tools & Theme Kit is a local-first VS Code extension. It does not include telemetry, analytics, remote collection code, or external translation calls.

## Sensitive Data

- Database passwords are stored with VS Code `SecretStorage` when the API is available.
- The local connection list stored at `~/.custom-dev-tools-db-connections.json` intentionally omits password values.
- Error messages are filtered through `shortError(...)` before being shown in the UI so common password environment variables and known connection passwords are masked.
- Docker database auto-detection can read container environment variables such as `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `POSTGRES_PASSWORD`. These values are used only for local connection testing/inspection and are moved into `SecretStorage`.

## VS Code Integrity

The main `Custom Dev Tools & Theme Kit` extension does not modify VS Code installation files, `product.json`, other installed extensions, or third-party extension folders. The Design view uses official VS Code color customization settings.

The full-window workbench background behavior is split into the separate `Custom Workbench Background Mod` local VSIX. That mod can insert a managed CSS block into VS Code's `workbench.html` and update the related checksum entry. It is outside the official VS Code extension API and should not be treated as Marketplace-safe without a clear opt-in warning and rollback path.

## Localhost Bridge

The notification DOM bridge server is enabled by default so the custom notification tab can mirror VS Code's native notification center. It binds only to `127.0.0.1` and accepts notification snapshots used for local UI synchronization. It can be disabled with:

```json
"customDevToolsThemeKit.enableNotificationDomBridge": false
```

Disable this if you do not use native notification-center synchronization or if you want to avoid any localhost bridge.

## Webviews

Webviews use VS Code message passing and include a Content Security Policy that blocks default network access. The policy allows inline scripts because the current views are generated as static extension-owned HTML strings.

## Publishing Checklist

- Do not commit generated `dist/` VSIX files unless you intentionally want to publish release artifacts.
- Do not commit local backup folders or retired workbench patch experiments.
- No default background image is bundled. Users choose their own image locally from the Theme view.
