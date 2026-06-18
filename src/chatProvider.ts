import * as vscode from "vscode";
import { AcpClient, AcpNotification } from "./acpClient";
import { resolveHermesExecutable } from "./utils";

export class HermesChatProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  private client?: AcpClient;
  private sessionId?: string;
  private turnInProgress = false;
  private executable: string;
  // sessionId -> model name. Populated every time we successfully call
  // setSessionModel() so the sessions list quickpick can show which
  // model each session used. Persisted in globalState across restarts.
  private sessionModels: Record<string, string> = {};
  // Log level. Read at log() call time, not at construction, so the
  // setting can be changed without restarting the extension.
  private logLevel: "silent" | "minimal" | "standard" | "debug" = "standard";
  private outputChannel: vscode.OutputChannel;

  constructor(private context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
    const configured = vscode.workspace
      .getConfiguration("hermes")
      .get<string>("executable") || "hermes";
    this.executable = resolveHermesExecutable(configured);
    this.outputChannel = outputChannel;
    this.sessionModels = this.loadSessionModels();
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
        case "saveHistory": {
          const history = this.loadCommandHistory();
          if (!history.includes(msg.text)) {
            history.push(msg.text);
            this.saveCommandHistory(history);
          }
          break;
        }
        case "loadHistory":
          webviewView.webview.postMessage({ type: "history", history: this.loadCommandHistory() });
          break;
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
      this.turnInProgress = false;
      this.setContext("hermes.turnInProgress", false);
      this.postMessage("thinking-end", {});
    }
  }

  async commandNewSession(forceNew = true): Promise<void> {
    if (this.turnInProgress) return;
    this.stopAgent();
    this.updateWebviewMessages([]);
    this.postStatus("Starting new session...");
    await this.ensureAgent(undefined, forceNew);
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
      const items: (vscode.QuickPickItem & { sessionId: string })[] = sessions.map((s: any) => {
        const model = this.sessionModels[s.sessionId];
        const modelLabel = model ? `$(circuit-board) ${model}` : "$(circuit-board) (model unknown)";
        return {
          label: s.title || "Untitled",
          description: s.sessionId?.slice(0, 8),
          detail: model
            ? `${s.cwd}  —  ${modelLabel}`
            : `${s.cwd}  —  ${modelLabel}  (set from this client to record model)`,
          sessionId: s.sessionId,
        };
      });
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

  async commandChooseModel(): Promise<void> {
    // Ensure the agent is running so the user can pick a model even
    // before sending the first prompt. (Previously this bailed with
    // "Not connected to agent" if no session was active yet.)
    if (!this.client || !this.sessionId) {
      await this.ensureAgent(undefined, true);
      if (!this.client || !this.sessionId) {
        this.postError("Could not start Hermes to pick a model. Check the executable path in Settings.");
        return;
      }
    }

    this.postStatus("Fetching available models...");

    try {
      let models: { label: string; description: string; picked?: boolean }[] = [];
      
      // Try the Hermes API server /v1/models first (cloud models via ollama-launch).
      // Falls back to local Ollama /api/tags, then to hermes.modelList setting.
      const apiUrl = vscode.workspace.getConfiguration("hermes").get<string>("apiServerUrl", "");
      const apiKey = vscode.workspace.getConfiguration("hermes").get<string>("apiServerKey", "");
      if (apiUrl) {
        try {
          const headers: Record<string, string> = {};
          if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;
          const apiResp = await fetch(`${apiUrl.replace(/\/$/, "")}/v1/models`, { headers });
          if (apiResp.ok) {
            const apiData = await apiResp.json() as any;
            this.log("standard", `[ModelList] API server response: ${this.dumpJson(apiData)}`);
            const list = apiData?.data || apiData?.models || [];
            if (Array.isArray(list)) {
              for (const m of list) {
                const id = m.id || m.name || "";
                if (id) models.push({ label: id, description: "api server" });
              }
            }
          }
        } catch (apiErr: any) {
          this.log("minimal", `[ModelList] API server error: ${apiErr.message}`);
        }
      }

      // Try Ollama API (local models)
      try {
        const ollamaResponse = await fetch("http://127.0.0.1:11434/api/tags");
        if (ollamaResponse.ok) {
          const ollamaData = await ollamaResponse.json() as any;
          this.log("standard", `[ModelList] Ollama response: ${this.dumpJson(ollamaData)}`);
          
          if (ollamaData.models && Array.isArray(ollamaData.models)) {
            for (const model of ollamaData.models) {
              const name = model.name || model.model || "";
              if (name) {
                models.push({
                  label: name,
                  description: model.details?.parameter_size || "",
                });
              }
            }
          }
        }
      } catch (ollamaErr: any) {
        this.log("minimal", `[ModelList] Ollama error: ${ollamaErr.message}`);
      }
      
      // Fallback to hermes.modelList setting
      if (models.length === 0) {
        const modelList = vscode.workspace.getConfiguration("hermes").get<string>("modelList", "");
        const fallbackModels = modelList.split(",").map(m => m.trim()).filter(m => m);
        models = fallbackModels.map(m => ({ label: m, description: "" }));
      }
      
      if (models.length === 0) {
        this.postError("No models found. Start Ollama or configure hermes.modelList.");
        return;
      }
      
      const selected = await vscode.window.showQuickPick(models, {
        placeHolder: "Select a model",
      });
      
      if (selected) {
        const pick = selected.label;
        await vscode.workspace
          .getConfiguration("hermes")
          .update("model", pick, vscode.ConfigurationTarget.Global);
        this.postMessage("system", `Model set to ${pick}. Starting new session to apply...`);
        await this.commandNewSession(true);
      }
    } catch (e: any) {
      this.postError(`Failed: ${e.message}`);
    }
  }

  async commandSetupWizard(): Promise<void> {
    const currentCopilotChat = vscode.workspace.getConfiguration("hermes").get<boolean>("useCopilotChat", false);
    const items: vscode.QuickPickItem[] = [
      {
        label: "$(check) Check Connection",
        description: "Test if Hermes agent is running",
        detail: "Verifies the executable path and tries to connect",
      },
      {
        label: currentCopilotChat ? "$(comment-discussion) Use Webview Panel" : "$(comment-discussion) Use Copilot Chat",
        description: currentCopilotChat ? "Switch to side-panel chat" : "Switch to @hermes in Copilot Chat",
        detail: currentCopilotChat ? "Current: Copilot Chat participant" : "Current: Webview panel",
      },
      {
        label: "$(gear) Configure API Server",
        description: "Set up API server for model discovery",
        detail: "Enable API_SERVER_ENABLED in ~/.hermes/.env",
      },
      {
        label: "$(list-flat) Set Model List",
        description: "Configure available models manually",
        detail: "Edit hermes.modelList setting",
      },
      {
        label: "$(output) Set Log Level",
        description: "Control verbosity of the Hermes output channel",
        detail: `Current: ${vscode.workspace.getConfiguration("hermes").get<string>("logLevel", "standard")}`,
      },
      {
        label: "$(shield) Edit Approval Policy",
        description: "How the agent handles file edits",
        detail: `Current: ${vscode.workspace.getConfiguration("hermes").get<string>("editApprovalPolicy", "accept_edits")}`,
      },
      {
        label: "$(circuit-board) Change Active Model",
        description: "Pick which model Hermes uses right now",
        detail: "Choose from API server, Ollama, or your model list",
      },
      {
        label: "$(terminal) Open Hermes Terminal",
        description: "Open integrated terminal to run Hermes commands",
        detail: "Useful for starting gateway or checking status",
      },
      {
        label: "$(question) Help / Documentation",
        description: "Open Hermes documentation",
        detail: "https://hermes-agent.nousresearch.com/docs/",
      },
    ];
    
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: "Hermes Setup Wizard - Select an action",
      title: "Hermes Setup Wizard",
    });
    
    if (!selected) return;
    
    switch (selected.label) {
      case "$(check) Check Connection":
        await this.checkConnection();
        break;
      case "$(comment-discussion) Use Webview Panel":
      case "$(comment-discussion) Use Copilot Chat":
        await this.toggleCopilotChat(!currentCopilotChat);
        break;
      case "$(gear) Configure API Server":
        await this.configureApiServer();
        break;
      case "$(list-flat) Set Model List":
        await this.configureModelList();
        break;
      case "$(output) Set Log Level":
        await this.configureLogLevel();
        break;
      case "$(shield) Edit Approval Policy":
        await this.configureEditApproval();
        break;
      case "$(circuit-board) Change Active Model":
        await this.commandChooseModel();
        break;
      case "$(terminal) Open Hermes Terminal":
        vscode.commands.executeCommand("workbench.action.terminal.new");
        break;
      case "$(question) Help / Documentation":
        vscode.env.openExternal(vscode.Uri.parse("https://hermes-agent.nousresearch.com/docs/"));
        break;
    }
  }

  private async checkConnection(): Promise<void> {
    this.postStatus("Checking connection...");
    try {
      await this.ensureAgent();
      if (this.client?.isRunning()) {
        vscode.window.showInformationMessage("Hermes is connected and running!");
      } else {
        vscode.window.showWarningMessage("Hermes is not running. Check the executable path in settings.");
      }
    } catch (e: any) {
      vscode.window.showErrorMessage(`Connection failed: ${e.message}`);
    }
  }

  private async configureApiServer(): Promise<void> {
    const action = await vscode.window.showQuickPick([
      { label: "Start API Server", description: "Run: hermes gateway" },
      { label: "Configure .env", description: "Add API_SERVER_ENABLED=true" },
      { label: "Set API Key", description: "Configure hermes.apiServerKey" },
    ], { placeHolder: "API Server Configuration" });
    
    if (!action) return;
    
    if (action.label === "Start API Server") {
      const terminal = vscode.window.createTerminal("Hermes Gateway");
      terminal.sendText("hermes gateway");
      terminal.show();
      vscode.window.showInformationMessage("API server starting on http://127.0.0.1:8642");
    } else if (action.label === "Configure .env") {
      const homeDir = process.env.USERPROFILE || process.env.HOME || "";
      const envPath = vscode.Uri.file(`${homeDir}/.hermes/.env`);
      try {
        await vscode.workspace.fs.stat(envPath);
        vscode.window.showTextDocument(envPath);
      } catch {
        vscode.window.showWarningMessage("~/.hermes/.env not found. Run 'hermes setup' first.");
      }
    } else if (action.label === "Set API Key") {
      const key = await vscode.window.showInputBox({
        prompt: "Enter your API server key",
        password: true,
      });
      if (key) {
        await vscode.workspace.getConfiguration("hermes").update("apiServerKey", key, true);
        vscode.window.showInformationMessage("API key saved to User settings");
      }
    }
  }

  private async configureModelList(): Promise<void> {
    const current = vscode.workspace.getConfiguration("hermes").get<string>("modelList", "");
    const models = await vscode.window.showInputBox({
      prompt: "Enter comma-separated model list",
      value: current,
      placeHolder: "deepseek-v4-pro:cloud,llama3.2:latest,qwen2.5:latest",
    });
    if (models !== undefined) {
      await vscode.workspace.getConfiguration("hermes").update("modelList", models, true);
      vscode.window.showInformationMessage("Model list updated");
    }
  }

  private async configureLogLevel(): Promise<void> {
    const current = this.getLogLevel();
    const levels: Array<{
      id: "silent" | "minimal" | "standard" | "debug";
      label: string;
      description: string;
    }> = [
      { id: "silent",   label: "Silent",   description: "No log output at all." },
      { id: "minimal",  label: "Minimal",  description: "Errors and connection lifecycle events only." },
      { id: "standard", label: "Standard", description: "Session events, model changes, stderr. (Default)" },
      { id: "debug",    label: "Debug",    description: "Full JSON-RPC traffic, every stream chunk, all internals." },
    ];
    const items = levels.map((l) => ({
      label: l.label + (l.id === current ? "  $(check)" : ""),
      description: l.description,
      id: l.id,
    }));
    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Current log level: ${current}`,
    });
    if (selected) {
      await vscode.workspace.getConfiguration("hermes").update("logLevel", selected.id, true);
      vscode.window.showInformationMessage(`Log level set to: ${selected.id}`);
      // Emit a one-liner at the new level so the user sees the change took effect.
      this.log("minimal", `Log level changed to: ${selected.id}`);
    }
  }

  /**
   * Setup Wizard → Edit Approval Policy.
   *
   * Controls how the agent handles file-edit approval requests. With
   * `accept_edits` (default) the extension sets the session's
   * edit_approval_policy to `workspace_session` so workspace and /tmp
   * edits are auto-approved (with sensitive paths still requiring
   * approval). `dont_ask` is more aggressive. `ask` causes the agent
   * to wait for a prompt that the vscode acp.agents integration does
   * not render — leads to a 60s timeout. Empty / off skips the call
   * and falls back to hermes's default.
   *
   * The change only takes effect on the NEXT new session — it is sent
   * via session/set_config_option after newSession in ensureAgent().
   */
  private async configureEditApproval(): Promise<void> {
    const current = vscode.workspace
      .getConfiguration("hermes")
      .get<string>("editApprovalPolicy", "accept_edits");

    const policies: Array<{
      id: "accept_edits" | "dont_ask" | "ask" | "";
      label: string;
      description: string;
    }> = [
      {
        id: "accept_edits",
        label: "accept_edits (default)",
        description:
          "Auto-allow workspace and /tmp edits. Sensitive paths still ask.",
      },
      {
        id: "dont_ask",
        label: "dont_ask",
        description:
          "Auto-allow every edit for this session except sensitive paths.",
      },
      {
        id: "ask",
        label: "ask (strict)",
        description:
          "Prompt before every edit. NOTE: vscode acp.agents doesn't render the prompt, so the agent will time out after 60s. Only use if you understand this.",
      },
      {
        id: "",
        label: "off (use hermes default)",
        description: "Don't send session/set_config_option; let hermes pick its own policy.",
      },
    ];

    const items = policies.map((p) => ({
      label: p.label + (p.id === current ? "  $(check)" : ""),
      description: p.description,
      id: p.id,
    }));

    const selected = await vscode.window.showQuickPick(items, {
      placeHolder: `Current: ${current || "off (hermes default)"}`,
    });
    if (selected) {
      await vscode.workspace
        .getConfiguration("hermes")
        .update("editApprovalPolicy", selected.id, true);

      // If a session is currently running, push the new policy to it
      // immediately. This preserves the session's conversation history,
      // skills, and learned context — unlike starting a new session.
      // If the RPC fails (e.g. the session is mid-prompt), the policy
      // will still be applied to the next new session.
      const hasLiveSession =
        this.client?.isRunning() && this.sessionId !== undefined;
      if (hasLiveSession && selected.id !== "") {
        const valueMap: Record<string, string> = {
          accept_edits: "workspace_session",
          dont_ask: "session",
          ask: "ask",
        };
        const policyValue = valueMap[selected.id];
        if (policyValue) {
          try {
            const setResult = await this.client!.setSessionConfigOption(
              this.sessionId!,
              "edit_approval_policy",
              policyValue
            );
            if (setResult.error) {
              vscode.window.showWarningMessage(
                `Policy set to ${selected.id} (setting only). Could not apply to current session: ${setResult.error.message}. Will apply on the next new session.`
              );
              this.log("minimal", `Failed to apply policy to current session: ${setResult.error.message}`);
            } else {
              vscode.window.showInformationMessage(
                `Edit approval policy: ${selected.id}. Applied to current session.`
              );
              this.log("standard", `Edit approval policy applied to current session: ${policyValue}`);
            }
          } catch (err: any) {
            vscode.window.showWarningMessage(
              `Policy set to ${selected.id} (setting only). Could not apply to current session: ${err.message}. Will apply on the next new session.`
            );
            this.log("minimal", `Error applying policy to current session: ${err.message}`);
          }
        } else {
          vscode.window.showInformationMessage(
            `Edit approval policy set to: ${selected.id}. No live session to apply to.`
          );
        }
      } else {
        const reason = !hasLiveSession
          ? "No active session"
          : "Off mode (heres default applies)";
        vscode.window.showInformationMessage(
          `Edit approval policy set to: ${selected.id || "off"}. ${reason} — takes effect on the next new session.`
        );
      }
    }
  }

  private async toggleCopilotChat(enable: boolean): Promise<void> {
    await vscode.workspace.getConfiguration("hermes").update("useCopilotChat", enable, true);
    const mode = enable ? "Copilot Chat (@hermes)" : "Webview Panel";
    vscode.window.showInformationMessage(`Switched to ${mode}.`);
  }

  private async toggleLanguageModel(enable: boolean): Promise<void> {
    await vscode.workspace.getConfiguration("hermes").update("useLanguageModel", enable, true);
    const mode = enable ? "Language Model (Copilot Chat dropdown)" : "Webview Panel";
    vscode.window.showInformationMessage(`Switched to ${mode}.`);
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

  private loadCommandHistory(): string[] {
    return this.context.globalState.get<string[]>("commandHistory", []);
  }

  private saveCommandHistory(history: string[]): void {
    this.context.globalState.update("commandHistory", history);
  }

  private loadSessionModels(): Record<string, string> {
    return this.context.globalState.get<Record<string, string>>("sessionModels", {});
  }

  private saveSessionModels(): void {
    // Prune entries older than 200 to keep the blob small. Sessions we
    // remember today are mostly the recent ones anyway.
    const entries = Object.entries(this.sessionModels);
    if (entries.length > 200) {
      this.sessionModels = Object.fromEntries(entries.slice(-200));
    }
    this.context.globalState.update("sessionModels", this.sessionModels);
  }

  /**
   * Resolved log level from the `hermes.logLevel` setting. Reads the
   * setting every call so the user can change it live without restarting
   * the extension.
   */
  private getLogLevel(): "silent" | "minimal" | "standard" | "debug" {
    const raw = vscode.workspace.getConfiguration("hermes").get<string>("logLevel", "standard");
    if (raw === "silent" || raw === "minimal" || raw === "standard" || raw === "debug") {
      return raw;
    }
    return "standard";
  }

  /**
   * Log a message to the Hermes output channel at the given level.
   * Levels (ascending verbosity):
   *   silent   - nothing
   *   minimal  - errors, connection lifecycle, session start/stop
   *   standard - + session creation, model/policy set, model-list events (DEFAULT)
   *   debug    - + every JSON-RPC send/receive, every stream chunk, all acp client internals
   *
   * Always logs errors regardless of level (minimal+).
   */
  private log(level: "minimal" | "standard" | "debug", message: string): void {
    const current = this.getLogLevel();
    if (current === "silent") return;
    const order = { minimal: 0, standard: 1, debug: 2 } as const;
    if (order[level] > order[current]) return;
    this.outputChannel.appendLine(`[${level}] ${message}`);
  }

  /**
   * Compact JSON dump for log lines. At standard level, truncates to
   * 500 chars so the output channel stays readable. At debug, dumps
   * the full payload.
   */
  private dumpJson(value: unknown, maxChars = 500): string {
    const level = this.getLogLevel();
    const json = JSON.stringify(value);
    if (level === "debug") return json;
    if (json.length <= maxChars) return json;
    return json.slice(0, maxChars) + ` ... [truncated ${json.length - maxChars} chars; set hermes.logLevel=debug for full output]`;
  }

  private async ensureAgent(resumeSessionId?: string, forceNewSession = false): Promise<void> {
    if (this.client?.isRunning() && this.sessionId) return;

    this.stopAgent();

    const cwd = vscode.workspace
      .getConfiguration("hermes")
      .get<string>("defaultCwd") ||
      vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
      process.cwd();

    this.log("minimal", `CWD: ${cwd}`);
    this.log("minimal", `Executable: ${this.executable}`);

    this.client = new AcpClient(this.executable);
    this.setupClientHandlers();

    this.postStatus("Starting Hermes...");
    this.log("minimal", "Starting Hermes agent...");

    this.client.start();
    this.log("debug", "Client started, waiting for initialize...");

    try {
      const init = await this.client.initialize();
      this.log("standard", `Initialize response: ${this.dumpJson(init)}`);
      if (init.error) {
        this.postError(`Failed to initialize: ${init.error.message}`);
        return;
      }

      let session;
      let loadedSessionId: string | undefined;
      if (forceNewSession) {
        // Force a fresh session (e.g. after a model change). Skip auto-resume.
        const model = vscode.workspace.getConfiguration("hermes").get<string>("model") || undefined;
        this.log("standard", `Force new session with model: ${model || "(default)"}`);
        session = await this.client.newSession(cwd, model);
      } else if (resumeSessionId) {
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
          const model = vscode.workspace.getConfiguration("hermes").get<string>("model") || undefined; session = await this.client.newSession(cwd, model);
        }
      }
      this.log("standard", `Session response: ${this.dumpJson(session)}`);
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

      // Flip the edit-approval policy to "workspace_session" so the agent
      // can auto-approve workspace and /tmp edits. Without this, the agent
      // tries to call conn.request_permission and times out after 60s
      // because vscode's acp.autoApprovePermissions does not cover the
      // edit-approval flow in the acp.agents integration.
      //
      // User-overridable via hermes.editApprovalPolicy:
      //   - "accept_edits"  → "workspace_session" (auto-allow workspace + /tmp, asks for sensitive)
      //   - "dont_ask"      → "session" (auto-allow all for this session, except sensitive)
      //   - "ask"           → "ask" (default, agent will prompt and likely time out)
      //   - "" or "off"     → skip this call entirely (use hermes default)
      const policySetting = vscode.workspace.getConfiguration("hermes").get<string>("editApprovalPolicy", "accept_edits");
      const policyValueMap: Record<string, string> = {
        accept_edits: "workspace_session",
        dont_ask: "session",
        ask: "ask",
      };
      const policyValue = policyValueMap[policySetting];
      if (this.sessionId && policyValue) {
        try {
          const setResult = await this.client.setSessionConfigOption(
            this.sessionId,
            "edit_approval_policy",
            policyValue
          );
          this.log("standard", `Edit approval policy set: ${policyValue} (${this.dumpJson(setResult)})`);
        } catch (err: any) {
          // Non-fatal: log but don't fail the session
          this.log("minimal", `Failed to set edit approval policy: ${err.message}`);
        }
      }

      // Apply the configured model. Per ACP, model selection is a separate
      // call after the session is created. The session/new request has no
      // model field, so without this call the session uses hermes's
      // default model regardless of what `hermes.model` is set to.
      const configuredModel = vscode.workspace.getConfiguration("hermes").get<string>("model", "");
      if (this.sessionId && configuredModel) {
        try {
          const modelResult = await this.client.setSessionModel(this.sessionId, configuredModel);
          this.log("standard", `Model set: ${configuredModel} (${this.dumpJson(modelResult)})`);
          // Record the model for this session so the sessions-list
          // quickpick can show it. Persisted in globalState.
          this.sessionModels[this.sessionId] = configuredModel;
          this.saveSessionModels();
        } catch (err: any) {
          // Non-fatal: log but don't fail the session
          this.log("minimal", `Failed to set model: ${err.message}`);
        }
      }

      this.postStatus("");
      this.postMessage("system", `Hermes ready -- session ${this.sessionId?.slice(0, 8)}...`);
    } catch (err: any) {
      this.log("minimal", `Connection error: ${err.message}`);
      this.postError(`Connection failed: ${err.message}`);
    }
  }

  private setupClientHandlers(): void {
    if (!this.client) return;

    this.client.on("notification", (msg: AcpNotification) => {
      if (msg.method === "session/update") {
        this.handleSessionUpdate(msg.params);
      }
    });

    // AcpClient emits structured log events. We forward them to our
    // level-aware log() so they show up in the output channel and
    // respect the hermes.logLevel setting.
    this.client.on("log", (entry: { level: "minimal" | "standard" | "debug"; message: string }) => {
      this.log(entry.level, "[AcpClient] " + entry.message);
    });

    this.client.on("stderr", (text: string) => {
      // Log stderr to output channel for debugging. stderr is the
      // agent's own logger output; we treat it as standard-level so
      // it shows up by default but can be silenced via silent logLevel.
      this.log("standard", "[stderr] " + text.trimEnd());
    });

    this.client.on("error", (err: Error) => {
      this.log("minimal", `Agent error: ${err.message}`);
      this.postError(`Agent error: ${err.message}`);
    });

    this.client.on("exit", (code: number | null) => {
      if (code !== 0 && code !== null) {
        this.log("minimal", `Hermes exited with code ${code}`);
        this.postError(`Hermes exited with code ${code}`);
      } else {
        this.log("debug", `Hermes exited with code ${code}`);
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
      case "agent_thought_chunk": {
        // Stream the model's chain-of-thought / reasoning text into the
        // webview. Per the ACP spec, the content shape is the same as
        // agent_message_chunk (a ContentBlock with .text), so we can
        // reuse the same field.
        const text = (update.content as any)?.text as string | undefined;
        if (text) {
          this.postMessage("thought-stream", text);
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

  /* Reasoning / chain-of-thought block. A collapsible <details> element
     with the model's internal reasoning inside. Visually distinct from
     the assistant's final answer (dimmed, monospaced, indented). */
  .msg.thought {
    align-self: stretch;
    margin: 4px 0;
    padding: 0;
    background: transparent;
  }
  .msg.thought .thought-details {
    background: color-mix(in srgb, var(--accent) 4%, var(--bg));
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    border-radius: 6px;
    padding: 6px 10px;
  }
  .msg.thought .thought-details > summary {
    cursor: pointer;
    font-size: 0.85em;
    color: color-mix(in srgb, var(--fg) 70%, transparent);
    user-select: none;
    list-style: none;
    /* Show a triangle marker only when collapsed so the block is more
       compact when open. Native marker is shown via the default styling
       on <details> elements. */
  }
  .msg.thought .thought-details > summary::marker,
  .msg.thought .thought-details > summary::-webkit-details-marker {
    color: var(--accent);
  }
  .msg.thought .thought-body {
    margin: 8px 0 2px 0;
    padding: 6px 8px;
    background: color-mix(in srgb, var(--bg) 70%, transparent);
    border-left: 2px solid var(--accent);
    border-radius: 0 4px 4px 0;
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 0.85em;
    line-height: 1.45;
    color: color-mix(in srgb, var(--fg) 85%, transparent);
    white-space: pre-wrap;
    /* Cap height so very long reasoning scrolls inside the block
       instead of pushing the whole transcript off-screen. */
    max-height: 320px;
    overflow-y: auto;
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
    padding: 8px 12px;
    font-size: 0.9em;
    background: color-mix(in srgb, var(--bg-elev) 60%, transparent);
    border: 1px solid var(--accent);
    border-radius: 8px;
    color: var(--fg);
    position: sticky;
    bottom: 0;
    z-index: 10;
  }

  /* CSS-painted icon -- no emoji font dependency, renders identically
     on every system. .icon-thinking is a pulsing dot, .icon-tools is a
     spinning gear built from CSS borders. */
  .thinking-icon {
    width: 14px;
    height: 14px;
    flex: 0 0 14px;
    display: inline-block;
  }
  .thinking-icon.icon-thinking {
    background: var(--accent);
    border-radius: 50%;
    box-shadow: 0 0 0 0 var(--accent);
    animation: think-pulse 1.2s ease-out infinite;
  }
  .thinking-icon.icon-tools {
    width: 14px;
    height: 14px;
    border: 2px solid var(--accent);
    border-top-color: transparent;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    background: transparent;
  }
  @keyframes think-pulse {
    0%   { box-shadow: 0 0 0 0   color-mix(in srgb, var(--accent) 60%, transparent); }
    70%  { box-shadow: 0 0 0 8px color-mix(in srgb, var(--accent) 0%,  transparent); }
    100% { box-shadow: 0 0 0 0   color-mix(in srgb, var(--accent) 0%,  transparent); }
  }
  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .thinking-label {
    color: var(--fg);
    opacity: 0.85;
  }

  .thinking .dot {
    width: 8px; height: 8px;
    background: var(--accent);
    border-radius: 50%;
    animation: pulse 0.8s ease-in-out infinite;
  }
  .thinking .dot:nth-child(2) { animation-delay: 0.2s; }
  .thinking .dot:nth-child(3) { animation-delay: 0.4s; }

  @keyframes pulse {
    0%, 100% { opacity: 0.3; transform: scale(0.8); }
    50% { opacity: 1; transform: scale(1.2); }
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
    width: 24px;
    height: 24px;
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

  #send-btn svg {
    width: 14px;
    height: 14px;
    color: #808080;
    transition: color 0.2s;
  }

  #send-btn.active svg {
    color: white;
  }

  #send-btn:disabled {
    opacity: 0.4;
    cursor: default;
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
      <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 19V5"/>
        <path d="M5 12l7-7 7 7"/>
      </svg>
    </button>
    <button id="cancel-btn">Cancel</button>
  </div>
  <script>
    const vscode = acquireVsCodeApi();
    const safetyTimeoutMin = ${JSON.stringify(vscode.workspace.getConfiguration("hermes").get<number>("safetyTimeout", 5))};
    const messagesEl = document.getElementById('messages');
    const statusEl = document.getElementById('status');
    const inputEl = document.getElementById('input');
    const sendBtn = document.getElementById('send-btn');
    const cancelBtn = document.getElementById('cancel-btn');

    let thinking = false;
    let currentStreamEl = null;
    // Element holding the active turn's reasoning / chain-of-thought
    // <details> block. Reset on each new turn (thinking-start).
    let currentThoughtEl = null;
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

    /**
     * Create a new collapsible <details> block for the active turn's
     * reasoning / chain-of-thought. Open by default so the user sees
     * every step the model takes. The body is an empty <pre> that
     * appendThought() fills in.
     */
    function addThoughtBlock() {
      const wrap = document.createElement('div');
      wrap.className = 'msg thought';

      const details = document.createElement('details');
      details.open = true;
      details.className = 'thought-details';

      const summary = document.createElement('summary');
      summary.textContent = 'Reasoning';

      const body = document.createElement('pre');
      body.className = 'thought-body';

      details.appendChild(summary);
      details.appendChild(body);
      wrap.appendChild(details);
      messagesEl.appendChild(wrap);
      scrollBottom();
      // Return a small object so the caller can reach both elements.
      return { wrap: wrap, body: body };
    }

    /**
     * Append a chunk of text to the active thought block. Renders the
     * text as-is; model reasoning is usually pre-formatted with
     * newlines, so we set textContent and let <pre> preserve them.
     */
    function appendThought(thought, text) {
      if (!thought || !thought.body) return;
      thought.body.textContent += text;
    }

    function setStatus(text) {
      statusEl.textContent = text;
    }

    function setThinking(active) {
      thinking = active;
      inputEl.disabled = active;
      sendBtn.style.display = active ? "none" : "flex";
      cancelBtn.style.display = active ? 'block' : 'none';

      if (active) {
        // Safety net: if the server never sends thinking-end AND no
        // assistant-stream chunk arrives (e.g. network drop, server crash),
        // force the indicator off after the configured timeout so the UI is recoverable.
        // The user can re-prompt after that.
        const safetyTimeoutMin = ${JSON.stringify(vscode.workspace.getConfiguration("hermes").get<number>("safetyTimeout", 5))};
        if (setThinking._safetyTimer) clearTimeout(setThinking._safetyTimer);
        setThinking._safetyTimer = setTimeout(() => {
          if (thinking) {
            setThinking(false);
            addMessage('error', 'Turn timed out after ' + safetyTimeoutMin + ' min -- UI reset. You can send a new prompt.');
          }
        }, safetyTimeoutMin * 60 * 1000);
        const el = document.createElement('div');
        el.className = 'thinking';
        el.id = 'thinking-indicator';
        // Use CSS-painted icons (no emoji) for consistent rendering across
        // all systems and font configurations. The label is updated in place
        // by setThinkingPhase as the agent moves between phases.
        el.innerHTML = '<span class="thinking-icon"></span><span class="thinking-label">thinking</span><span class="dot"></span><span class="dot"></span><span class="dot"></span>';
        messagesEl.appendChild(el);
        // Scroll to ensure thinking indicator is visible
        el.scrollIntoView({ behavior: 'smooth', block: 'end' });
        scrollBottom();
      } else {
        if (setThinking._safetyTimer) {
          clearTimeout(setThinking._safetyTimer);
          setThinking._safetyTimer = null;
        }
        const el = document.getElementById('thinking-indicator');
        if (el) el.remove();
      }
    }

    // Update the thinking indicator's text and icon without recreating
    // the element (so the animated dots keep their smooth state). Called
    // when the agent moves into a new phase -- tool call, response
    // streaming, etc.
    //
    // Phase is one of: 'thinking' | 'tools' | toolname (string)
    function setThinkingPhase(label) {
      const el = document.getElementById('thinking-indicator');
      if (!el) return;
      const labelEl = el.querySelector('.thinking-label');
      const iconEl = el.querySelector('.thinking-icon');
      if (!labelEl || !iconEl) return;
      // Detect phase from the label string. Tools phase starts with the
      // gear character we use for it; everything else is "thinking".
      if (label.indexOf('GEAR') === 0) {
        iconEl.className = 'thinking-icon icon-tools';
        labelEl.textContent = label.substring(4).trim();
      } else {
        iconEl.className = 'thinking-icon icon-thinking';
        labelEl.textContent = label;
      }
    }

    function send() {
      const text = inputEl.value.trim();
      if (!text || thinking) return;
      if (text) {
        vscode.postMessage({ type: 'saveHistory', text });
      }
      inputEl.value = '';
      savedInput = '';
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
        case 'history':
          commandHistory = msg.history || [];
          historyIndex = commandHistory.length;
          break;
        case 'message':
          // Handle stream concatenation
          if (msg.kind === 'assistant-stream') {
            // First model chunk = turn has started producing output. If the
            // thinking indicator is still on screen (no thinking-end arrived
            // because the model went straight to text), hide it now so the
            // cancel button disappears and the indicator stops animating.
            if (document.getElementById('thinking-indicator')) {
              setThinking(false);
            }
            if (!currentStreamEl) {
              currentStreamEl = addMessage('assistant-stream', '');
            }
            currentStreamEl.textContent += msg.content;
            scrollBottom();
          } else if (msg.kind === 'thought-stream') {
            // Stream the model's reasoning / chain-of-thought into a
            // collapsible <details> block. The block is created on the
            // first thought-stream chunk and reused for subsequent chunks
            // of the same turn. New turns get a fresh block.
            if (!currentThoughtEl) {
              currentThoughtEl = addThoughtBlock();
            }
            appendThought(currentThoughtEl, msg.content);
            scrollBottom();
          } else if (msg.kind === 'thinking-start') {
            setThinking(true);
            currentStreamEl = null;
            currentThoughtEl = null;
          } else if (msg.kind === 'thinking-end') {
            setThinking(false);
            currentStreamEl = null;
            // Keep currentThoughtEl — the block stays visible in the
            // transcript, just frozen. Next thinking-start resets it.
          } else if (msg.kind === 'tool-start') {
            // Switch the indicator to "running <tool>..." but keep the dots
            // animating. setThinking(true) was already called at thinking-start;
            // we just relabel here.
            // Prefix "GEAR" tells setThinkingPhase which icon to show.
            // Single-quote concat to avoid clashing with the outer template
            // literal that wraps the entire <script> block.
            setThinkingPhase('GEAR running ' + (msg.content && msg.content.name ? msg.content.name : 'tool') + '...');
          } else if (msg.kind === 'tool-end') {
            // Tool finished -- switch back to "thinking" while we wait for
            // the model to produce more text (next agent_message_chunk will
            // end the indicator).
            setThinkingPhase('thinking...');
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
    vscode.postMessage({ type: 'loadHistory' });
  </script>
</body>
</html>`;
  }
}

