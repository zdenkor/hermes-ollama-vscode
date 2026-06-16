import * as vscode from "vscode";
import { AcpClient, AcpNotification } from "./acpClient";

let globalClient: AcpClient | undefined;
let globalSessionId: string | undefined;
let globalTurnInProgress = false;

async function ensureAgent(): Promise<{ client: AcpClient; sessionId: string } | undefined> {
  if (globalClient?.isRunning() && globalSessionId) {
    return { client: globalClient, sessionId: globalSessionId };
  }

  if (globalClient) {
    globalClient.stop();
    globalClient.removeAllListeners();
    globalClient = undefined;
  }
  globalSessionId = undefined;
  globalTurnInProgress = false;

  const executable = vscode.workspace.getConfiguration("hermes").get<string>("executable") || "hermes";
  const cwd = vscode.workspace.getConfiguration("hermes").get<string>("defaultCwd") ||
    vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ||
    process.cwd();

  globalClient = new AcpClient(executable);

  globalClient.on("stderr", (text: string) => {
    console.log("[HermesLM] stderr:", text);
  });

  globalClient.on("error", (err: Error) => {
    console.log("[HermesLM] error:", err.message);
  });

  globalClient.start();

  try {
    const init = await globalClient.initialize();
    if (init.error) {
      console.log("[HermesLM] Init failed:", init.error.message);
      return undefined;
    }

    const model = vscode.workspace.getConfiguration("hermes").get<string>("model") || undefined;
    const session = await globalClient.newSession(cwd, model);
    if (session.error) {
      console.log("[HermesLM] Session failed:", session.error.message);
      return undefined;
    }

    globalSessionId = (session.result as any)?.sessionId;
    if (!globalSessionId) return undefined;

    return { client: globalClient, sessionId: globalSessionId };
  } catch (err: any) {
    console.log("[HermesLM] Connection error:", err.message);
    return undefined;
  }
}

export class HermesLanguageModelProvider implements vscode.LanguageModelChatProvider {
  readonly onDidChangeLanguageModelChatInformation?: vscode.Event<void>;

  async provideLanguageModelChatInformation(
    _options: vscode.LanguageModelChatSelector,
    _token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelChatInformation[]> {
    // Return Hermes as a single model option
    return [{
      name: "hermes-agent",
      vendor: "hermes",
      family: "hermes",
      version: "1.0",
      maxInputTokens: 128000,
      maxOutputTokens: 4096,
    }];
  }

  async provideLanguageModelChatResponse(
    _model: vscode.LanguageModelChatInformation,
    messages: vscode.LanguageModelChatMessage[],
    _options: vscode.LanguageModelChatResponseOptions,
    progress: vscode.Progress<vscode.LanguageModelResponsePart>,
    token: vscode.CancellationToken
  ): Promise<void> {
    const agent = await ensureAgent();
    if (!agent) {
      progress.report({ value: new vscode.LanguageModelTextPart("❌ Hermes is not running. Check `hermes.executable` in Settings.") });
      return;
    }

    // Get the last user message
    const lastMessage = messages[messages.length - 1];
    const prompt = lastMessage.content.toString();

    globalTurnInProgress = true;

    // Set up notification handler for streaming
    const onNotify = (msg: AcpNotification) => {
      if (msg.method !== "session/update") return;
      const update = (msg.params.update as any) || {};
      const type = update.sessionUpdate as string;

      if (type === "agent_message_chunk") {
        const text = update.content?.text as string;
        if (text) {
          progress.report({ value: new vscode.LanguageModelTextPart(text) });
        }
      }
    };

    globalClient!.on("notification", onNotify);

    token.onCancellationRequested(() => {
      if (globalClient && globalSessionId) {
        globalClient.cancel(globalSessionId);
      }
    });

    try {
      await globalClient!.prompt(globalSessionId!, prompt);
    } catch (err: any) {
      progress.report({ value: new vscode.LanguageModelTextPart(`\n\n❌ Error: ${err.message}`) });
    } finally {
      globalClient!.off("notification", onNotify);
      globalTurnInProgress = false;
    }
  }

  async provideTokenCount(
    _model: vscode.LanguageModelChatInformation,
    text: string | vscode.LanguageModelChatMessage,
    _token: vscode.CancellationToken
  ): Promise<number> {
    // Rough estimate: 1 token ≈ 4 chars
    const content = typeof text === "string" ? text : text.content.toString();
    return Math.ceil(content.length / 4);
  }
}
