# Repository-wide conversational guide

Status: implemented for Codex and Claude Code. The conversational UI, immutable repository tools, complete plans, explicit cancellation, saved progress, branched conversations and companion-restart persistence are connected.

## Experience

One action: **Walk me through these changes**. The companion prepares one file-specific Overview summary for each relevant changed file from its immutable capture, using up to four concurrent workers and batches of eight files. Common lockfiles are skipped. Each completed batch becomes visible before the walkthrough is ready. Once summaries finish, the agent receives them with the changed inventory, groups related changes, explains overall intent, and proposes a review order. The reader sees one explanation with code links and a Next button. Questions can branch into named conversations while the main walkthrough keeps its place. Model selection stays in the composer.

Every changed file belongs to the review plan, including a 100-file change. “Available to the agent” and “examined by the agent” are distinct: record which files it read and explicitly flag files omitted from the explanation. Do not claim complete review based solely on listing paths.

## Codex integration

Keep the existing ChatGPT-authenticated Codex app-server process and dynamic model discovery. Replace the text-only adapter with a repository-aware read-only thread. App-server supports tools, streamed item events, turn interruption, persistent thread resume, and thread forks. No separate API key is required for the existing subscription-authenticated path; account allowances still apply.

1. Capture an isolated review workspace containing unchanged tracked context as well as all changed content, with the same immutable revision used by the phone. Exclude ignored files and reject escaping symlinks. Expose the complete manifest before any retrieval. Report file/byte capture limits explicitly.
2. Run Codex from an empty temporary directory with read-only sandboxing, no network and no approval escalation. Dedicated dynamic tools return only captured repository content. Native shell, hooks, unrelated plugins, connectors and writes are disabled. Unknown tools, stale turn calls and out-of-capture paths are rejected at the companion boundary.
3. Send the task and change manifest. Let the harness search and read relevant code in multiple turns rather than stuffing all sources into one prompt. Context windows still exist; retrieval and compaction handle larger repositories.
4. Stream tool activity unobtrusively alongside the response. Persist thread IDs and the review-workspace identity on the companion. Resume only against the same snapshot; a changed snapshot starts a new review thread.
5. Use `thread/fork` for an explicit “Explore this” action. Ordinary follow-ups continue their conversation. Track parent thread, selected step, and snapshot; reconnect to an active turn instead of duplicating it.
6. Validate navigable citations against captured files. Keep private notes out of automatic context. Downloads remain usable offline, but model turns still require the laptop or a separately hosted agent runtime.

Acceptance checks: a 100-file fixture produces complete plan coverage; the agent finds an unchanged caller not included in the initial prompt; attempted writes/out-of-root reads fail; branching preserves the main walkthrough; reload/reconnect does not duplicate turns; cancellation stops tools; citations still resolve after the original worktree changes.

Claude Code receives the same four tools through a per-run MCP endpoint that the companion serves on loopback with a random bearer token (`claude-tools.mjs`). Claude runs with built-in tools disabled, `--permission-mode dontAsk`, and only those tools allowed. Claude runs are stateless: follow-ups carry the recent conversation instead of resuming a thread, and branches start from a copy of it. Live check, 27 September 2026: Sonnet produced a plan, audio lesson, follow-up, deep section and deep follow-up on a two-file change, calling `review_diff`, `review_read` and `review_search`. Full editing/terminal/network capability is a separate product mode, with visible permissions and change review, rather than an implicit consequence of asking for an explanation.

Source checked 19 September 2026: [official Codex App Server documentation](https://learn.chatgpt.com/docs/app-server).

## Staging and review scope

Offer **Unstaged / Staged / All changes**, with Unstaged as a useful preference for this user's workflow. Staged is a workflow signal, not an automatic whole-file approval: partially staged files can contain both reviewed and new hunks. Implement distinct Git comparisons (`index → worktree`, `HEAD → index`, `HEAD → worktree`) and bind notes/review decisions to the chosen comparison and content revision. Keep staged code available as context to the agent even when it is outside the review queue.

## Implementation and validation

`agent-plan.mjs` validates complete changed-file assignment, a suggested order, captured old/new citations and actual retrieval coverage. The 101-file fixture rejects omissions, duplicates, out-of-scope paths and fabricated citations.

`guide-runs.mjs` owns generation independently of HTTP observers. `agent-guide-service.mjs` connects it to generation, follow-ups, forks, and `/api/guide/*` endpoints. Stable request IDs prevent duplicate generation after a tab reconnects; disconnecting an observer does not cancel the run, while an explicit stop does. Run history and replies are bounded. Run IDs, conversation metadata and captured snapshots persist in private companion storage. Completed requests reconnect; interrupted requests restore as failed and never automatically replay.

Live retrieval is now verified after explicit user authorization for `code_mode_host=true` only in dedicated repository-guide processes. Text-only processes retain the disabled host; native shell, network, plugins and writes remain restricted. The live Luna smoke check invoked the captured repository tools and answered from their returned source. Patchwork supplies the setting at process launch; users do not need to change global CLI settings.

Walkthrough steps may revisit an important file. The suggested review queue follows the first occurrence of each file and includes each changed file once; validation still rejects missing files, duplicate assignments within a single step and invalid citations. Refresh reuses the captured snapshot while the review itself is unchanged: the same changed files, content and comparison base. Edits elsewhere (supporting files, other scopes, commits of unrelated files) keep the snapshot, so its walkthrough stays; the agent keeps reading that capture's supporting context. When a reviewed file changes, the guide offers to continue the most recent earlier walkthrough for the same scope, naming the files that changed since, or to start fresh; that choice is remembered for the capture.

Live acceptance evidence: `node tests/live-agent-guide.mjs` passed with Luna: 100 changed files in a four-step plan, all 100 recorded as examined, an unchanged `entry.js` caller found in a fork after the original file changed, and the main conversation's step preserved. `tests/browser-agent-guide.cjs` covers the browser flow, reload deduplication, supporting citations, branches, main-step retention, mobile layout and explicit stop. `tests/live-guide-resume.mjs` additionally passed real Codex resume and fork across companion restarts, including immutable unchanged caller retrieval.
