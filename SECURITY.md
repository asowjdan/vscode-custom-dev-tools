# Security Notes

Custom Dev Tools & Theme Kit is a local-first VS Code extension. It does not include telemetry, analytics, remote collection code, or external translation calls.

## Sensitive Data

- Database passwords are stored with VS Code `SecretStorage` when the API is available.
- The local connection list stored at `~/.custom-dev-tools-db-connections.json` intentionally omits password values.
- Error messages are filtered through `shortError(...)` before being shown in the UI so common password environment variables and known connection passwords are masked.
- Docker database auto-detection can read container environment variables such as `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `POSTGRES_PASSWORD`. These values are used only for local connection testing/inspection and are moved into `SecretStorage`.

## VS Code Integrity

The current local experiment build contains an optional workbench background patch that can insert a managed CSS block into VS Code's `workbench.html` and update the related checksum entry. This is how the full-window background prototype is achieved, but it is outside the official VS Code extension API and can trigger integrity warnings or break after VS Code updates.

Do not publish this mode as a Marketplace-safe feature without a clear opt-in warning and a rollback path. A Marketplace-safe build should keep only official `workbench.colorCustomizations` and extension-owned Webview backgrounds.

## Localhost Bridge

The notification DOM bridge server is disabled by default. It can be enabled only with:

```json
"customDevToolsThemeKit.enableNotificationDomBridge": true
```

Leave this disabled unless you are testing a trusted local integration. The regular custom views do not require it.

## Webviews

Webviews use VS Code message passing and include a Content Security Policy that blocks default network access. The policy allows inline scripts because the current views are generated as static extension-owned HTML strings.

## Publishing Checklist

- Do not commit generated `dist/` VSIX files unless you intentionally want to publish release artifacts.
- Do not commit local backup folders or retired workbench patch experiments.
- No default background image is bundled. Users choose their own image locally from the Theme view.
