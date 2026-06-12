# Hermes VS Code Extension

Chat with [Hermes Agent](https://hermes-agent.nousresearch.com/) directly in VS Code using the ACP protocol.

## Features

- **Native Integration** - Chat with Hermes in a VS Code side panel
- **Full Agent Capabilities** - Access all Hermes tools, memory, and skills
- **Session Management** - Create new sessions, cancel turns, restart agent
- **Streaming Responses** - See agent responses as they are generated
- **Token Usage** - Display token usage for each turn

## Requirements

- [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) installed and configured
- VS Code 1.85.0 or later

## Installation

### From VSIX

1. Download the latest `.vsix` file from [Releases](https://github.com/zdenkor/hermes-ollama-vscode/releases)
2. Run: `code --install-extension hermes-vscode-x.x.x.vsix`

### From Source

```bash
npm install
npm run build
npx vsce package
code --install-extension hermes-vscode-*.vsix
```

## Configuration

### hermes.executable

Path to the Hermes executable.

**Default (Windows):** `C:/Users/{username}/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe`

**Default (macOS/Linux):** `~/.local/bin/hermes` or `~/Library/Hermes/hermes-agent/venv/bin/hermes`

### hermes.defaultCwd

Default working directory for agent sessions. Defaults to the current VS Code workspace.

### hermes.logTraffic

Log ACP protocol traffic to the output panel for debugging.

## Usage

1. Open the Hermes view from the Activity Bar (icon in the left sidebar)
2. The agent will automatically start and connect
3. Type your message and press Enter to send
4. Use the toolbar buttons to:
   - **+** - Start a new session
   - **Sessions** - List and resume previous sessions
   - **Cancel** - Cancel the current turn
   - **Restart** - Restart the Hermes agent

## Keyboard Shortcuts

- `Enter` - Send message
- `Shift+Enter` - New line in message
- `Escape` - Cancel current turn (when active)

## Slash Commands

Hermes supports these slash commands in chat:

| Command | Description |
|---------|-------------|
| `/title [name]` | Set or show session title |
| `/model [name]` | Switch or show current model |
| `/mode [name]` | Switch or show agent mode |
| `/context` | Show current context/session info |
| `/tokens` | Show token usage for session |
| `/clear` | Clear conversation history |
| `/help` | Show available commands |

Use `/title My Project` to name your session - the title persists across sessions.

## Troubleshooting

### "Connection failed" error

1. Make sure Hermes is installed and working: Run `hermes acp --check` in a terminal
2. If first time, configure Hermes: Run `hermes setup` to set up a provider
3. Check the Output panel (View → Output → Hermes) for detailed logs

### Extension not activating

1. Check Extensions view to confirm Hermes is enabled
2. Check Developer Tools (View → Toggle Developer Tools) for any errors
3. Try reloading VS Code

## See Also

- [Hermes Agent Documentation](https://hermes-agent.nousresearch.com/)
- [ACP Protocol Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/acp-internals)
- [Hermes GitHub](https://github.com/NousResearch/hermes-agent)

## License

MIT
