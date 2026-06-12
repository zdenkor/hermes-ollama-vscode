# Release Notes

## v0.4.3
- Fix: add `useDefineForClassFields: false` to tsconfig.json to prevent class field crash

## v0.4.2
- Fix sessionId from loadSession (use passed sessionId, not response)
- Clean up README.md, add slash commands documentation

## v0.4.1
- Fix ACP methods: session/list and session/load (not listSessions/loadSession)
- Sessions list now uses QuickPick instead of webview message (which had no handler)
- Pass cwd parameter when loading a session

## v0.4.0
- Add session management: auto-resume last session on startup
- Add sessions list command (hermes.sessions) 
- Add resume specific session command (hermes.resumeSession)
- Add sessions button to toolbar with history icon
- Remove sessions button from input area (correct position is toolbar)

## v0.3.0
- Resizable input-area container (60px-300px height)
- Round send button with paper plane arrow icon
- Send button changes from gray to blue when text is entered
- Auto-resize textarea based on content (max 200px)
- iOS style send icon

## v0.2.0
- Fix connection issues: remove invalid --stdio flag from hermes acp command
- Fix outputChannel access (was causing extension activation failure)
- Add debug logging for connection troubleshooting
- Add README.md with installation and usage instructions

## v0.1.0
- Initial release
- Basic Hermes chat in VS Code side panel
- ACP protocol integration
- Session management (new, cancel, restart)
