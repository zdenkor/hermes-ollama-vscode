import * as vscode from "vscode";
import { HermesChatProvider } from "./chatProvider";

export function activate(context: vscode.ExtensionContext) {
  const provider = new HermesChatProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("hermes-chat", provider, {
      webviewOptions: { retainContextWhenHidden: true },
    }),
    vscode.commands.registerCommand("hermes.send", () => provider.commandSend()),
    vscode.commands.registerCommand("hermes.cancel", () => provider.commandCancel()),
    vscode.commands.registerCommand("hermes.newSession", () => provider.commandNewSession()),
    vscode.commands.registerCommand("hermes.restartAgent", () => provider.commandRestartAgent()),
  );
}

export function deactivate() {}
