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

    try {
      this.proc = cp.spawn(this.executable, ["acp"], {
        cwd: cwd || undefined,
        env: { ...process.env },
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      console.log(`[AcpClient] Spawn failed: ${err}`);
      this.emit("error", new Error(`Failed to spawn process: ${err}`));
      return;
    }

    console.log(`[AcpClient] Process spawned, pid=${this.proc.pid}, stdin=${!!this.proc.stdin}`);

    if (!this.proc.stdin) {
      console.log(`[AcpClient] No stdin available`);
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

  async newSession(cwd: string, model?: string): Promise<AcpResponse> {
    const params: Record<string, unknown> = {
      cwd,
      mcp_servers: [],
    };
    if (model) {
      params.model = model;
    }
    return this.sendRequest("session/new", params);
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

  private sendRequest(method: string, params: Record<string, unknown>): Promise<AcpResponse> {
    const id = this.nextId++;
    const msg = JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n";

    console.log(`[AcpClient] sendRequest: method=${method}, proc=${!!this.proc}, stdin=${this.proc?.stdin ? 'yes' : 'no'}`);

    if (!this.proc || !this.proc.stdin) {
      console.log(`[AcpClient] Process not running - proc=${!!this.proc}, stdin=${this.proc?.stdin ? 'yes' : 'no'}`);
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
