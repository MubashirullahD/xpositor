# Patchwork VS Code extension

This is the laptop-side launcher for Patchwork. It starts the existing read-only `companion.mjs` for the active workspace and shows a QR code containing the phone pairing link.

## Try it locally

1. Open `/Users/mubashir/Documents/Repository/patchwork/vscode-extension` in VS Code.
2. Run `npm install` in that folder once.
3. Press `F5` to launch an Extension Development Host.
4. Open a Git repository in that new window.
5. Run `Patchwork: Start for Workspace` from the Command Palette.
6. Scan the QR code shown in the Patchwork panel.

The extension defaults to the bundled companion when it has been packaged; in development it falls back to the sibling `../companion.mjs` in this checkout. Run `npm run extension:bundle` from the Patchwork root to prepare the bundled companion and PWA shell manually.

The extension asks the companion for an available LAN port by default, which avoids colliding with a manually running companion. You can set `patchwork.port` if you need a fixed port.

Set `patchwork.aiProvider` to `codex` or `claude` to reuse the CLI login already authenticated on the laptop. `auto` prefers Codex, then Claude Code, then the API provider. Patchwork invokes the CLI locally; credentials and subscription sessions never go to the phone. The CLI runs in a read-only, non-persistent mode for the file explanation request.

The extension never stages, edits, resets, or commits files. It only launches the companion process and manages its lifetime.
