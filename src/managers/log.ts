import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export class LogManager {
    private context: vscode.ExtensionContext;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    private getLogsDir(): string | undefined {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            return undefined;
        }
        // Assuming single workspace or logs in the first workspace root for now
        // A more robust solution might handle multiple workspaces or ask the user
        const rootPath = workspaceFolders[0].uri.fsPath;
        return path.join(rootPath, '.git', 'ai', 'logs');
    }

    async showLogs(): Promise<void> {
        const logsDir = this.getLogsDir();
        if (!logsDir) {
            vscode.window.showErrorMessage('[q-git-ai] No workspace open or logs directory not found.');
            return;
        }

        if (!fs.existsSync(logsDir)) {
            vscode.window.showInformationMessage('[q-git-ai] No logs found (directory does not exist).');
            return;
        }

        try {
            const files = fs.readdirSync(logsDir);
            if (files.length === 0) {
                vscode.window.showInformationMessage('[q-git-ai] No log files found.');
                return;
            }

            // Read all log files and sort by creation time (optional, but good for logs)
            // For simplicity, just reading them all.
            let fullContent = '';
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                const stat = fs.statSync(filePath);
                if (stat.isFile()) {
                    const content = fs.readFileSync(filePath, 'utf-8');
                    fullContent += `\n--- LOG FILE: ${file} ---\n`;
                    fullContent += content;
                    fullContent += `\n-------------------------\n`;
                }
            }

            if (!fullContent.trim()) {
                vscode.window.showInformationMessage('[q-git-ai] Log files are empty.');
                return;
            }

            const doc = await vscode.workspace.openTextDocument({
                content: fullContent,
                language: 'log' // or 'plaintext'
            });
            await vscode.window.showTextDocument(doc);

        } catch (e) {
            vscode.window.showErrorMessage(`[q-git-ai] Failed to read logs: ${e}`);
        }
    }

    async clearLogs(): Promise<void> {
        const logsDir = this.getLogsDir();
        if (!logsDir) {
             return;
        }

        if (!fs.existsSync(logsDir)) {
             vscode.window.showInformationMessage('[q-git-ai] No logs to clean.');
             return;
        }

        const answer = await vscode.window.showWarningMessage(
            'Are you sure you want to clear all git-ai logs?',
            'Yes',
            'No'
        );

        if (answer !== 'Yes') {
            return;
        }

        try {
            const files = fs.readdirSync(logsDir);
            for (const file of files) {
                const filePath = path.join(logsDir, file);
                 fs.unlinkSync(filePath);
            }
            vscode.window.showInformationMessage('[q-git-ai] Logs cleared successfully.');
        } catch (e) {
            vscode.window.showErrorMessage(`[q-git-ai] Failed to clear logs: ${e}`);
        }
    }
}
