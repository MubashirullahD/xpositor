# Patchwork VS Code extension

This is the laptop-side launcher for Patchwork. It contributes a Patchwork icon to VS Code's Activity Bar. Opening its `Pair phone` view starts the existing read-only `companion.mjs` on the local LAN and shows a QR link immediately. The sidebar can switch to an HTTPS Cloudflare tunnel. Switching reuses the same companion and any running tunnel; only stopping or restarting the session creates a new Quick Tunnel. The companion remains accessible on the LAN in either mode.

## Try it locally

1. Open the `vscode-extension` folder from this checkout in VS Code.
2. Run `npm ci` in that folder once.
3. Press `F5` to launch an Extension Development Host.
4. Open a Git repository in that new window. In a multi-root workspace, Patchwork asks which Git repository to review.
5. Click the Patchwork icon in the Activity Bar.
6. Scan the QR code shown in the `Pair phone` sidebar view.

For the optional HTTPS tunnel, install Cloudflare's `cloudflared` helper once. The pairing sidebar shows this requirement and links to Cloudflare's installation instructions when HTTPS tunnel is selected:

```sh
brew install cloudflared
```

The companion starts when the Activity Bar view is opened, or when you run `Patchwork: Start Phone Review`. LAN is the default: both devices must use the same trusted Wi-Fi. Select **HTTPS tunnel** in the pairing view to use another network. Configure `patchwork.transport` to change the default. LAN uses unencrypted HTTP; HTTPS is required for PWA installation and offline relaunch. All captured text sources are downloaded immediately, so an open LAN tab can still read them after the laptop disconnects. The `patchwork.autoStart` setting is available for users who prefer automatic startup and defaults to `false`.

Quick Tunnels are free and do not require a Cloudflare account or domain, but Cloudflare documents them as development/testing tunnels without an uptime guarantee. The phone can be on cellular or another Wi‑Fi network as long as both devices can reach the Internet. The pairing link contains a short-lived access token, so keep it private. The connection is relayed through Cloudflare; this protects it from local-network snooping but treats Cloudflare as a trusted intermediary.

Each Quick Tunnel receives a different HTTPS origin. Phone-local notes, review state, and installed PWA storage remain at the earlier origin, so scan the latest QR when starting a new Quick Tunnel. The tunnel option needs no account, domain, or paid service. LAN addresses and automatic ports can change too; use a fixed port and stable LAN address or export/import to carry review state across origins.

## Optional stable named tunnel

If you already operate a Cloudflare named tunnel and public hostname, configure all three settings for the workspace machine:

```json
{
  "patchwork.transport": "tunnel",
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

The pairing sidebar checks the companion's actual provider login and displays the connected provider. Use **Recheck connection** after installing or signing in, and **Choose provider** to open the setting; changing the setting restarts the companion. On Windows, installing only the Codex VS Code extension may leave no `codex` command for Patchwork. Install the CLI separately in PowerShell, sign in, then reload VS Code so its extension host gets the updated PATH:

```powershell
npm install -g @openai/codex
codex
```

Choose ChatGPT sign-in when Codex starts. Patchwork supports npm's Windows `.cmd` launchers without invoking a shell. If Codex is still unavailable, run `where.exe codex` in PowerShell and check the reported location. For Claude Code, install its CLI and verify `claude auth status`. A connected Claude account gives file explanations and the classic walkthrough; repository-wide agent guides and model selection currently require Codex.

The extension never stages, edits, resets, or commits files. It only launches the local companion and optional tunnel, then manages their lifetimes.

## Build and install a local VSIX

From this directory, build the VSIX:

```sh
npm ci
npm run package
```

Install or update it from this directory (`patchwork\vscode-extension>` in PowerShell). The VSIX is in the current directory, so do not repeat `vscode-extension` in its path. On Windows PowerShell, invoke `code.cmd` so PowerShell does not pick `Code.exe`, which opens a window without processing extension installation flags:

```powershell
code.cmd --install-extension .\patchwork-vscode-0.1.0.vsix --force
```

On macOS or Linux:

```sh
code --install-extension ./patchwork-vscode-0.1.0.vsix --force
```

The `--force` flag replaces an installed build with the same version number. After installation, run **Developer: Reload Window** from VS Code's Command Palette, then click the Patchwork icon in the Activity Bar. Alternatively, open **Extensions → … → Install from VSIX…**, choose the rebuilt VSIX, and reload the window. The package contains the launcher, QR renderer, bundled read-only companion, PWA shell, and production QR runtime dependencies. It is installed locally and is not published to the VS Code Marketplace.

### Audio walkthrough

With Codex selected, starting a walkthrough automatically prepares its first spoken chapter and audio. Each chapter uses the main code reader for references. Playback stops after each section; Left/Right navigate sections and Space plays or pauses while the walkthrough has focus. Transcript highlighting estimates word positions within measured speech phrases. Three local voices and playback speed controls are included. Questions pause playback; listening never marks code reviewed.

Voice generation runs locally through Kokoro. Click **Install local voice** in the Patchwork pairing sidebar for one-time setup. This requires Node.js 20+ and npm on the laptop; the button downloads the runtime and model into `~/.patchwork/voice` and reports success or failure in the sidebar. It does not use a paid TTS API. Refresh an open phone page after setup. From a source checkout, `npm run setup:voice` is also available. Transcript and references remain usable if audio is unavailable. Audio currently requires the laptop for new audio and uses typed follow-up questions.
