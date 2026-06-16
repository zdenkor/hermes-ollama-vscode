# Ollama Hermes Agent

Chat with [Hermes Agent](https://hermes-agent.nousresearch.com/) directly in VS Code using the ACP protocol, with Ollama as the LLM backend.

## Features

- **Native Integration** - Chat with Hermes in a VS Code side panel
- **Full Agent Capabilities** - Access all Hermes tools, memory, and skills
- **Session Management** - Create new sessions, cancel turns, restart agent
- **Model Selection** - Choose from available models via toolbar icon
- **Streaming Responses** - See agent responses as they are generated
- **Token Usage** - Display token usage for each turn
- **Setup Wizard** - Built-in configuration helper
- **Copilot Chat Participant** - Chat with `@hermes` in GitHub Copilot Chat
- **Language Model Provider** - Use Hermes as a model in Copilot Chat dropdown

## Quick Start

### 1. Install Hermes Agent

Follow the [official installation guide](https://hermes-agent.nousresearch.com/docs/getting-started/installation).

### 2. Install Extension

Download the latest `.vsix` from [Releases](https://github.com/zdenkor/hermes-ollama-vscode/releases) and run:
```bash
code --install-extension hermes-ollama-vscode-x.x.x.vsix
```

### 3. Configure Executable Path

Open VS Code Settings (Ctrl+,) and search for "hermes executable". Set the path to your `hermes.exe` (Windows) or `hermes` binary (macOS/Linux).

**Default Windows:** `C:/Users/{username}/AppData/Local/hermes/hermes-agent/venv/Scripts/hermes.exe`

### 4. Open Hermes Chat

Click the Hermes icon in the Activity Bar (left sidebar) to open the chat panel.

## Setup Wizard

Click the **gear icon** in the Hermes chat toolbar to open the Setup Wizard:

- **Check Connection** - Verify Hermes is running
- **Configure API Server** - Enable model discovery via HTTP API
- **Set Model List** - Manually configure available models
- **Chat Mode** - Switch between Webview Panel and Copilot Chat
- **Use Language Model** - Toggle Hermes in Copilot Chat model dropdown
- **Open Terminal** - Quick access to run Hermes commands
- **Help** - Open official documentation

## Chat Modes

### Webview Panel (Default)
The classic Hermes chat interface in a VS Code side panel with full toolbar and streaming output.

### Copilot Chat Participant
Chat with Hermes directly inside GitHub Copilot Chat by typing `@hermes`.
Enable via `hermes.useCopilotChat` setting (no reload required).

### Language Model Provider
When enabled (`hermes.useLanguageModel`), Hermes appears as a model choice in the Copilot Chat model dropdown alongside GPT-4, Claude, etc.

## Model Selection

### Option A: API Server (Recommended)

For automatic model discovery, enable the Hermes API server:

1. Add to `~/.hermes/.env`:
   ```
   API_SERVER_ENABLED=true
   API_SERVER_KEY=your-secret-key
   ```
2. Start gateway: `hermes gateway`
3. Set `hermes.apiServerKey` in VS Code settings
4. Click the **circuit-board icon** in toolbar to choose models

### Option B: Manual Model List

Set `hermes.modelList` in VS Code settings:
```json
"hermes.modelList": "deepseek-v4-pro:cloud,deepseek-v4-flash:cloud,minimax-m3:cloud"
```

## Configuration

| Setting | Description |
|---------|-------------|
| `hermes.executable` | Path to the Hermes executable |
| `hermes.defaultCwd` | Default working directory for agent sessions |
| `hermes.model` | Model to use for agent sessions (e.g. `deepseek-v4-pro:cloud`) |
| `hermes.modelList` | Comma-separated list of available models |
| `hermes.apiServerUrl` | Hermes API server URL. Default: `http://127.0.0.1:8642` |
| `hermes.apiServerKey` | API server bearer token. Set in **User settings** for security |
| `hermes.useCopilotChat` | Enable `@hermes` participant in Copilot Chat |
| `hermes.useLanguageModel` | Show Hermes in Copilot Chat model dropdown |
| `hermes.logTraffic` | Log ACP protocol traffic to output panel for debugging |

## Commands

| Command | Keybinding | Description |
|---------|-----------|-------------|
| Hermes: Send Prompt | | Focus input box |
| Hermes: New Session | | Start fresh session |
| Hermes: Choose Model | | Select active model |
| Hermes: Sessions | | List and resume sessions |
| Hermes: Cancel Turn | Escape | Stop current generation |
| Hermes: Restart Agent | | Reconnect to agent |
| Hermes: Setup Wizard | | Configuration helper |

## Slash Commands

In the chat input, type:
- `/new` - Start new session
- `/model <name>` - Switch model
- `/modellist` - Show available models
- `/sessions` - List sessions
- `/cancel` - Cancel current turn
- `/title [name]` - Set or show session title
- `/mode [name]` - Switch or show agent mode
- `/context` - Show current context/session info
- `/tokens` - Show token usage for session
- `/clear` - Clear conversation history
- `/help` - Show available commands

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

## Requirements

- VS Code 1.120.0 or later
- [Hermes Agent](https://hermes-agent.nousresearch.com/docs/getting-started/installation) installed
- (Optional) API server enabled for model discovery

## Troubleshooting

### "Not connected to agent"
- Check `hermes.executable` path in settings
- Run Setup Wizard → Check Connection
- Ensure Hermes is installed: `hermes --version`

### "No models found"
- Start API server: `hermes gateway`
- Or set `hermes.modelList` manually
- Check API key is configured

### "Connection failed"
1. Make sure Hermes is installed and working: Run `hermes acp --check` in a terminal
2. If first time, configure Hermes: Run `hermes setup` to set up a provider
3. Check the Output panel (View → Output → Hermes) for detailed logs

### Extension not activating
1. Check Extensions view to confirm Hermes is enabled
2. Check Developer Tools (View → Toggle Developer Tools) for any errors
3. Try reloading VS Code

### Connection errors
- Enable `hermes.logTraffic` to see ACP messages
- Check Hermes Output channel for details

## Links

- [Hermes Documentation](https://hermes-agent.nousresearch.com/docs/)
- [API Server Guide](https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server)
- [Report Issues](https://github.com/zdenkor/hermes-ollama-vscode/issues)

## License

MIT
- [ACP Protocol Internals](https://hermes-agent.nousresearch.com/docs/developer-guide/acp-internals)
- [Hermes GitHub](https://github.com/NousResearch/hermes-agent)

## License

MIT
