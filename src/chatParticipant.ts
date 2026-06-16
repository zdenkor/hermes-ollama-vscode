import * as vscode from "vscode";
import { AcpClient, AcpNotification } from "./acpClient";

let globalClient: AcpClient | undefined;
let globalSessionId: string | undefined;
let globalTurnInProgress = false;
let globalOutputChannel: vscode.OutputChannel | undefined;

async function ensureAgent(outputChannel: vscode.OutputChannel): Promise<{ client: AcpClient; sessionId: string } | undefined> {
  if (globalClient?.isRunning() && globalSessionId) {
    return { client: globalClient, sessionId: globalSessionId };
  }

  stopAgent();

  const executable = vscode.workspace.getConfiguration("hermes").get<string>("executable") || "hermes";
  const cwd = vscode.workspace.getConfiguration("hermes").get<string>("defaultCwd") ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    process.cwd();

  outputChannel.appendLine(`[Participant] CWD: ${cwd}`);
  outputChannel.appendLine(`[Participant] Executable: ${executable}`);

  globalClient = new AcpClient(executable);
  globalOutputChannel = outputChannel;

  globalClient.on("notification", (msg: AcpNotification) => {
    if (msg.method === "session/update") {
      // Handled in the prompt call
    }
  });

  globalClient.on("stderr", (text: string) => {
    outputChannel.appendLine("[stderr] " + text);
  });

  globalClient.on("error", (err: Error) => {
    outputChannel.appendLine(`[Participant] Agent error: ${err.message}`);
  });

  globalClient.on("exit", (code: number | null) => {
    if (code !== 0 && code !== null) {
      outputChannel.appendLine(`[Participant] Hermes exited with code ${code}`);
    }
  });

  globalClient.start();

  try {
    const init = await globalClient.initialize();
    outputChannel.appendLine(`[Participant] Initialize: ${JSON.stringify(init)}`);
    if (init.error) {
      outputChannel.appendLine(`[Participant] Init failed: ${init.error.message}`);
      return undefined;
    }

    const model = vscode.workspace.getConfiguration("hermes").get<string>("model") || undefined;
    const session = await globalClient.newSession(cwd, model);
    outputChannel.appendLine(`[Participant] Session: ${JSON.stringify(session)}`);

    if (session.error) {
      outputChannel.appendLine(`[Participant] Session failed: ${session.error.message}`);
      return undefined;
    }

    globalSessionId = (session.result as any)?.sessionId;
    if (!globalSessionId) {
      outputChannel.appendLine("[Participant] No sessionId in response");
      return undefined;
    }

    outputChannel.appendLine(`[Participant] Ready — session ${globalSessionId.slice(0, 8)}`);
    return { client: globalClient, sessionId: globalSessionId };
  } catch (err: any) {
    outputChannel.appendLine(`[Participant] Connection error: ${err.message}`);
    return undefined;
  }
}

function stopAgent(): void {
  if (globalClient) {
    globalClient.stop();
    globalClient.removeAllListeners();
    globalClient = undefined;
  }
  globalSessionId = undefined;
  globalTurnInProgress = false;
}

export function registerHermesChatParticipant(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel): vscode.Disposable {
  const participant = vscode.chat.createChatParticipant("hermes.agent", async (request, _context, stream, token) => {
    const command = request.command;

    // Handle slash commands
    if (command === "new") {
      stopAgent();
      stream.markdown("🔄 Starting new Hermes session...\n\n");
      const agent = await ensureAgent(outputChannel);
      if (agent) {
        stream.markdown(`✅ Hermes ready — session \`${agent.sessionId.slice(0, 8)}\`\n\n`);
      } else {
        stream.markdown("❌ Failed to start Hermes. Check `hermes.executable` path.\n");
      }
      return;
    }

    if (command === "cancel") {
      if (globalClient && globalTurnInProgress && globalSessionId) {
        globalClient.cancel(globalSessionId);
        globalTurnInProgress = false;
        stream.markdown("⏹️ Turn cancelled.\n");
      } else {
        stream.markdown("No turn in progress.\n");
      }
      return;
    }

    if (command === "sessions") {
      if (!globalClient) {
        stream.markdown("Not connected. Use `/new` first.\n");
        return;
      }
      try {
        const result = await globalClient.listSessions();
        const sessions = (result.result as any)?.sessions || [];
        if (sessions.length === 0) {
          stream.markdown("No sessions found.\n");
          return;
        }
        stream.markdown("**Sessions:**\n\n");
        for (const s of sessions) {
          stream.markdown(`- \`${s.sessionId?.slice(0, 8)}\` — ${s.title || "Untitled"}\n`);
        }
      } catch (err: any) {
        stream.markdown(`Failed: ${err.message}\n`);
      }
      return;
    }

    if (command === "setup") {
      vscode.commands.executeCommand("hermes.setup");
      stream.markdown("🔧 Setup Wizard opened.\n");
      return;
    }

    if (command === "model") {
      vscode.commands.executeCommand("hermes.chooseModel");
      stream.markdown("🎯 Model chooser opened.\n");
      return;
    }

    // Normal chat message
    const agent = await ensureAgent(outputChannel);
    if (!agent) {
      stream.markdown("❌ Hermes is not running. Check `hermes.executable` in Settings.\n");
      return;
    }

    globalTurnInProgress = true;

    // Set up notification handler for streaming
    const chunks: string[] = [];
    const onNotify = (msg: AcpNotification) => {
      if (msg.method !== "session/update") return;
      const update = (msg.params.update as any) || {};
      const type = update.sessionUpdate as string;

      if (type === "agent_message_chunk") {
        const text = update.content?.text as string;
        if (text) {
          chunks.push(text);
          stream.markdown(text);
        }
      }
    };

    globalClient!.on("notification", onNotify);

    // Handle cancellation
    token.onCancellationRequested(() => {
      if (globalClient && globalSessionId) {
        globalClient.cancel(globalSessionId);
      }
    });

    try {
      await globalClient!.prompt(globalSessionId!, request.prompt);
    } catch (err: any) {
      stream.markdown(`\n\n❌ Error: ${err.message}\n`);
    } finally {
      globalClient!.off("notification", onNotify);
      globalTurnInProgress = false;
    }
  });

  participant.iconPath = vscode.Uri.joinPath(context.extensionUri, "media", "icon.svg");

  return participant;
}
