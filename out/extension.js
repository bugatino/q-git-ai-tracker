"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const path = require("path");
let debounceTimer = null;
let statusBarItem;
let recentChanges = [];
function activate(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    statusBarItem.command = 'q-git-ai.manualCheckpoint';
    statusBarItem.text = '$(git-commit) AI: 0';
    statusBarItem.tooltip = 'Click for manual Amazon Q checkpoint';
    statusBarItem.show();
    // 🔥 DEBUG: Log mọi text change
    const disposableTextChange = vscode.workspace.onDidChangeTextDocument((event) => {
        console.log('🔥 TEXT CHANGE EVENT:', {
            file: event.document.fileName,
            changesCount: event.contentChanges.length,
            changes: event.contentChanges.map(c => ({
                text: c.text.slice(0, 100) + (c.text.length > 100 ? '...' : ''),
                rangeLength: c.rangeLength,
                rangeOffset: c.rangeOffset,
                isMultiLine: c.text.includes('\n')
            }))
        });
        debouncedTrackQChanges(event);
    });
    context.subscriptions.push(disposableTextChange);
    const disposableManual = vscode.commands.registerCommand('q-git-ai.manualCheckpoint', manualCheckpoint);
    context.subscriptions.push(disposableManual);
    const disposableEditorChange = vscode.window.onDidChangeActiveTextEditor(updateStatusBar);
    context.subscriptions.push(disposableEditorChange);
    console.log('🚀 Q Git AI Tracker DEBUG MODE activated');
}
function debouncedTrackQChanges(event) {
    if (debounceTimer)
        clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        trackQInsertion(event);
    }, 200);
}
async function trackQInsertion(event) {
    console.log('🔍 trackQInsertion called');
    const editor = vscode.window.activeTextEditor;
    if (!editor || event.document !== editor.document) {
        console.log('❌ No active editor or wrong document');
        return;
    }
    const qActive = isAmazonQActive();
    console.log('🤖 Amazon Q active:', qActive);
    if (!qActive) {
        console.log('⚠️  Amazon Q not active - skipping');
        return;
    }
    const config = vscode.workspace.getConfiguration('q-git-ai');
    const minChangeSize = config.get('minChangeSize', 3);
    const qChanges = [];
    for (const change of event.contentChanges) {
        // 🔥 FIX: Khai báo đầy đủ biến
        const isLikelyQInsertionResult = isLikelyQInsertion(change, minChangeSize);
        console.log('📊 Change analysis:', {
            textPreview: change.text.slice(0, 50),
            length: change.text.length,
            rangeLength: change.rangeLength,
            isMultiLine: change.text.includes('\n'),
            hasBrackets: /[;{}\[\]]/.test(change.text),
            isTyping: change.text.length === 1 && !/[;{}\[\]]/.test(change.text),
            isLikelyQ: isLikelyQInsertionResult, // ✅ Fixed
            minSize: minChangeSize // ✅ Fixed
        });
        if (isLikelyQInsertionResult) {
            const range = new vscode.Range(event.document.positionAt(change.rangeOffset), event.document.positionAt(change.rangeOffset + change.text.length));
            qChanges.push(range);
            console.log('✅ Q-like change detected:', range);
        }
    }
    if (qChanges.length === 0) {
        console.log('❌ No Q-like changes found');
        return;
    }
    const mergedRange = mergeRanges(qChanges, event.document);
    console.log('🔗 Merged range:', mergedRange);
    if (mergedRange) {
        console.log('🚀 Calling git-ai checkpoint...');
        await callGitAiCheckpoint(event.document.uri.fsPath, mergedRange, 'amazon-q');
        updateStatusBar();
    }
}
function isLikelyQInsertion(change, minSize) {
    const text = change.text;
    const isMultiLine = text.includes('\n');
    const isFastInsert = change.rangeLength === 0;
    const isLargeEnough = text.length >= minSize;
    const hasSemicolonOrBracket = /[;{}\[\]]/.test(text);
    const isTyping = text.length === 1 && !hasSemicolonOrBracket;
    return (isMultiLine || isFastInsert) && isLargeEnough && !isTyping;
}
function mergeRanges(ranges, document) {
    if (ranges.length === 0)
        return null;
    let mergedStart = ranges[0].start;
    let mergedEnd = ranges[0].end;
    for (let i = 1; i < ranges.length; i++) {
        const range = ranges[i];
        if (range.start.isBeforeOrEqual(mergedEnd)) {
            mergedEnd = new vscode.Range(mergedStart, range.end).end;
        }
        else {
            return null;
        }
    }
    return new vscode.Range(mergedStart, mergedEnd);
}
async function callGitAiCheckpoint(filePath, range, agent) {
    console.log('⚙️  Executing git-ai checkpoint:', { filePath, range, agent });
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot) {
        console.log('❌ No workspace root');
        return;
    }
    const args = [
        'checkpoint',
        '--agent', agent,
        '--file', path.relative(workspaceRoot, filePath),
        '--start-line', `${range.start.line + 1}`,
        '--end-line', `${range.end.line + 1}`
    ];
    console.log('💻 git-ai args:', args);
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('git-ai', args, { cwd: workspaceRoot, stdio: 'pipe' });
        proc.stdout?.on('data', (data) => console.log('📤 git-ai stdout:', data.toString()));
        proc.stderr?.on('data', (data) => console.log('📤 git-ai stderr:', data.toString()));
        proc.on('close', (code) => {
            console.log('🏁 git-ai exit code:', code);
            if (code === 0) {
                recentChanges.push({
                    file: filePath,
                    range,
                    timestamp: Date.now()
                });
                vscode.window.showInformationMessage(`✅ Git-ai checkpointed Amazon Q → ${range.end.line - range.start.line + 1} lines`);
            }
            else {
                vscode.window.showWarningMessage('❌ git-ai checkpoint failed');
            }
            resolve();
        });
    });
}
function isAmazonQActive() {
    const qExt = vscode.extensions.getExtension('AmazonWebServices.amazon-q-vscode');
    const active = !!qExt?.isActive;
    console.log('🔍 Amazon Q extension check:', { id: 'AmazonWebServices.amazon-q-vscode', active });
    return active;
}
async function manualCheckpoint() {
    console.log('🖱️  Manual checkpoint triggered');
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
    await callGitAiCheckpoint(editor.document.uri.fsPath, selection, 'amazon-q-manual');
}
function updateStatusBar(editor) {
    const recentCount = recentChanges.filter(c => Date.now() - c.timestamp < 5 * 60 * 1000).length;
    statusBarItem.text = `$(git-commit) AI: ${recentCount}`;
    statusBarItem.color = recentCount > 0 ? '#00ff00' : undefined;
}
function deactivate() {
    statusBarItem.dispose();
}
//# sourceMappingURL=extension.js.map