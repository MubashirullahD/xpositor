# Xpositor

**Review your code changes from your phone, with an AI guide that walks you through them.**

Xpositor puts the uncommitted changes in a Git repository on your phone. Pair from VS Code with a QR code, then read the diffs, note questions and mark files reviewed. A guided walkthrough explains the changes step by step using the Codex or Claude Code login already on your laptop.

There's no Xpositor server, account or telemetry. Your code goes only to your phone, to Cloudflare if you choose the HTTPS tunnel, and to your own AI provider when you use the guide. The [privacy section](vscode-extension/README.md#privacy-what-leaves-your-laptop) explains each one.

## Install

Install **Xpositor** (`mubash.xpositor`) from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=mubash.xpositor), or from [Open VSX](https://open-vsx.org/extension/mubash/xpositor) for Cursor, Windsurf and other VS Code–compatible editors. Then click the Xpositor icon in the Activity Bar and scan the QR code.

The [extension README](vscode-extension/README.md) covers requirements, pairing, the AI guide, settings and privacy.

## How it works

Xpositor has three parts, all in this repository:

- **The companion** (`companion.mjs` and the `*.mjs` modules next to it) is a small Node server with no npm runtime dependencies. It runs on your laptop, captures a read-only snapshot of your Git changes, serves the phone app and runs the AI guide through your local Codex or Claude Code CLI.
- **The phone app** (`index.html`, `src/`, `public/`) is a plain-JavaScript web app that stores notes and review state in the phone's browser and works offline once a snapshot is loaded.
- **The VS Code extension** (`vscode-extension/`) starts the companion, shows the pairing QR code, and optionally runs a Cloudflare tunnel.

You can also run the companion without VS Code:

```sh
node companion.mjs /absolute/path/to/repository
```

Then open `http://127.0.0.1:4321`. The [reference](docs/reference.md) describes the companion, phone app and code guide in detail.

## Contributing

Bug reports and pull requests are welcome. [CONTRIBUTING.md](CONTRIBUTING.md) covers building, testing and the sign-off on commits.

To report a security problem, follow [SECURITY.md](SECURITY.md). Please don't open a public issue for it.

## License

Xpositor is licensed under the [Apache License 2.0](LICENSE). See [NOTICE](NOTICE) for attribution, including the bundled Prism highlighter (MIT).
