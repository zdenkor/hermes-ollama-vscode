import * as cp from "child_process";
import { EventEmitter } from "events";

export interface AcpResponse {
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

export interface AcpNotification {
  method: string;
  params: Record<string, unknown>;
}

export class AcpClient extends EventEmitter {
  private proc!: cp.ChildProcess;
  private nextId = 0;
  private pending = new Map<number, (r: AcpResponse) => void>();
  private buffer = "";
  private executable: string;

  constructor(executable: string) {
    super();
    this.executable = executable;
  }

  isRunning(): boolean {
    return this.proc && !this.proc.killed;
  }

  start(cwd?: string): void {
    if (this.isRunning()) this.stop();

    console.log(`[AcpClient] Starting process: ${this.executable} with args ["acp", "--stdio"], cwd=${cwd}`);
    this.emit("log", { level: "debug", message: `Starting process: ${this.executable} with args ["acp"], cwd=${cwd}` });

    try {
      this.proc = cp.spawn(this.executable, ["acp"], {
        cwd: cwd || undefined,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      console.log(`[AcpClient] Spawn failed: ${err}`);
      this.emit("log", { level: "minimal", message: `Spawn failed: ${err}` });
      this.emit("error", new Error(`Failed to spawn process: ${err}`));
      return;
    }

    console.log(`[AcpClient] Process spawned, pid=${this.proc.pid}, stdin=${!!this.proc.stdin}`);
    this.emit("log", { level: "debug", message: `Process spawned, pid=${this.proc.pid}, stdin=${!!this.proc.stdin}` });

    if (!this.proc.stdin) {
      console.log(`[AcpClient] No stdin available`);
      this.emit("log", { level: "minimal", message: "No stdin available" });
      this.emit("error", new Error("Failed to create stdin stream"));
      return;
    }

    this.proc.stdout!.on("data", (data: Buffer) => {
      this.buffer += data.toString("utf8");
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) this.handleLine(line.trim());
      }
    });

    this.proc.stderr!.on("data", (data: Buffer) => {
      this.emit("stderr", data.toString("utf8"));
    });

    this.proc.on("exit", (code) => {
      this.emit("exit", code);
    });

    this.proc.on("error", (err) => {
      this.emit("error", err);
    });
  }

  stop(): void {
    this.pending.forEach((_, id) => {
      this.pending.get(id)!({ id, error: { code: -1, message: "Process stopped" } });
    });
    this.pending.clear();
    if (this.proc && !this.proc.killed) {
      this.proc.kill();
    }
  }

  async initialize(): Promise<AcpResponse> {
    return this.sendRequest("initialize", {
      protocol_version: 1,
      client_capabilities: { promptCapabilities: { image: true } },
      client_info: { name: "hermes-ollama-vscode", version: "0.1.0" },
    });
  }

  async newSession(cwd: string, _model?: string): Promise<AcpResponse> {
    // NOTE: the ACP NewSessionRequest schema has NO `model` field — model
    // selection happens via a separate `session/set_model` call after the
    // session is created. The third-party extension previously sent
    // `params.model = ...` here and the server silently dropped it, so the
    // new session always used hermes's default model regardless of what
    // the user picked. Use setSessionModel() below to actually apply the
    // chosen model. We keep the parameter for back-compat with the call
    // sites in chatProvider.ts.
    return this.sendRequest("session/new", {
      cwd,
      mcp_servers: [],
    });
  }

  async prompt(sessionId: string, text: string): Promise<AcpResponse> {
    return this.sendRequest("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }],
    });
  }

  cancel(sessionId: string): void {
    this.sendNotification("session/cancel", { sessionId });
  }

  async listSessions(): Promise<AcpResponse> {
    return this.sendRequest("session/list", {});
  }

  async loadSession(sessionId: string, cwd: string): Promise<AcpResponse> {
    return this.sendRequest("session/load", { sessionId, cwd, mcpServers: [] });
  }

  /**
   * Set a session-level config option. Used to flip the edit approval
   * policy from "ask" (default) to "workspace_session" (= accept_edits
   * mode = auto-approve workspace and /tmp edits; still asks for
   * sensitive paths). Without this, the agent tries to call
   * conn.request_permission and times out after 60s in our vscode acp
   * integration because vscode's acp.autoApprovePermissions does not
   * cover the edit-approval flow.
   *
   * @param sessionId - the ACP session id returned by session/new
   * @param configId  - the config option id (e.g. "edit_approval_policy")
   * @param value     - the value id (e.g. "workspace_session", "session", "ask")
   */
  async setSessionConfigOption(
    sessionId: string,
    configId: string,
    value: string
  ): Promise<AcpResponse> {
    return this.sendRequest("session/set_config_option", {
      sessionId,
      configId,
      value,
    });
  }

  /**
   * Set the model for an active session. Per the ACP protocol, model
   * selection is NOT a field on session/new — it's a separate call sent
   * after the session is created (or loaded). The server's
   * `set_session_model(model_id, session_id)` handler rebinds the
   * underlying agent's model so subsequent prompts use the new one.
   *
   * @param sessionId - the ACP session id returned by session/new or session/load
   * @param modelId   - the model identifier (e.g. "kimi-k2.6:cloud")
   */
  async setSessionModel(sessionId: string, modelId: string): Promise<AcpResponse> {
    return this.sendRequest("session/set_model", {
      sessionId,
      modelId,
    });
  }

  private sendRequest(method: string, params: Record<string, unknown>): Promise<AcpResponse> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    console.log(`[AcpClient] sendRequest: method=${method}, proc=${!!this.proc}, stdin=${this.proc?.stdin ? 'yes' : 'no'}`);
    this.emit("log", { level: "debug", message: `sendRequest: method=${method}, proc=${!!this.proc}` });

    if (!this.proc || !this.proc.stdin) {
      console.log(`[AcpClient] Process not running - proc=${!!this.proc}, stdin=${this.proc?.stdin ? 'yes' : 'no'}`);
      this.emit("log", { level: "minimal", message: `Process not running while trying to send ${method}` });
      return Promise.reject(new Error("Process not running"));
    }

    this.proc.stdin.write(msg);

    return new Promise((resolve) => {
      this.pending.set(id, resolve);
    });
  }

  private sendNotification(method: string, params: Record<string, unknown>): void {
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n";

    if (!this.proc || !this.proc.stdin) {
      return;
    }

    this.proc.stdin.write(msg);
  }

  private handleLine(line: string): void {
    try {
      const msg = JSON.parse(line);
      if (msg.method) {
        // Notification
        this.emit("notification", msg as AcpNotification);
      } else if (msg.id !== undefined) {
        // Response
        const resolve = this.pending.get(msg.id);
        if (resolve) {
          this.pending.delete(msg.id);
          resolve(msg as AcpResponse);
        }
      }
    } catch {
      // Ignore malformed lines
    }
  }
}
