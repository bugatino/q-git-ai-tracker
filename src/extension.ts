import * as vscode from 'vscode';
import { InstallManager } from './managers/install';
import { AIEditManager } from './managers/ai-edit';

let statusBarItem: vscode.StatusBarItem;
let installManager: InstallManager;
let aiEditManager: AIEditManager;

export async function activate(context: vscode.ExtensionContext) {
  // UI Setup
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(git-commit) AI: 0';
  statusBarItem.tooltip = 'Git AI Amazon Q tracker (agent-v1)';
  statusBarItem.show();

  // Managers Setup
  installManager = new InstallManager(context);
  aiEditManager = new AIEditManager(context, statusBarItem);

  // Activate Managers
  // 1. Install & Check Requirements
  await installManager.setup();

  // 2. Start Listening for Edits
  aiEditManager.activate();

  // Manual commands
  context.subscriptions.push(
    vscode.commands.registerCommand('q-git-ai.manualHumanCheckpoint', () => manualHumanCheckpoint()),
    vscode.commands.registerCommand('q-git-ai.manualAiCheckpoint', () => manualAiCheckpoint())
  );

  console.log('[q-git-ai] agent-v1 integration activated');
}

export function deactivate() {
  statusBarItem?.dispose();
  installManager?.dispose();
}

async function manualHumanCheckpoint() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await aiEditManager.sendHumanCheckpoint(editor.document.uri);
}

async function manualAiCheckpoint() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await aiEditManager.sendAiCheckpoint(editor.document.uri, 'amazon-q-manual');
  // Status bump is handled inside if we want, or we can manually trigger update.
  // In current AIEditManager, sendAiCheckpoint doesn't assume bump unless called from event.
  // Let's manually bump for visual feedback if needed, but AIEditManager.bumpStatus is private.
  // Actually, for consistency, let's keep it simple. The manual command just sends data.
  // If we want to bump status, we should expose bumpStatus or have sendAiCheckpoint return boolean.
  // For now, let's leave status update implicit or add it if AIEditManager logic changes.
  
  // To keep consistent with previous behavior:
  const current = parseInt(statusBarItem.text.split(':')[1]?.trim() || '0', 10) || 0;
  statusBarItem.text = `$(git-commit) AI: ${current + 1}`;
}
