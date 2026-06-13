import * as vscode from "vscode";
import { AcpClient } from "./acpClient";

export class HermesChatProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private client?: AcpClient;
  private sessionId?: string;
  private turnInProgress = false;
  private executable: string;
  private outputChannel: vscode.OutputChannel;

  constructor(private context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    this.executable = vscode.workspace
      .getConfiguration("hermes")
      .get<string>("executable") || "hermes";
    this.outputChannel = outputChannel;
  }

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    const html = this.getHtml(webviewView.webview);
    webviewView.webview.html = html;

    // Handle messages from webview
    webviewView.webview.onDidReceiveMessage((msg) => {
      switch (msg.type) {
        case "send": this.handleUserInput(msg.text); break;
        case "cancel": this.commandCancel(); break;
        case "newSession": this.commandNewSession(); break;
      }
    });

    // Auto-connect on first open
    this.ensureAgent();
  }

  commandSend(): void {
    if (this.view) {
      this.view.webview.postMessage({ type: "focusInput" });
    }
  }

  commandCancel(): void {
    if (this.client && this.turnInProgress && this.sessionId) {
      this.client.cancel(this.sessionId);
    }
  }

  async commandNewSession(): Promise<void> {
    if (this.turnInProgress) return;
    this.stopAgent();
    this.updateWebviewMessages([]);
    this.postStatus("Starting new session...");
    await this.ensureAgent();
  }

  commandRestartAgent(): void {
    this.stopAgent();
    this.updateWebviewMessages([]);
    this.ensureAgent();
  }

  async commandSessions(): Promise<void> {
    if (!this.client) {
      this.postError("Not connected to Hermes");
      return;
    }

    try {
      const result = await this.client.listSessions();
      if (result.error) {
        this.postError(`Failed to list sessions: ${result.error.message}`);
        return;
      }
      const data = result.result as any;
      const sessions = data?.sessions || [];
      if (sessions.length === 0) {
        vscode.window.showInformationMessage("No sessions found");
        return;
      }
      const items = sessions.map((s: any) => ({
        label: s.title || "Untitled",
        description: s.sessionId?.slice(0, 8),
        detail: s.cwd,
        sessionId: s.sessionId,
      }));
      const selected = await vscode.window.showQuickPick(items, {
        placeHolder: "Select a session to resume",
      });
      if (selected) {
        await this.commandResumeSession(selected.sessionId);
      }
    } catch (err: any) {
      this.postError(`Failed to list sessions: ${err.message}`);
    }
  }

  async commandResumeSession(sessionId: string): Promise<void> {
    if (this.turnInProgress) return;
    this.stopAgent();
    this.updateWebviewMessages([]);
    this.postStatus(`Resuming session ${sessionId.slice(0, 8)}...`);
    await this.ensureAgent(sessionId);
  }

  private stopAgent(): void {
    if (this.client) {
      this.client.stop();
      this.client.removeAllListeners();
      this.client = undefined;
    }
    this.sessionId = undefined;
    this.turnInProgress = false;
    this.setContext("hermes.turnInProgress", false);
  }

  private async ensureAgent(resumeSessionId?: string): Promise<void> {
    if (this.client?.isRunning() && this.sessionId) return;

    this.stopAgent();

    const cwd = vscode.workspace
      .getConfiguration("hermes")
      .get<string>("defaultCwd") ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();

    this.outputChannel.appendLine(`CWD: ${cwd}`);
    this.outputChannel.appendLine(`Executable: ${this.executable}`);

    this.client = new AcpClient(this.executable);
    this.setupClientHandlers();

    this.postStatus("Starting Hermes...");
    this.outputChannel.appendLine("Starting Hermes agent...");

    this.client.start();
    this.outputChannel.appendLine("Client started, waiting for initialize...");

    try {
      const init = await this.client.initialize();
      this.outputChannel.appendLine(`Initialize response: ${JSON.stringify(init)}`);
      if (init.error) {
        this.postError(`Failed to initialize: ${init.error.message}`);
        return;
      }

      let session;
      let loadedSessionId: string | undefined;
      if (resumeSessionId) {
        // Try to resume a specific session
        loadedSessionId = resumeSessionId;
        session = await this.client.loadSession(resumeSessionId, cwd);
      } else {
        // Try to load the most recent session (auto-resume)
        const sessions = await this.client.listSessions();
        if (sessions.result && (sessions.result as any).sessions?.length > 0) {
          const lastSession = (sessions.result as any).sessions[0];
          loadedSessionId = lastSession.sessionId;
          session = await this.client.loadSession(lastSession.sessionId, cwd);
        } else {
          // No sessions to resume, create new
          session = await this.client.newSession(cwd);
        }
      }
      this.outputChannel.appendLine(`Session response: ${JSON.stringify(session)}`);
      if (session.error) {
        // Fall back to creating new session
        session = await this.client.newSession(cwd);
        if (session.error) {
          this.postError(`Failed to create session: ${session.error.message}`);
          return;
        }
      }
      // Use the loaded session ID if available, otherwise get from result
      this.sessionId = loadedSessionId || (session.result && typeof session.result === "object" ? (session.result as any).sessionId : undefined);

      this.postStatus("");
      this.postMessage("system", `Hermes ready — session ${this.sessionId?.slice(0, 8)}...`);
    } catch (err: any) {
      this.outputChannel.appendLine(`Connection error: ${err.message}`);
      this.postError(`Connection failed: ${err.message}`);
    }
  }

  private setupClientHandlers(): void {
    if (!this.client) return;

    this.client.on("notification", (msg) => {
      if (msg.method === "session/update") {
        this.handleSessionUpdate(msg.params);
      }
    });

    this.client.on("stderr", (text: string) => {
      // Log stderr to output channel for debugging
      this.outputChannel.appendLine("[stderr] " + text);
    });

    this.client.on("error", (err: Error) => {
      this.postError(`Agent error: ${err.message}`);
    });

    this.client.on("exit", (code: number | null) => {
      if (code !== 0 && code !== null) {
        this.postError(`Hermes exited with code ${code}`);
      }
    });
  }

  private handleSessionUpdate(params: Record<string, unknown>): void {
    const update = params.update as Record<string, unknown> | undefined;
    if (!update) return;

    const type = update.sessionUpdate as string;

    switch (type) {
      case "agent_message_chunk": {
        const text = (update.content as any)?.text as string | undefined;
        if (text) {
          this.postMessage("assistant-stream", text);
        }
        break;
      }
      case "tool_call_start": {
        const name = update.toolName as string;
        const input = update.toolInput as Record<string, unknown>;
        this.postMessage("tool-start", { name, input });
        break;
      }
      case "tool_call_progress": {
        const output = update.toolOutput as string;
        this.postMessage("tool-progress", { output });
        break;
      }
      case "tool_call_update": {
        const status = update.toolStatus as string;
        this.postMessage("tool-end", { status });
        break;
      }
      case "usage_update": {
        const used = update.used as number;
        const limit = update.limit as number;
        if (used && limit) {
          this.postMessage("usage", { used, limit });
        }
        break;
      }
      case "session_info_update": {
        const title = update.title as string;
        if (title) {
          this.postMessage("title", { title });
        }
        break;
      }
    }
  }

  private async handleUserInput(text: string): Promise<void> {
    if (!text.trim() || this.turnInProgress) return;

    await this.ensureAgent();
    if (!this.client || !this.sessionId) return;

    this.turnInProgress = true;
    this.setContext("hermes.turnInProgress", true);

    this.postMessage("user", text);
    this.postMessage("thinking-start", {});

    try {
      const response = await this.client.prompt(this.sessionId, text);
      const stopReason = (response.result as any)?.stopReason || "end_turn";
      this.postMessage("thinking-end", {});

      // Log usage if available
      const usage = (response.result as any)?.usage;
      if (usage) {
        this.postMessage("usage", { used: usage.inputTokens, limit: usage.totalTokens });
      }

    } catch (err: any) {
      this.postMessage("thinking-end", {});
      this.postError(`Prompt failed: ${err.message}`);
    } finally {
      this.turnInProgress = false;
      this.setContext("hermes.turnInProgress", false);
    }
  }

  // ---- Webview communication ----

  private postStatus(text: string): void {
    this.view?.webview.postMessage({ type: "status", text });
  }

  private postMessage(kind: string, content: unknown): void {
    this.view?.webview.postMessage({ type: "message", kind, content });
  }

  private updateWebviewMessages(messages: unknown[]): void {
    this.view?.webview.postMessage({ type: "reset", messages });
  }

  private postError(text: string): void {
    this.view?.webview.postMessage({ type: "error", text });
  }

  private setContext(key: string, value: boolean): void {
    vscode.commands.executeCommand("setContext", key, value);
  }

  // ---- Webview HTML ----

  private getHtml(webview: vscode.Webview): string {
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, "media", "style.css"),
    );
    // Inline styles since we can't guarantee the CSS file is loaded at dev time
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: var(--vscode-editor-background, #1e1e1e);
    --fg: var(--vscode-editor-foreground, #d4d4d4);
    --accent: var(--vscode-focusBorder, #007acc);
    --border: var(--vscode-panel-border, #3c3c3c);
    --input-bg: var(--vscode-input-background, #3c3c3c);
    --error: #f44747;
    --tool-bg: color-mix(in srgb, var(--accent) 10%, var(--bg));
    --user-bg: color-mix(in srgb, var(--accent) 20%, var(--bg));
  }

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: var(--vscode-font-family, monospace);
    font-size: var(--vscode-font-size, 13px);
    background: var(--bg);
    color: var(--fg);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }

  #messages {
    flex: 1;
    overflow-y: auto;
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .msg {
    padding: 6px 10px;
    border-radius: 4px;
    line-height: 1.5;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .msg.user {
    background: var(--user-bg);
    align-self: flex-end;
    max-width: 85%;
  }

  .msg.assistant-stream {
    align-self: flex-start;
    max-width: 90%;
    padding-left: 0;
  }

  .msg.tool-start {
    background: var(--tool-bg);
    color: var(--accent);
    font-size: 0.9em;
    padding: 3px 10px;
    border-left: 3px solid var(--accent);
    align-self: flex-start;
    max-width: 90%;
  }

  .msg.tool-end {
    background: var(--tool-bg);
    font-size: 0.85em;
    padding: 2px 10px;
    color: color-mix(in srgb, var(--fg) 60%, transparent);
    align-self: flex-start;
  }

  .msg.error {
    color: var(--error);
    background: color-mix(in srgb, var(--error) 10%, var(--bg));
    align-self: flex-start;
  }

  .msg.system {
    font-size: 0.85em;
    color: color-mix(in srgb, var(--fg) 50%, transparent);
    text-align: center;
  }

  .msg.usage {
    font-size: 0.75em;
    color: color-mix(in srgb, var(--fg) 40%, transparent);
    text-align: right;
  }

  .thinking {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    font-size: 0.85em;
    color: color-mix(in srgb, var(--fg) 50%, transparent);
  }

  .thinking .dot {
    width: 6px; height: 6px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse 0.8s ease-in-out infinite;
  }
  .thinking .dot:nth-child(2) { animation-delay: 0.2s; }
  .thinking .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; }
    50% { opacity: 1; }
  }

  #status {
    padding: 2px 12px;
    font-size: 0.8em;
    color: color-mix(in srgb, var(--fg) 40%, transparent);
    min-height: 18px;
  }

  #input-area {
    display: flex;
    border-top: 1px solid var(--border);
    padding: 6px 8px;
    gap: 6px;
    resize: vertical;
    overflow: auto;
    min-height: 60px;
    max-height: 300px;
  }

  #input {
    flex: 1;
    background: transparent;
    border: none;
    color: var(--fg);
    padding: 6px 10px;
    border-radius: 4px;
    font-family: inherit;
    font-size: inherit;
    resize: none;
    min-height: 28px;
    height: 100%;
    outline: none;
  }

  #input:focus {
    border-color: var(--accent);
  }

  #input:disabled {
    opacity: 0.5;
  }

  #send-btn {
    background: #404040;
    border: none;
    width: 36px;
    height: 36px;
    border-radius: 50%;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    align-self: flex-end;
    transition: background 0.2s;
  }

  #send-btn.active {
    background: var(--accent);
  }

  #send-btn.active svg {
    fill: white;
  }

  #send-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }

  #send-btn svg {
    width: 18px;
    height: 18px;
    fill: #404040;
    transition: fill 0.2s;
  }

  #cancel-btn {
    background: var(--error);
    color: white;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    cursor: pointer;
    font-family: inherit;
    font-size: inherit;
    display: none;
  }
