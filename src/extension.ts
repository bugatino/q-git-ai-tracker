import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

let statusBarItem: vscode.StatusBarItem;

interface AgentV1Human {
  type: 'human';
  repo_working_dir: string;
  will_edit_filepaths?: string[];
}

interface AgentV1AiAgent {
  type: 'ai_agent';
  repo_working_dir: string;
  edited_filepaths?: string[];
  transcript: any; // TODO: map đúng với AiTranscript
  agent_name: string;
  model: string;
  conversation_id: string;
}

type AgentV1Input = AgentV1Human | AgentV1AiAgent;

export function activate(context: vscode.ExtensionContext) {
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = '$(git-commit) AI: 0';
  statusBarItem.tooltip = 'Git AI Amazon Q tracker (agent-v1)';
  statusBarItem.show();

  // Lắng text change để detect AI edit
  const disposableTextChange = vscode.workspace.onDidChangeTextDocument(onTextChange);
  context.subscriptions.push(disposableTextChange);

  // Lắng file system change để detect AI edit trên file không mở
  const watcher = vscode.workspace.createFileSystemWatcher('**/*');
  context.subscriptions.push(watcher);
  watcher.onDidChange(onFileChange);
  watcher.onDidCreate(onFileChange);

  // Manual commands để test
  context.subscriptions.push(
    vscode.commands.registerCommand('q-git-ai.manualHumanCheckpoint', manualHumanCheckpoint),
    vscode.commands.registerCommand('q-git-ai.manualAiCheckpoint', manualAiCheckpoint)
  );

  console.log('[q-git-ai] agent-v1 integration activated');
}

async function onFileChange(uri: vscode.Uri) {
  if (!isAmazonQActive()) return;

  // Nếu file đang mở, onTextChange đã handle rồi -> bỏ qua
  const isOpen = vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString());
  if (isOpen) return;

  // Filter noise
  const fsPath = uri.fsPath;
  if (fsPath.includes('node_modules') || fsPath.includes('.git') || fsPath.includes(path.sep + 'out' + path.sep)) return;

  // Gửi checkpoint cho file không mở
  await sendAiCheckpoint(uri, 'amazon-q');
  bumpStatus();
}

async function onTextChange(event: vscode.TextDocumentChangeEvent) {
  // Remove strict check for activeTextEditor to support background edits (e.g. Apply to all files)
  // const editor = vscode.window.activeTextEditor;
  // if (!editor || event.document !== editor.document) return;
  
  if (event.document.uri.scheme !== 'file') return;
  if (!isAmazonQActive()) return;

  const hasLargeChange = event.contentChanges.some((c) => {
    const text = c.text;
    const isMultiLine = text.includes('\n');
    const isFastInsert = c.rangeLength === 0;
    const isLargeEnough = text.length >= 3;
    const hasStructure = /[;{}\[\]()]/.test(text);
    const isTyping = text.length === 1 && !hasStructure;
    return (isMultiLine || isFastInsert) && isLargeEnough && !isTyping;
  });

  if (!hasLargeChange) return;

  const doc = event.document;
  // Gửi AI checkpoint tối thiểu cho file này
  // Gửi AI checkpoint tối thiểu cho file này
  await sendAiCheckpoint(doc.uri, 'amazon-q');
  bumpStatus();
}

async function manualHumanCheckpoint() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await sendHumanCheckpoint(editor.document.uri);
}

async function manualAiCheckpoint() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) return;
  await sendAiCheckpoint(editor.document.uri, 'amazon-q-manual');
  bumpStatus();
}

function bumpStatus() {
  const current = parseInt(statusBarItem.text.split(':')[1]?.trim() || '0', 10) || 0;
  statusBarItem.text = `$(git-commit) AI: ${current + 1}`;
}

async function sendHumanCheckpoint(uri: vscode.Uri) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const fileRelPath = path.relative(workspaceRoot, uri.fsPath);

  const payload: AgentV1Human = {
    type: 'human',
    repo_working_dir: workspaceRoot,
    will_edit_filepaths: [fileRelPath],
  };

  await callGitAiAgentV1(payload);
}

async function sendAiCheckpoint(uri: vscode.Uri, agentName: string) {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const fileRelPath = path.relative(workspaceRoot, uri.fsPath);

  const payload: AgentV1AiAgent = {
    type: 'ai_agent',
    repo_working_dir: workspaceRoot,
    edited_filepaths: [fileRelPath],
    agent_name: agentName,
    model: 'amazon-q-unknown-model', // TODO: lấy từ config/setting nếu cần
    conversation_id: `vscode-${Date.now()}`, // ID tạm cho mỗi session
    transcript: {
      // ❗ TODO: map đúng với AiTranscript trong repo git-ai
      messages: [],
    },
  };

  await callGitAiAgentV1(payload);
}

async function callGitAiAgentV1(payload: AgentV1Input): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

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

function isAmazonQActive(): boolean {
  const qExt = vscode.extensions.getExtension('AmazonWebServices.amazon-q-vscode');
  return !!qExt?.isActive;
}

export function deactivate() {
  statusBarItem.dispose();
}
