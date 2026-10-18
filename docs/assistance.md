# AI assistance

**English** | [简体中文](assistance.zh-CN.md)

## Usage

Open **AI assistant** in the sidebar. Run [Ollama](https://docs.ollama.com/) on the same computer,
disable its cloud features with `OLLAMA_NO_CLOUD=1`, and install a local model that supports
[structured outputs](https://docs.ollama.com/capabilities/structured-outputs). Save that model's
name and Ollama's port (default `11434`) in **Local model setup**. The app does not install models.

Enter a request, or leave it empty for general task advice, then choose **Generate suggestions**.
Generation runs on a worker; navigation and normal productivity features remain available.
There are no startup requests, scheduled requests, or automatic executions.

Each card shows the rationale, operation and affected records. Choose **Confirm and execute**
to apply exactly that saved preview, **Reject** to dismiss it, or **Edit suggestion** to change
its fields. **Save preview** only updates the proposal: execution requires a separate click on
**Confirm and execute**. Pending proposals survive navigation and application restarts.

## Supported actions

| Kind | Fields | Effect after confirmation |
| --- | --- | --- |
| `createTodo` | `title` | Create an active task |
| `completeTodo` | `todoId` | Mark an existing active task complete and stamp `completed_at` |
| `setTodoTags` | `todoId`, `tagIds` | Replace that task's tags, updating the links and cached ids together |
| `renameTag` | `tagId`, `name` | Rename an existing tag; names remain case-insensitively unique |
| `createAlarm` | `label`, `hour`, `minute` | Create a one-off reminder at the next local occurrence; use the normal alarm defaults |

Prioritization advice is expressed in the rationale; this feature does not introduce task
priority or due-date fields. A model is instructed never to infer completed work without
evidence in the user's request. Every proposed action still requires review.

## Data flow and validation

`AssistancePage` / `AiSuggestionCard` → `assistanceStore` → `assistance_commands` →
`services/assistance` (inference) / `models/assistance` (review and execution) → SQLite.

Only a bounded snapshot of up to 200 tasks (active first, newest first) and 100 tags, plus the
request, is supplied to the model. Application history and window titles are excluded. HTTP
requests go to `http://127.0.0.1:<port>/api/chat`; proxies and redirects are disabled. Cloud model
names are rejected. Use a local model and disable Ollama's cloud features as described above.
The normal app works without Ollama. Unavailable models and invalid replies show a recoverable
error and do not change business data.

The model returns JSON proposals through a fixed five-action allow-list, with at most six
proposals per response and 100 pending proposals in total. Unknown operations/fields, blank or
oversized text, invalid times and ids absent from the supplied context are rejected. A failed
batch stores no partial proposals. Request timeout is 120 seconds, response limit is 128 KiB.

Proposals retain the actual target values from inference. Data changed during inference causes
the batch to fail; data changed afterwards causes confirmation to fail. Saving an edit captures
the current target and increments the revision. Confirmation accepts only a stored suggestion
id, the reviewed revision and `confirmed: true`, never a replacement action. Repeated or stale
confirmations cannot execute again. Business changes, terminal status and confirmation audit
entry share one SQLite transaction; any failure rolls all three back.

## Operation log

The page lists proposal, edit, confirmation and rejection entries newest first, with reasons,
action payloads, UTC timestamps rendered in the chosen locale, suggestion ids, and affected
record ids for successful actions. Original and edited payloads are separate entries. Historical
targets use ids so later renames/deletions cannot rewrite the displayed operation. Older entries
are accessible through cursor paging, 50 per page.

**Clear log** asks for inline confirmation and removes audit entries and resolved proposal rows.
Tasks, tags, reminders and pending proposals remain; clearing does not execute or undo an action.

## Verification

Run `pnpm lint`, `pnpm build`, `cargo fmt --check`, `cargo clippy -- -D warnings` and `cargo test`
(Cargo commands from `src-tauri/`). Rust tests cover inference over a local HTTP stub, malformed
replies, stale inference data, explicit confirmation, edits, rejection, duplicate/concurrent
confirmation, tag integrity, log rollback, restart persistence, clearing and paging.

For UI checks run `pnpm exec playwright install chromium` once, then `pnpm test:ui`. These tests
use an IPC fixture, without a running model. For a real-model pass, run the desktop app with a
local Ollama model; generate, edit/save, confirm/reject, restart, then clear the log. Verify that
the task list and alarms remain usable while inference is pending.

Task snapshots include deadlines and recurrence metadata. Confirming after a deadline edit or a recurring cycle boundary requires a fresh review; the assistant cannot complete a different cycle using an old preview. The AI page is also available in the sidebar drag editor.
