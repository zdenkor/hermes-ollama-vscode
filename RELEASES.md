# Release Notes

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