import * as vscode from 'vscode';
import { spawn } from 'child_process';
import * as path from 'path';

let debounceTimer: NodeJS.Timeout | null = null;
let statusBarItem: vscode.StatusBarItem;
let recentChanges: { file: string; range: vscode.Range; timestamp: number }[] = [];

export function activate(context: vscode.ExtensionContext) {
  // Status bar
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.command = 'q-git-ai.manualCheckpoint';
  statusBarItem.text = '$(git-commit) AI: 0';
  statusBarItem.tooltip = 'Click for manual Amazon Q checkpoint';
  statusBarItem.show();

  // Debounced text change tracker
  const disposableTextChange = vscode.workspace.onDidChangeTextDocument(debouncedTrackQChanges);
  context.subscriptions.push(disposableTextChange);

  // Manual checkpoint command
  const disposableManual = vscode.commands.registerCommand('q-git-ai.manualCheckpoint', manualCheckpoint);
  context.subscriptions.push(disposableManual);

  // Update status on editor change
  const disposableEditorChange = vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
  context.subscriptions.push(disposableEditorChange);

  console.log('Q Git AI Tracker activated');
}

function debouncedTrackQChanges(event: vscode.TextDocumentChangeEvent) {
  if (debounceTimer) clearTimeout(debounceTimer);

  debounceTimer = setTimeout(() => {
    trackQInsertion(event);
  }, vscode.workspace.getConfiguration('q-git-ai').get('debounceMs', 150));
}

async function trackQInsertion(event: vscode.TextDocumentChangeEvent) {
  const editor = vscode.window.activeTextEditor;
  if (!editor || event.document !== editor.document) return;

  const config = vscode.workspace.getConfiguration('q-git-ai');
  const minChangeSize = config.get('minChangeSize', 3);

  // Filter chỉ changes đủ lớn + pattern giống Q insertion
  const qChanges: vscode.Range[] = [];
  for (const change of event.contentChanges) {
    if (isLikelyQInsertion(change, minChangeSize)) {
      const range = new vscode.Range(
        event.document.positionAt(change.rangeOffset),
        event.document.positionAt(change.rangeOffset + change.text.length)
      );
      qChanges.push(range);
    }
  }

  if (qChanges.length === 0) return;

  // Check Amazon Q đang active
  if (!isAmazonQActive()) return;

  // Merge overlapping ranges + call git-ai
  const mergedRange = mergeRanges(qChanges, event.document);
  if (mergedRange) {
    await callGitAiCheckpoint(event.document.uri.fsPath, mergedRange, 'amazon-q');
    updateStatusBar();
  }
}

function isLikelyQInsertion(change: vscode.TextDocumentContentChangeEvent, minSize: number): boolean {
  const text = change.text;
  
  // Q patterns: multi-line, function-like, rapid insert
  const isMultiLine = text.includes('\n');
  const isFastInsert = change.rangeLength === 0; // Pure insertion
  const isLargeEnough = text.length >= minSize;
  const hasSemicolonOrBracket = /[;{}\[\]]/.test(text);
  
  // Skip obvious human typing (single char, backspace)
  const isTyping = text.length === 1 && !hasSemicolonOrBracket;
  
  return (isMultiLine || isFastInsert) && isLargeEnough && !isTyping;
}

function mergeRanges(ranges: vscode.Range[], document: vscode.TextDocument): vscode.Range | null {
  if (ranges.length === 0) return null;

  let mergedStart = ranges[0].start;
  let mergedEnd = ranges[0].end;

  for (let i = 1; i < ranges.length; i++) {
    const range = ranges[i];
    if (range.start.isBeforeOrEqual(mergedEnd)) {
      // FIX: Sử dụng new vscode.Range thay vì fromPositions
      mergedEnd = new vscode.Range(mergedStart, range.end).end;
    } else {
      // Non-overlapping: quá xa → không phải cùng Q insertion
      return null;
    }
  }

  return new vscode.Range(mergedStart, mergedEnd);
}

async function callGitAiCheckpoint(filePath: string, range: vscode.Range, agent: string): Promise<void> {
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (!workspaceRoot) return;

  const args = [
    'checkpoint',
    '--agent', agent,
    '--file', path.relative(workspaceRoot, filePath),
    '--start-line', `${range.start.line + 1}`,
    '--end-line', `${range.end.line + 1}`
  ];

  return new Promise((resolve) => {
    const proc = spawn('git-ai', args, { cwd: workspaceRoot, stdio: 'pipe' });
    
    proc.on('close', (code) => {
      if (code === 0) {
        recentChanges.push({ 
          file: filePath, 
          range, 
          timestamp: Date.now() 
        });
        vscode.window.showInformationMessage(
          `✅ Git-ai checkpointed Amazon Q → ${range.end.line - range.start.line + 1} lines`,
          { modal: false }
        );
      } else {
        vscode.window.showWarningMessage('❌ git-ai checkpoint failed');
      }
      resolve();
    });
  });
}

function isAmazonQActive(): boolean {
  const qExt = vscode.extensions.getExtension('AmazonWebServices.amazon-q-vscode');
  return !!qExt?.isActive;
}

async function manualCheckpoint() {
  const editor = vscode.window.activeTextEditor;
  if (!editor || !isAmazonQActive()) {
    vscode.window.showWarningMessage('No active Amazon Q editor');
    return;
  }

  const selection = editor.selection;
  if (selection.isEmpty) {
    vscode.window.showInformationMessage('Select code range for manual checkpoint');
    return;
  }

  await callGitAiCheckpoint(
    editor.document.uri.fsPath, 
    selection, 
    'amazon-q-manual'
  );
}

function updateStatusBar(editor?: vscode.TextEditor) {
  const recentCount = recentChanges.filter(c => 
    Date.now() - c.timestamp < 5 * 60 * 1000 // 5 phút gần nhất
  ).length;

  statusBarItem.text = `$(git-commit) AI: ${recentCount}`;
  statusBarItem.color = recentCount > 0 ? '#00ff00' : undefined;
}

export function deactivate() {
  statusBarItem.dispose();
}