import * as vscode from 'vscode';
import * as path from 'path';
import { spawn } from 'child_process';
import { Config } from '../utils/config';

interface AgentV1Human {
  type: 'human';
  repo_working_dir: string;
  will_edit_filepaths?: string[];
  dirty_files?: Record<string, string>;
}

interface AgentV1AiAgent {
  type: 'ai_agent';
  repo_working_dir: string;
  edited_filepaths?: string[];
  dirty_files?: Record<string, string>;
  transcript: any;
  agent_name: string;
  model: string;
  conversation_id: string;
}

type AgentV1Input = AgentV1Human | AgentV1AiAgent;

export class AIEditManager {
  private context: vscode.ExtensionContext;
  private statusBarItem: vscode.StatusBarItem;

  constructor(context: vscode.ExtensionContext, statusBarItem: vscode.StatusBarItem) {
    this.context = context;
    this.statusBarItem = statusBarItem;
  }

  activate() {
    // Text change listener
    const disposableTextChange = vscode.workspace.onDidChangeTextDocument(this.onTextChange.bind(this));
    this.context.subscriptions.push(disposableTextChange);

    // File system listener
    const watcher = vscode.workspace.createFileSystemWatcher('**/*');
    this.context.subscriptions.push(watcher);
    watcher.onDidChange(this.onFileChange.bind(this));
    watcher.onDidCreate(this.onFileChange.bind(this));
  }

  private async onFileChange(uri: vscode.Uri) {
    if (!this.isAmazonQActive()) return;

    // Filter noise
    const fsPath = uri.fsPath;
    if (fsPath.includes('node_modules') || fsPath.includes('.git') || fsPath.includes(path.sep + 'out' + path.sep)) return;

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    if (!workspaceRoot || !Config.isRepositoryAllowed(workspaceRoot)) return;

    // Check if open (handled by onTextChange)
    const isOpen = vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString());
    if (isOpen) return;

    await this.sendAiCheckpoint(uri, 'amazon-q');
    this.bumpStatus();
  }

  private async onTextChange(event: vscode.TextDocumentChangeEvent) {
    if (event.document.uri.scheme !== 'file') return;
    if (!this.isAmazonQActive()) return;

    const workspaceRoot = vscode.workspace.getWorkspaceFolder(event.document.uri)?.uri.fsPath;
    if (!workspaceRoot || !Config.isRepositoryAllowed(workspaceRoot)) return;

    const clipboardText = await vscode.env.clipboard.readText();

    const hasLargeChange = event.contentChanges.some((c) => {
      const text = c.text;

      // Paste detection
      if (text === clipboardText) {
        return false;
      }

      const isMultiLine = text.includes('\n');
      const isFastInsert = c.rangeLength === 0;
      const isLargeEnough = text.length >= Config.minChangeSize;
      const hasStructure = /[;{}\[\]()]/.test(text);
      const isTyping = text.length === 1 && !hasStructure;
      return (isMultiLine || isFastInsert) && isLargeEnough && !isTyping;
    });

    if (!hasLargeChange) return;

    await this.sendAiCheckpoint(event.document.uri, 'amazon-q');
    this.bumpStatus();
  }

  private bumpStatus() {
    const current = parseInt(this.statusBarItem.text.split(':')[1]?.trim() || '0', 10) || 0;
    this.statusBarItem.text = `$(git-commit) AI: ${current + 1}`;
  }

  private isAmazonQActive(): boolean {
    const qExt = vscode.extensions.getExtension('AmazonWebServices.amazon-q-vscode');
    return !!qExt?.isActive;
  }

  async sendHumanCheckpoint(uri: vscode.Uri) {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    if (!workspaceRoot) return;
  
    const fileRelPath = path.relative(workspaceRoot, uri.fsPath);
  
    const payload: AgentV1Human = {
      type: 'human',
      repo_working_dir: workspaceRoot,
      will_edit_filepaths: [fileRelPath],
      dirty_files: this.getDirtyFiles()
    };
  
    await this.callGitAiAgentV1(payload, workspaceRoot);
  }

  async sendAiCheckpoint(uri: vscode.Uri, agentName: string) {
    const workspaceRoot = vscode.workspace.getWorkspaceFolder(uri)?.uri.fsPath;
    if (!workspaceRoot) return;
  
    const fileRelPath = path.relative(workspaceRoot, uri.fsPath);
  
    const payload: AgentV1AiAgent = {
      type: 'ai_agent',
      repo_working_dir: workspaceRoot,
      edited_filepaths: [fileRelPath],
      dirty_files: this.getDirtyFiles(),
      agent_name: agentName,
      model: 'amazon-q-unknown-model',
      conversation_id: `vscode-${Date.now()}`,
      transcript: { messages: [] },
    };
  
    await this.callGitAiAgentV1(payload, workspaceRoot);
  }

  private getDirtyFiles(): Record<string, string> {
    const dirtyRx: Record<string, string> = {};
    vscode.workspace.textDocuments.forEach(doc => {
      if (doc.isDirty && doc.uri.scheme === 'file') {
        dirtyRx[doc.uri.fsPath] = doc.getText();
      }
    });
    return dirtyRx;
  }

  private async callGitAiAgentV1(payload: AgentV1Input, workspaceRoot: string): Promise<void> {
    const hookInput = JSON.stringify(payload);
  
    console.log('[q-git-ai] calling git-ai checkpoint agent-v1 with:', hookInput);
  
    return new Promise((resolve) => {
      const proc = spawn('git-ai', ['checkpoint', 'agent-v1', '--hook-input', hookInput], {
        cwd: workspaceRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
  
      proc.stdout?.on('data', (d) => console.log('[q-git-ai] stdout:', d.toString()));
      proc.stderr?.on('data', (d) => console.log('[q-git-ai] stderr:', d.toString()));
  
      proc.on('close', (code) => {
        console.log('[q-git-ai] checkpoint agent-v1 exit code:', code);
        resolve();
      });
    });
  }
}
