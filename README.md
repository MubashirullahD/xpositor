# Patchwork

Patchwork is a mobile-first PWA prototype for reviewing uncommitted code from a laptop, one focused file at a time.

## What is in this first slice

- A review queue for changed files with additions/removals and review progress.
- A realistic diff reader with file navigation and focused review actions.
- Diff, full current-source, and rendered Markdown views for each changed file.
- An AI-style “Code guide” panel that explains the selected file and accepts follow-up questions.
- Local persistence for the queue, per-file notes, and chat history through `localStorage`.
- A service worker and manifest so the review experience is available after the first load without a network connection.
- Responsive layouts that switch to a drawer/bottom-nav experience on a phone-sized viewport.

The UI opens with sample workspace data so it can be previewed as a standalone static page. When served by the included companion, it hydrates the `files` collection from the laptop repository while keeping review state local on the device.

Notes are private to the device that created them. They are not sent to the laptop companion or included in AI requests unless you copy them into a chat message yourself.

## Run locally

From this directory, use any static server. For example:

```sh
python3 -m http.server 4173
```

Then open `http://localhost:4173`. The service worker requires `localhost` (or HTTPS) to register.

## Connect a laptop workspace

The included read-only companion can expose the current `git diff HEAD` and fetch the full current source of changed files to the PWA. It does not stage, edit, or commit anything.

```sh
node companion.mjs /absolute/path/to/your/repository
```

By default it binds to `127.0.0.1:4321`. To open it from a phone on the same network, explicitly bind it to the laptop’s LAN interface and open the laptop’s LAN IP on the phone:

```sh
PATCHWORK_HOST=0.0.0.0 node companion.mjs /absolute/path/to/your/repository
```

LAN mode prints an ephemeral pairing token. On the phone, open `http://<laptop-lan-ip>:4321/?token=<printed-token>` once; Patchwork stores the token locally and removes it from the visible URL. You can also provide a stable `PATCHWORK_TOKEN` yourself. Plain HTTP mode is intended for a trusted local-network preview; use the HTTPS mode below when the phone needs reliable offline reloads.

For reliable offline reloads on a phone, serve the companion over HTTPS so the browser can install the service worker on the LAN origin. Provide a certificate whose SAN includes the laptop’s LAN IP (a locally trusted certificate from `mkcert` is the smoothest option):

```sh
mkcert -install
mkcert <laptop-lan-ip>
PATCHWORK_HOST=0.0.0.0 \
PATCHWORK_TLS_KEY=./<laptop-lan-ip>-key.pem \
PATCHWORK_TLS_CERT=./<laptop-lan-ip>.pem \
node companion.mjs /absolute/path/to/your/repository
```

The companion prints `https://` pairing links when both TLS variables are set. Plain HTTP remains useful for a quick preview, but it cannot provide the same service-worker guarantee on a phone.

The phone must trust the certificate’s issuing CA; otherwise the browser may show the page but will not install the service worker. With `mkcert`, install its local CA on the phone using the platform’s certificate settings, or use a certificate from a CA already trusted by the phone.

## Enable the Code guide

The companion now has an optional server-side AI route. The browser sends the selected file and recent chat context to the laptop; the API key never enters the mobile client.

```sh
OPENAI_API_KEY="your-key" OPENAI_MODEL="gpt-5" \
  node companion.mjs /absolute/path/to/your/repository
```

Without `OPENAI_API_KEY`, the UI stays in a local preview mode with deterministic sample answers. With a key configured, questions go through the Responses API and are requested with `store: false`.

The laptop companion can also reuse an existing local Codex or Claude Code login. Set `PATCHWORK_AI_PROVIDER=codex` or `PATCHWORK_AI_PROVIDER=claude` before starting it; `PATCHWORK_AI_PROVIDER=auto` prefers Codex, then Claude Code, then the API key provider. The CLI runs on the laptop in read-only, non-persistent mode, so the phone never receives CLI credentials. When using an existing subscription, Patchwork removes API-key environment overrides by default to avoid silently switching to metered API billing; explicitly opt in with `PATCHWORK_CODEX_USE_API_KEY=true` or `PATCHWORK_CLAUDE_USE_API_KEY=true` if that is intentional.

The provider contract can be checked without a real key or external request:

```sh
npm run test:smoke
```

The gentle nudge asks for browser notification permission and schedules a 7:30 PM reminder while the app is running. If the app was closed at reminder time, the next launch shows an in-app one-file nudge. Reliable OS notification delivery while the app is fully closed will still need a push service or a native wrapper.

## VS Code launcher (phase two)

The `vscode-extension/` folder contains the laptop-side launcher. Run `npm install` in that folder once, open it in VS Code, press `F5` to start an Extension Development Host, and open a Git repository there. The extension contributes a Patchwork icon to the Activity Bar; click it to open the pairing view and start the read-only companion on demand. `Patchwork: Start for Workspace` remains available from the Command Palette. `patchwork.autoStart` is off by default and can be enabled if you want it to start whenever VS Code opens with a workspace.

The extension bundles the companion during `vscode:prepublish` and uses the sibling script while developing from this repository. Configure `patchwork.aiProvider` to choose `auto`, Codex, Claude Code, or the API provider.

To build and install a local VSIX:

```sh
cd vscode-extension
npm install
npm run package
code --install-extension ./patchwork-vscode-0.1.0.vsix --force
```

This is local sideloading; Marketplace publishing is still a separate future step.
