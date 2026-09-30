# Contributing to Xpositor

Thanks for helping. Bug reports, fixes and small improvements are all welcome. For a larger change, please open an issue first so we can agree on the approach before you spend time on it.

Security problems go through [SECURITY.md](SECURITY.md), not public issues.

## Sign your commits (DCO)

Xpositor uses the [Developer Certificate of Origin](https://developercertificate.org/) instead of a contributor license agreement. By adding a sign-off line to each commit, you certify that you wrote the change or otherwise have the right to submit it under the project's [Apache 2.0 license](LICENSE).

Add the line automatically with `-s`:

```sh
git commit -s -m "Fix pairing timeout on slow networks"
```

It appends a line with the name and email from your Git config:

```
Signed-off-by: Your Name <you@example.com>
```

To sign off commits you already made on your branch, run `git rebase --signoff main` and force-push.

## Set up

You need Node.js 20 or later and Git, on macOS, Windows or Linux.

```sh
cd vscode-extension
npm ci
cd ..
```

The companion and phone app have no npm dependencies. `npm ci` installs the extension's build tools and its QR code library.

### Run the extension from source

1. Open the `vscode-extension` folder in VS Code.
2. Press `F5` to launch an Extension Development Host.
3. Open a Git repository in the new window and click the Xpositor icon in the Activity Bar.

In development, the extension runs the companion from this checkout (`../companion.mjs`), so your changes take effect when you restart the companion.

### Run the companion alone

```sh
node companion.mjs /absolute/path/to/repository
```

Then open `http://127.0.0.1:4321`. `npm run serve` runs it for the current repository. Set `XPOSITOR_AI_PROVIDER=none` to work on the review interface without an AI provider.

## Test

```sh
npm test
```

The default suite uses temporary repositories and stub AI providers. It doesn't use your AI subscription or need API keys. HTTP tests need permission to bind loopback ports. CI runs the same suite on Ubuntu, macOS and Windows.

The browser scenarios in `tests/browser-*.cjs` run with `playwright-cli` against a companion started with AI disabled:

```sh
XPOSITOR_AI_PROVIDER=none node companion.mjs /path/to/repo
playwright-cli open http://127.0.0.1:4321
playwright-cli run-code --filename=tests/browser-review.cjs
```

They use stubbed responses, check phone and tablet layouts, and save screenshots under `/tmp`.

Opt-in live checks use your signed-in Codex allowance, so they aren't part of `npm test`:

- `node tests/live-agent-guide.mjs`: a 100-file plan and an unchanged caller.
- `node tests/live-guide-resume.mjs`: thread resume and branching across companion restarts.
- `node tests/live-audio-lesson.mjs`: a real spoken lesson.

### Debug AI requests

Set `XPOSITOR_AI_LOG=1` before starting the companion, or enable `xpositor.devAiLog` in VS Code. Each AI request is saved as a private JSONL file in `~/.xpositor/ai-logs/<date>/`, with the full prompt, every repository tool call, the provider's turns, the answer and timings. `XPOSITOR_AI_LOG_DIR` changes the location. The logs contain your code and questions.

Summarize a log with:

```sh
npm run ai-log -- <file or day directory>
```

Add `--prompt` or `--answer` to print those in full.

## Build the extension

```sh
npm run extension:bundle
cd vscode-extension
npm run package
```

This creates `vscode-extension/xpositor-<version>.vsix`. The package contains the extension as one unminified esbuild bundle, the companion, the phone app, and `ThirdPartyNotices.txt` for bundled libraries.

Install your build over an existing one:

```sh
code --install-extension ./vscode-extension/xpositor-0.1.0.vsix --force
```

On Windows PowerShell, use `code.cmd` instead of `code`, because `code` may open a window without installing. Then run **Developer: Reload Window** from the Command Palette.

## Pull requests

- Keep each pull request focused on one change.
- Run `npm test` before you open it, and add tests for new behaviour where you can.
- Match the style of the surrounding code. The companion and phone app deliberately avoid runtime dependencies and frameworks.
- Keep Xpositor read-only. It must never stage, edit, commit or push in the user's repository.
- If a change affects what data leaves the laptop, update the [privacy section](vscode-extension/README.md#privacy-what-leaves-your-laptop) in the same pull request.
