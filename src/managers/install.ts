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

  async setup(interactive: boolean = false): Promise<void> {
    const homeDir = process.env.HOME || process.env.USERPROFILE || '';
    if (!homeDir) {
      console.error('[q-git-ai] Could not determine HOME directory.');
      return;
    }

    const gitAiDir = path.join(homeDir, GIT_AI_DIR_NAME);
    const binPath = path.join(gitAiDir, 'bin');
    const executablePath = path.join(binPath, 'git-ai');

    const isInstalled = fs.existsSync(executablePath);

    if (isInstalled && interactive) {
        const choice = await vscode.window.showInformationMessage(
            '[q-git-ai] git-ai is already installed. Do you want to re-install / update it?',
            'Re-install',
            'Cancel'
        );
        if (choice !== 'Re-install') {
            return;
        }
        // Proceed to install (fall through)
    } else if (isInstalled) {
        // Not interactive, already installed -> just registration
        this.addPath(binPath);
        this.context.workspaceState.update('git-ai-bin-path', binPath);
        await this.checkVersion(executablePath);
        return; 
    }

    if (!isInstalled || interactive) {
      // If we are here, we either aren't installed OR we are interactive and chose to reinstall
      const choice = interactive ? 'Install' : await vscode.window.showInformationMessage(
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
                    // Use -NoProfile to avoid permission issues with user profile scripts
                    // Use -NonInteractive to prevent hanging
                    // Use -ExecutionPolicy Bypass to run standard script
                    const installCmd = `powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "${scriptPath}"`;
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

    this.addPath(binPath);
    this.context.workspaceState.update('git-ai-bin-path', binPath);
    await this.checkVersion(executablePath);
  }

  private addPath(binPath: string) {
    // Add to PATH
    if (process.env.PATH && !process.env.PATH.includes(binPath)) {
        process.env.PATH = `${binPath}${path.delimiter}${process.env.PATH}`;
        console.log('[q-git-ai] Added git-ai to PATH:', binPath);
    }
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