</style>
</head>
<body>
  <div id="messages"></div>
  <div id="status"></div>
  <div id="input-area">
    <textarea id="input" rows="1" placeholder="Ask Hermes..."></textarea>
    <button id="send-btn" title="Send">
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
        <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
      </svg>
    </button>
    <button id="cancel-btn">Cancel</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('status');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let thinking = false;
    let currentStreamEl = null;
    let commandHistory = [];
    let historyIndex = -1;
    let savedInput = '';

    function scrollBottom() {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    }

    function addMessage(kind, content) {
      const el = document.createElement('div');
      el.className = 'msg ' + kind;
      if (typeof content === 'string') {
        el.textContent = content;
      } else if (content && content.name) {
        el.textContent = '\\uD83D\\uDD27 ' + content.name;
      } else if (content && content.output) {
        el.textContent = content.output;
      } else if (content && content.status) {
        el.textContent = '\\u2713 ' + content.status;
      } else if (content && content.title) {
        // title update - don't add a message
        return;
      } else if (content && content.used) {
        el.textContent = 'Tokens: ' + content.used + ' / ' + content.limit;
      }
      messagesEl.appendChild(el);
      scrollBottom();
      return el;
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function setThinking(active) {
      thinking = active;
      inputEl.disabled = active;
      sendBtn.disabled = active;
      cancelBtn.style.display = active ? 'block' : 'none';

      if (active) {
        const el = document.createElement('div');
        el.className = 'thinking';
        el.id = 'thinking-indicator';
        el.innerHTML = '<span>Hermes is thinking</span><span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        messagesEl.appendChild(el);
        scrollBottom();
      } else {
        const el = document.getElementById('thinking-indicator');
        if (el) el.remove();
      }
    }

    function send() {
      const text = inputEl.value.trim();
      if (!text || thinking) return;
      if (text) {
        commandHistory.push(text);
        historyIndex = commandHistory.length;
      }
      inputEl.value = '';
      savedInput = '';
      sendBtn.classList.remove('active');
      vscode.postMessage({ type: 'send', text });
    }

    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      } else if (e.key === 'ArrowUp') {
        if (historyIndex > 0) {
          if (historyIndex === commandHistory.length) {
            savedInput = inputEl.value;
          }
          historyIndex--;
          inputEl.value = commandHistory[historyIndex];
          inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
        }
        e.preventDefault();
      } else if (e.key === 'ArrowDown') {
        if (historyIndex < commandHistory.length - 1) {
          historyIndex++;
          inputEl.value = commandHistory[historyIndex];
          inputEl.selectionStart = inputEl.selectionEnd = inputEl.value.length;
        } else if (historyIndex === commandHistory.length - 1 && savedInput) {
          historyIndex = commandHistory.length;
          inputEl.value = savedInput;
          savedInput = '';
        }
        e.preventDefault();
      }
    });

    // Auto-resize textarea based on content
    inputEl.addEventListener('input', () => {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
      sendBtn.classList.toggle('active', inputEl.value.trim().length > 0);
    });

    sendBtn.addEventListener('click', send);
    cancelBtn.addEventListener('click', () => {
      vscode.postMessage({ type: 'cancel' });
    });

    window.addEventListener('message', (e) => {
      const msg = e.data;
      switch (msg.type) {
        case 'status':
          setStatus(msg.text);
          break;
        case 'message':
          // Handle stream concatenation
          if (msg.kind === 'assistant-stream') {
            if (!currentStreamEl) {
              currentStreamEl = addMessage('assistant-stream', '');
            }
            currentStreamEl.textContent += msg.content;
            scrollBottom();
          } else if (msg.kind === 'thinking-start') {
            setThinking(true);
            currentStreamEl = null;
          } else if (msg.kind === 'thinking-end') {
            setThinking(false);
            currentStreamEl = null;
          } else {
            currentStreamEl = null;
            addMessage(msg.kind, msg.content);
          }
          break;
        case 'error':
          addMessage('error', msg.text);
          break;
        case 'focusInput':
          inputEl.focus();
          break;
        case 'reset':
          messagesEl.innerHTML = '';
          if (Array.isArray(msg.messages)) {
            msg.messages.forEach(m => addMessage(m.kind, m.content));
          }
          currentStreamEl = null;
          break;
      }
    });

    inputEl.focus();
  </script>
</body>
</html>`;
  }
}
