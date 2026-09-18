# Patchwork VS Code extension

This is the laptop-side launcher for Patchwork. It contributes a Patchwork icon to VS Code's Activity Bar. Opening its `Pair phone` view starts the existing read-only `companion.mjs` behind a Cloudflare Quick Tunnel and shows an HTTPS QR link for the phone.

## Try it locally

1. Open the `vscode-extension` folder from this checkout in VS Code.
2. Run `npm install` in that folder once.
3. Press `F5` to launch an Extension Development Host.
4. Open a Git repository in that new window. In a multi-root workspace, Patchwork asks which Git repository to review.
5. Click the Patchwork icon in the Activity Bar.
6. Scan the QR code shown in the `Pair phone` sidebar view.

Install Cloudflare's `cloudflared` helper once before opening the view:

```sh
brew install cloudflared
```

The companion and temporary HTTPS tunnel do not start just because the extension is installed. They start when the Activity Bar view is opened, or when you run `Patchwork: Start Secure Tunnel`. The `patchwork.autoStart` setting is available for users who prefer automatic startup and defaults to `false`.

Quick Tunnels are free and do not require a Cloudflare account or domain, but Cloudflare documents them as development/testing tunnels without an uptime guarantee. The phone can be on cellular or another Wi‑Fi network as long as both devices can reach the Internet. The pairing link contains a short-lived access token, so keep it private. The connection is relayed through Cloudflare; this protects it from local-network snooping but treats Cloudflare as a trusted intermediary.

Each Quick Tunnel receives a different HTTPS origin. Phone-local notes, review state, and installed PWA storage remain at the earlier origin, so scan the latest QR when starting a new Quick Tunnel. This is the free default and needs no account, domain, or paid service.

## Optional stable named tunnel

If you already operate a Cloudflare named tunnel and public hostname, configure all three settings for the workspace machine:

```json
{
  "patchwork.port": 4311,
  "patchwork.tunnelName": "my-existing-tunnel",
  "patchwork.publicUrl": "https://patchwork.example.com"
}
```

Provision the tunnel and hostname outside Patchwork, with an ingress rule that forwards that hostname to `http://127.0.0.1:4311`. Patchwork only runs `cloudflared tunnel run my-existing-tunnel`; it never creates a Cloudflare account, tunnel, DNS record, or network configuration. The fixed port is required because the external ingress configuration must know where to send the request.

With this option, the URL stays on one HTTPS origin and Patchwork saves a repository-specific pairing token in VS Code Secret Storage. That lets the same paired phone retain its local review state across launcher restarts. Treat the stable pairing link as a credential: changing the saved token or clearing VS Code secrets requires pairing again.

The extension uses the sibling `../companion.mjs` when running in an Extension Development Host, so development follows this checkout. A deployed extension uses its bundled companion. Run `npm run extension:bundle` from the Patchwork root before packaging to refresh that bundle.

The extension asks the companion for an available local port by default, which avoids colliding with a manually running companion. Set `patchwork.port` for a fixed port, including the optional named-tunnel setup. Set `patchwork.cloudflaredPath` if `cloudflared` is installed somewhere other than your PATH. Startup has a 30-second deadline by default; use `patchwork.startupTimeoutSeconds` (5–300) if a managed tunnel needs longer.

Set `patchwork.aiProvider` to `codex` or `claude` to reuse the CLI login already authenticated on the laptop. `auto` tries a verified Codex subscription login, then Claude Code. It never falls back to an API key automatically. Patchwork invokes the CLI locally; credentials and subscription sessions never go to the phone. Codex uses ephemeral app-server threads with tools disabled. Claude Code uses a tool-free invocation. API billing requires explicitly choosing `api`.

The extension never stages, edits, resets, or commits files. It only launches the local companion and its Quick Tunnel, then manages both processes' lifetimes.

## Build and install a local VSIX

From this directory:

```sh
npm install
npm run package
code --install-extension ./patchwork-vscode-0.1.0.vsix --force
```

The package contains the launcher, QR renderer, bundled read-only companion, PWA shell, and production QR runtime dependencies. It is installed locally and is not published to the VS Code Marketplace.
