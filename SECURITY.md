# Security Notes

Custom Dev Tools & Theme Kit is a local-first VS Code extension. It does not include telemetry, analytics, or remote collection code.

## Sensitive Data

- Database passwords are stored with VS Code `SecretStorage` when the API is available.
- The local connection list stored at `~/.custom-dev-tools-db-connections.json` intentionally omits password values.
- Error messages are filtered through `shortError(...)` before being shown in the UI so common password environment variables and known connection passwords are masked.
- Docker database auto-detection can read container environment variables such as `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD`, and `POSTGRES_PASSWORD`. These values are used only for local connection testing/inspection and are moved into `SecretStorage`.

## VS Code Integrity

The public extension source does not modify VS Code installation files, `product.json`, other installed extensions, or third-party extension folders. The Theme view uses official VS Code settings for color customization and stores the selected image path for extension-owned custom views.

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
