# Repository-wide conversational guide

Status: proposed next architectural change. The current implementation still sends bounded snapshot context and disables repository tools. Simplifying its controls does not remove those limits.

## Experience

One action: **Walk me through these changes**. The agent inventories every changed path, groups related changes, explains the overall intent, and proposes a review order. The reader sees one explanation with code links and a Next button. Questions can branch into named conversations while the main walkthrough keeps its place. Model selection stays in the composer.

Every changed file belongs to the review plan, including a 100-file change. “Available to the agent” and “examined by the agent” are distinct: record which files it read and explicitly flag files omitted from the explanation. Do not claim complete review based solely on listing paths.

## Codex integration

Keep the existing ChatGPT-authenticated Codex app-server process and dynamic model discovery. Replace the text-only adapter with a repository-aware read-only thread. App-server supports tools, streamed item events, turn interruption, persistent thread resume, and thread forks. No separate API key is required for the existing subscription-authenticated path; account allowances still apply.

1. Capture an isolated review workspace containing unchanged tracked context as well as all changed content, with the same immutable revision used by the phone. Exclude ignored files and reject escaping symlinks. Expose the complete manifest before any retrieval. Report file/byte capture limits explicitly.
2. Start Codex in that workspace with read-only sandboxing, restricted readable roots, no network and no approval escalation. Enable repository read/search tools. Keep hooks, unrelated plugins, connectors and writes disabled for review mode. Verify platform sandbox enforcement before advertising this restriction.
3. Send the task and change manifest. Let the harness search and read relevant code in multiple turns rather than stuffing all sources into one prompt. Context windows still exist; retrieval and compaction handle larger repositories.
4. Stream tool activity unobtrusively alongside the response. Persist thread IDs and the review-workspace identity on the companion. Resume only against the same snapshot; a changed snapshot starts a new review thread.
5. Use `thread/fork` for an explicit “Explore this” action. Ordinary follow-ups continue their conversation. Track parent thread, selected step, and snapshot; reconnect to an active turn instead of duplicating it.
6. Validate navigable citations against captured files. Keep private notes out of automatic context. Downloads remain usable offline, but model turns still require the laptop or a separately hosted agent runtime.

Acceptance checks: a 100-file fixture produces complete plan coverage; the agent finds an unchanged caller not included in the initial prompt; attempted writes/out-of-root reads fail; branching preserves the main walkthrough; reload/reconnect does not duplicate turns; cancellation stops tools; citations still resolve after the original worktree changes.

Claude Code needs its own equivalent tool/session adapter and live authentication validation. Current Claude support is text-only; Codex behavior does not establish Claude parity. Full editing/terminal/network capability is a separate product mode, with visible permissions and change review, rather than an implicit consequence of asking for an explanation.

Source checked 19 September 2026: [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Staging and review scope

Offer **Unstaged / Staged / All changes**, with Unstaged as a useful preference for this user's workflow. Staged is a workflow signal, not an automatic whole-file approval: partially staged files can contain both reviewed and new hunks. Implement distinct Git comparisons (`index → worktree`, `HEAD → index`, `HEAD → worktree`) and bind notes/review decisions to the chosen comparison and content revision. Keep staged code available as context to the agent even when it is outside the review queue.
