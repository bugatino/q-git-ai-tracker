import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { runCommand, cmdOutput } from '../utils/common';

const GIT_AI_DIR_NAME = '.git-ai';

export class InstallManager {
  private context: vscode.ExtensionContext;

  constructor(context: vscode.ExtensionContext) {
    this.context = context;
  }

  async setup(): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!homeDir) {
      console.error('[q-git-ai] Could not determine HOME directory.');
      return;
    }

    const gitAiDir = path.join(homeDir, GIT_AI_DIR_NAME);
    const binPath = path.join(gitAiDir, 'bin');
    const executablePath = path.join(binPath, 'git-ai');

    const isInstalled = fs.existsSync(executablePath);

    if (!isInstalled) {
      const choice = await vscode.window.showInformationMessage(
        '[q-git-ai] git-ai is not installed. Do you want to install it automatically?',
        'Install',
        'Cancel'
      );

      if (choice === 'Install') {
        try {
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Installing git-ai...",
                cancellable: false
            }, async () => {
                if (process.platform === 'win32') {
                    const scriptPath = path.join(this.context.extensionPath, 'resources', 'install.ps1');
                    // Use -ExecutionPolicy Bypass to ensure the script runs
                    const installCmd = `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`;
                    await runCommand(installCmd, [], homeDir, true);
                } else {
                    const scriptPath = path.join(this.context.extensionPath, 'resources', 'install.sh');
                    const installCmd = `bash "${scriptPath}"`;
                    await runCommand(installCmd, [], homeDir, true);
                }
            });
            const selection = await vscode.window.showInformationMessage(
                '[q-git-ai] git-ai installed successfully. Please reload the window to apply changes.',
                'Reload Window'
            );
            if (selection === 'Reload Window') {
                vscode.commands.executeCommand('workbench.action.reloadWindow');
            }
        } catch (e) {
            vscode.window.showErrorMessage(`[q-git-ai] Failed to install git-ai: ${e}`);
            return;
        }
      } else {
          return;
      }
    }

    // Add to PATH
    if (process.env.PATH && !process.env.PATH.includes(binPath)) {
      process.env.PATH = `${binPath}${path.delimiter}${process.env.PATH}`;
      console.log('[q-git-ai] Added git-ai to PATH:', binPath);
    }

    // Store binPath for deactivation cleanup
    this.context.workspaceState.update('git-ai-bin-path', binPath);

    // Version Check
    await this.checkVersion(executablePath);
  }

  async checkVersion(executablePath: string): Promise<void> {
    try {
      const versionOutput = await cmdOutput(executablePath, ['--version'], path.dirname(executablePath));
      // Expected output: "git-ai version 0.0.1" or just "0.0.1" depending on implementation
      console.log(`[q-git-ai] git-ai version: ${versionOutput}`);
      
      // Basic check: just ensure it runs. Future: compare semver.
      if (!versionOutput) {
          vscode.window.showWarningMessage('[q-git-ai] git-ai installed but version check failed.');
      }
    } catch (e) {
      console.error('[q-git-ai] git-ai version check error:', e);
    }
  }

  dispose(): void {
    // Remove git-ai from PATH
    const binPath = this.context.workspaceState.get<string>('git-ai-bin-path');
    if (binPath && process.env.PATH) {
      const pathDirs = process.env.PATH.split(path.delimiter);
      const newPath = pathDirs.filter(p => p !== binPath).join(path.delimiter);
      process.env.PATH = newPath;
      console.log('[q-git-ai] Removed git-ai from PATH');
    }
  }
}
