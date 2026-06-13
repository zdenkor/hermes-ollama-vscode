import * as vscode from "vscode";
import { HermesChatProvider } from "./chatProvider";

export function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("Hermes");
  context.subscriptions.push(outputChannel);

  outputChannel.appendLine("Hermes extension activated");

  const provider = new HermesChatProvider(context, outputChannel);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("hermes-chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("hermes.send", () => provider.commandSend()),
    vscode.commands.registerCommand("hermes.cancel", () => provider.commandCancel()),
    vscode.commands.registerCommand("hermes.newSession", () => provider.commandNewSession()),
    vscode.commands.registerCommand("hermes.restartAgent", () => provider.commandRestartAgent()),
    vscode.commands.registerCommand("hermes.sessions", () => provider.commandSessions()),
    vscode.commands.registerCommand("hermes.resumeSession", (sessionId: string) => provider.commandResumeSession(sessionId)),
    vscode.commands.registerCommand("hermes.chooseModel", () => provider.commandChooseModel()),
  );
}

export function deactivate() {}
