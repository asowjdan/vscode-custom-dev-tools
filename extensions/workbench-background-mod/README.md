# Custom Workbench Background Mod

This VS Code extension keeps the full-window background image behavior in a separate local mod.

It can insert a managed CSS block into VS Code's `workbench.html` so the selected image appears behind the workbench. This is outside the official VS Code extension API and can trigger integrity warnings after VS Code updates.

Use this extension only when you explicitly want the local background mod. The Marketplace-safe development tools extension does not need this package.

## Behavior

- No bundled default image.
- User selects a local image.
- Image path, position, and size are stored locally in extension global state.
- The managed patch block is marked with `CUSTOM-WORKBENCH-BG-MOD-START` and `CUSTOM-WORKBENCH-BG-MOD-END`.
- Removing the background removes both this extension's patch block and the older `CUSTOM-DEV-TOOLS-BG` block if present.

## Safety Notes

- This extension does not send image paths or file contents to the network.
- The selected image is embedded into `workbench.html` as a data URI.
- Keep image sizes small to avoid bloating VS Code's workbench HTML.
- If VS Code updates, reapply the background from the view.
