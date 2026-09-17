# Patchwork VS Code extension

This is the laptop-side launcher for Patchwork. It contributes a Patchwork icon to VS Code's Activity Bar. Opening its `Pair phone` view starts the existing read-only `companion.mjs` behind a Cloudflare Quick Tunnel and shows a temporary HTTPS QR link for the phone.

## Try it locally

1. Open `/Users/mubashir/Documents/Repository/patchwork/vscode-extension` in VS Code.
2. Run `npm install` in that folder once.
3. Press `F5` to launch an Extension Development Host.
4. Open a Git repository in that new window.
5. Click the Patchwork icon in the Activity Bar.
6. Scan the QR code shown in the `Pair phone` sidebar view.

Install Cloudflare's `cloudflared` helper once before opening the view:

```sh
brew install cloudflared
```

The companion and temporary HTTPS tunnel do not start just because the extension is installed. They start when the Activity Bar view is opened, or when you run `Patchwork: Start Secure Tunnel`. The `patchwork.autoStart` setting is available for users who prefer automatic startup and defaults to `false`.

Quick Tunnels are free and do not require a Cloudflare account or domain, but Cloudflare documents them as development/testing tunnels without an uptime guarantee. The phone can be on cellular or another Wi‑Fi network as long as both devices can reach the Internet. The pairing link contains a short-lived access token, so keep it private. The connection is relayed through Cloudflare; this protects it from local-network snooping but treats Cloudflare as a trusted intermediary.

The extension defaults to the bundled companion when it has been packaged; in development it falls back to the sibling `../companion.mjs` in this checkout. Run `npm run extension:bundle` from the Patchwork root to prepare the bundled companion and PWA shell manually.

The extension asks the companion for an available local port by default, which avoids colliding with a manually running companion. You can set `patchwork.port` if you need a fixed port. Set `patchwork.cloudflaredPath` if `cloudflared` is installed somewhere other than your PATH.

Set `patchwork.aiProvider` to `codex` or `claude` to reuse the CLI login already authenticated on the laptop. `auto` prefers Codex, then Claude Code, then the API provider. Patchwork invokes the CLI locally; credentials and subscription sessions never go to the phone. The CLI runs in a read-only, non-persistent mode for the file explanation request.

The extension never stages, edits, resets, or commits files. It only launches the local companion and its Quick Tunnel, then manages both processes' lifetimes.

## Build and install a local VSIX

From this directory:

```sh
npm install
npm run package
code --install-extension ./patchwork-vscode-0.1.0.vsix --force
```

The package contains the launcher, QR renderer, bundled read-only companion, PWA shell, and production QR runtime dependencies. It is installed locally and is not published to the VS Code Marketplace.
