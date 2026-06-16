import * as vscode from "vscode";
import { HermesChatProvider } from "./chatProvider";
import { registerHermesChatParticipant } from "./chatParticipant";
import { HermesLanguageModelProvider } from "./languageModelProvider";

let participantDisposable: vscode.Disposable | undefined;

function updateChatParticipant(context: vscode.ExtensionContext, outputChannel: vscode.OutputChannel) {
  const useCopilotChat = vscode.workspace.getConfiguration("hermes").get<boolean>("useCopilotChat", false);

  if (useCopilotChat && !participantDisposable) {
    participantDisposable = registerHermesChatParticipant(context, outputChannel);
    outputChannel.appendLine("Hermes Copilot Chat participant registered (@hermes)");
  } else if (!useCopilotChat && participantDisposable) {
    participantDisposable.dispose();
    participantDisposable = undefined;
    outputChannel.appendLine("Hermes Copilot Chat participant unregistered");
  }
}

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
    vscode.commands.registerCommand("hermes.setup", () => provider.commandSetupWizard()),
  );

  // Always register Language Model provider (appears in Copilot Chat dropdown)
  try {
    const lmProvider = new HermesLanguageModelProvider();
    const lmDisposable = vscode.lm.registerLanguageModelChatProvider("hermes", lmProvider);
    context.subscriptions.push(lmDisposable);
    outputChannel.appendLine("Hermes Language Model provider registered (appears in Copilot Chat dropdown)");
  } catch (err: any) {
    outputChannel.appendLine(`Failed to register Language Model provider: ${err.message}`);
  }

  // Register/unregister Copilot Chat participant based on setting
  updateChatParticipant(context, outputChannel);

  // Listen for setting changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("hermes.useCopilotChat")) {
        updateChatParticipant(context, outputChannel);
      }
    })
  );
}

export function deactivate() {
  participantDisposable?.dispose();
}
