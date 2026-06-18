# Release Notes

## v0.8.6
- **Edit approval policy now applies to the current session** — Setup Wizard → Edit Approval Policy now sends the new policy to the running session via `session/set_config_option` instead of waiting for a new session. Preserves conversation history, skills, and learned context. The setting is still saved either way, so the policy applies to future new sessions even if the live update fails (e.g. mid-prompt).
- Notification distinguishes three cases: applied to current session, no live session (next new session), or off mode (hermes default).

## v0.8.5
- **Setup Wizard → Edit Approval Policy** — new quickpick to change the policy without editing settings.json. Options: `accept_edits` (default), `dont_ask`, `ask` (strict — known to 60s-timeout in vscode's acp.agents integration), `off` (use hermes default). The change took effect only on the next new session until v0.8.6.

## v0.8.4
- **Reasoning / chain-of-thought streaming in the standalone webview** — when the model emits `reasoning_content` deltas, the extension now renders them in a collapsible "Reasoning" block above the assistant's final answer. Per the ACP spec, the events are delivered as `agent_thought_chunk` updates; the extension subscribes to them and streams the text into a `<details>` element expanded by default, capped at 320px with internal scroll.
- Works for models that stream reasoning natively (Kimi/Moonshot, DeepSeek, native Claude). Other models (minimax, ollama models without thinking) don't emit reasoning and the block simply doesn't appear — the existing "thinking..." inline indicator still shows during the wait.
- Each turn gets its own block. The block freezes when the turn ends and stays in the transcript for context.

## v0.8.3
- **Log levels** — replaced the dead `hermes.logTraffic` setting with `hermes.logLevel` (`silent` | `minimal` | `standard` | `debug`). Default is `standard` which shows session events without spamming the output channel. Use `debug` to see full JSON-RPC traffic between VS Code and the Hermes agent.
- **Setup wizard → Set Log Level** — quickpick to change the log level without editing settings.json.
- Large JSON dumps in the output channel are now truncated to 500 chars at standard level, with a hint pointing to `debug` for full output.

## v0.8.2
- **Sessions list shows which model was used** — the session history quickpick now shows the model name in the detail line for every session you started from this extension. Recorded in `globalState` per session id.
- **CSS-painted thinking indicator** — replaced the `💭` / `⚙️` emoji icons with pure CSS (pulsing dot for thinking, spinning gear for running tools) so the indicator renders identically on every system regardless of installed emoji fonts.
- **Cancel button no longer gets stuck** — the inline thinking indicator (and the cancel button) now hides as soon as the first model chunk arrives, not just when the server sends `thinking-end`.
- **5-minute safety timeout** — if the server never sends `thinking-end` and no model output ever arrives, the UI auto-resets with an error message instead of staying stuck.
- **Fix `Hermes ready — session...` mojibake** — replaced the UTF-8 em-dash with ASCII `--` so the status line renders cleanly everywhere.

## v0.8.1
- **Model change actually works** — fixed a bug where the `commandChooseModel` flow set `hermes.model` correctly but the new session was created with `params.model = "..."`, which is not a valid ACP `NewSessionRequest` field. The server silently dropped it and the new session always used hermes's default model. Now uses the proper `session/set_model` RPC.
- **Setup wizard → Change Active Model** — new entry that calls the model picker. Previously only the circuit-board icon could change the model.
- **Model picker works before first prompt** — `commandChooseModel` now auto-starts the agent if not connected, instead of bailing with "Not connected to agent".

## v0.8.0
- **Edit approval policy** — the agent was hanging for 60s on every file edit because `vscode.acp.autoApprovePermissions` doesn't cover the edit-approval flow. Now the extension calls `session/set_config_option` after every session start to flip the policy to `workspace_session` (= `accept_edits` mode = auto-allow workspace and /tmp edits; still asks for sensitive paths).
- **New setting `hermes.editApprovalPolicy`** — `accept_edits` (default) | `dont_ask` | `ask`. Switch to `ask` if you want the strict flow (and a 60s hang in this client).

## v0.7.1
- **Surface agent progress in Copilot Chat** — `stream.progress()` calls during the prompt turn show the phase instead of vscode's default `Analyzing` placeholder. Labels: `💭 thinking…` (default), `⚙️ running tools…` (while a tool runs), `💭 thinking… <reasoning>` (when the provider streams a thought chunk).

## v0.7.0
- **Add Marketplace icon** — added `media/icon.png` (128×128) for the VS Code Marketplace listing page. The existing `media/icon.svg` is still used for the in-editor Activity Bar icon.

## v0.6.9
- **Auto-resolve Hermes executable path** — the extension now automatically locates `hermes` in your system `PATH` when the setting is left as the default (`"hermes"`).
  - Uses `where hermes` (Windows) or `which hermes` (macOS/Linux) to find the binary.
  - If a full path is configured, it is validated before use.
  - Fixes `spawn C:/Users/.../hermes.exe ENOENT` errors caused by the previous hardcoded default path.
- **Default executable changed** — `hermes.executable` now defaults to `"hermes"` instead of a developer-specific Windows path.
- **Updated README** — added official Ollama installation instructions (`ollama launch hermes`), manual setup steps, and a `hermes --version` verification check.

## v0.6.8
- **Progress labels in Copilot Chat** — replaced the default `Analyzing` placeholder
  from the acp-client with informative labels:
  - `💭 thinking…` while waiting for the model
  - `⚙️ running tools…` while the agent runs tools
  - `💭 thinking… <reasoning>` when the agent streams thought chunks (first 40 chars)
  - Re-issued right before the model call so the label is visible during the
    longest wait on slow providers (ollama, overseas clouds)
- **Republished under new publisher** — extension is now `Natadel.hermes-ollama-vscode`
  (was `hermes.hermes-vscode`).
  - **If you have the old `hermes.hermes-vscode` installed, uninstall it first** to
    avoid duplicate toolbar icons. Both extensions register the same view container
    `hermes`, so they show as two stacked toolbars.
  - Open the Extensions panel (`Ctrl+Shift+X`), search `Hermes`, uninstall the one
    published by `hermes` (not `Natadel`), then Reload Window.
- Display name changed to **Ollama Hermes Agent** to match the new branding.

## v0.6.5
- Fix **Language Model provider** API compatibility with VS Code 1.120 types
- Update VS Code engine requirement to 1.120.0

## v0.6.4
- Fix Language Model provider — add missing `package.json` contribution point for `languageModels`

## v0.6.3
- Add **Language Model provider** — Hermes appears in Copilot Chat model dropdown
  - New setting `hermes.useLanguageModel` (default: false)
  - Toggle in Setup Wizard: "Use Language Model"
  - When enabled, Hermes shows as a model choice alongside GPT-4, Claude, etc.
  - Streams responses through native Copilot Chat UI
- Update VS Code engine requirement to 1.90.0 (for `lm` API)

## v0.6.2
- Fix `hermes.useCopilotChat` setting — now works **without reload**
  - Removed static `chatParticipants` from `package.json` (was always registering)
  - Participant is now registered/unregistered dynamically when setting changes
  - Toggle in Setup Wizard applies immediately

## v0.6.1
- Add **Chat Mode toggle** to Setup Wizard — switch between Webview Panel and Copilot Chat
- Reload prompt when switching modes

## v0.6.0
- Add **Copilot Chat participant** (`@hermes`) — chat with Hermes directly in GitHub Copilot Chat
  - Enable via `hermes.useCopilotChat` setting (requires reload)
  - Slash commands: `/new`, `/cancel`, `/sessions`, `/model`, `/setup`
  - Streams Hermes responses inline using native Copilot Chat UI
  - Falls back to webview panel when disabled
- Keep existing webview panel as default chat interface

## v0.5.2
- Update send button icon to match GitHub Copilot chat style
  - Thin stroke-based upward arrow (not filled shape)
  - Gray circle (#404040) when inactive, blue (var(--accent)) when active
  - Smaller size: 24px circle with 14px arrow
- Query Ollama API directly at `http://127.0.0.1:11434/api/tags` for real model discovery
- Remove broken Hermes API server model fetch (returns agent profile, not LLM models)
- Rename extension to **Ollama Hermes Agent**
- Update README and branding to reflect Ollama backend

## v0.5.0
- Add Setup Wizard (gear icon) for configuration helper
- Add API server integration for real-time model discovery
- Add `hermes.apiServerUrl` and `hermes.apiServerKey` settings
- Add model chooser icon (circuit-board) in toolbar
- Improve README with setup instructions and troubleshooting
- Fix model list parsing for pipe-separated formats

## v0.4.8
- Add hermes.modelList setting for available models

## v0.4.7
- Fix model config usage in newSession calls

## v0.4.6
- Add hermes.model configuration option in Settings

## v0.4.5
- Fix cancel button to reset turnInProgress
- Persist command history using globalState (survives restart)
- Add @types/events for EventEmitter types
- Add types: node to tsconfig.json

## v0.4.4
- Add arrow up/down for prompt history navigation

## v0.4.3
- Fix: add useDefineForClassFields: false to tsconfig.json to prevent class field crash

## v0.4.2
- Fix sessionId from loadSession (use passed sessionId, not response)
- Clean up README.md, add slash commands documentation

## v0.4.1
- Fix ACP methods: session/list and session/load
- Sessions list now uses QuickPick
- Pass cwd parameter when loading a session

## v0.4.0
- Add session management: auto-resume last session
- Add sessions list command
- Add resume specific session command
- Add sessions button to toolbar

## v0.3.0
- Resizable input-area
- Round send button with paper plane icon
- Send button color change when text entered
- Auto-resize textarea

## v0.2.0
- Fix connection issues: remove invalid --stdio flag
- Fix outputChannel access issue
- Add debug logging

## v0.1.0
- Initial release
- Basic Hermes chat in VS Code side panel
- ACP protocol integration
- Session management
