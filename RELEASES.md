# Release Notes

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