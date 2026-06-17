# Release Notes

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
