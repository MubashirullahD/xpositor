# Security policy

Xpositor runs on your laptop next to private code, so security reports are very welcome.

## Reporting a vulnerability

**Please don't report security problems in public issues, discussions or pull requests.**

Report them privately through GitHub instead:

1. Open the repository's [Security tab](https://github.com/MubashirullahD/xpositor/security).
2. Choose **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

I'll try to acknowledge your report within a week and keep you updated as I work on a fix. Once a fix is released, I'll publish an advisory and credit you, unless you'd rather stay anonymous.

## Supported versions

Xpositor is in preview. Only the latest release on the VS Code Marketplace and Open VSX receives security fixes.

## What's in scope

Examples of problems I especially want to hear about:

- Reaching the companion or its data without the pairing link.
- Reading files outside the captured snapshot, for example through symlinks or path tricks.
- The AI guide running commands, writing files, reaching the network, or reading beyond the read-only repository tools.
- Script injection in the phone app from repository content, file names, Markdown or AI replies.
- Credentials, pairing keys or code leaking to a place the [privacy section](vscode-extension/README.md#privacy-what-leaves-your-laptop) doesn't describe.

These behaviours are documented and expected, so they aren't vulnerabilities by themselves:

- Local Wi-Fi mode uses plain HTTP, so someone watching the network can read the traffic.
- In tunnel mode, Cloudflare can see the traffic it relays.
- Anyone who has the pairing link can open the session.
- Code the AI guide reads is sent to the AI provider you chose.
