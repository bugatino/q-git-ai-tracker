"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = require("vscode");
const child_process_1 = require("child_process");
const path = require("path");
let statusBarItem;
function activate(context) {
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
    context.subscriptions.push(vscode.commands.registerCommand('q-git-ai.manualHumanCheckpoint', manualHumanCheckpoint), vscode.commands.registerCommand('q-git-ai.manualAiCheckpoint', manualAiCheckpoint));
    console.log('[q-git-ai] agent-v1 integration activated');
}
async function onFileChange(uri) {
    if (!isAmazonQActive())
        return;
    // Nếu file đang mở, onTextChange đã handle rồi -> bỏ qua
    const isOpen = vscode.workspace.textDocuments.some(doc => doc.uri.toString() === uri.toString());
    if (isOpen)
        return;
    // Filter noise
    const fsPath = uri.fsPath;
    if (fsPath.includes('node_modules') || fsPath.includes('.git') || fsPath.includes(path.sep + 'out' + path.sep))
        return;
    // Gửi checkpoint cho file không mở
    await sendAiCheckpoint(uri, 'amazon-q');
    bumpStatus();
}
async function onTextChange(event) {
    // Remove strict check for activeTextEditor to support background edits (e.g. Apply to all files)
    // const editor = vscode.window.activeTextEditor;
    // if (!editor || event.document !== editor.document) return;
    if (event.document.uri.scheme !== 'file')
        return;
    if (!isAmazonQActive())
        return;
    const clipboardText = await vscode.env.clipboard.readText();
    const hasLargeChange = event.contentChanges.some((c) => {
        const text = c.text;
        // Detected paste from clipboard -> ignore
        if (text === clipboardText) {
            return false;
        }
        const isMultiLine = text.includes('\n');
        const isFastInsert = c.rangeLength === 0;
        const isLargeEnough = text.length >= 3;
        const hasStructure = /[;{}\[\]()]/.test(text);
        const isTyping = text.length === 1 && !hasStructure;
        return (isMultiLine || isFastInsert) && isLargeEnough && !isTyping;
    });
    if (!hasLargeChange)
        return;
    const doc = event.document;
    // Gửi AI checkpoint tối thiểu cho file này
    // Gửi AI checkpoint tối thiểu cho file này
    await sendAiCheckpoint(doc.uri, 'amazon-q');
    bumpStatus();
}
async function manualHumanCheckpoint() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    await sendHumanCheckpoint(editor.document.uri);
}
async function manualAiCheckpoint() {
    const editor = vscode.window.activeTextEditor;
    if (!editor)
        return;
    await sendAiCheckpoint(editor.document.uri, 'amazon-q-manual');
    bumpStatus();
}
function bumpStatus() {
    const current = parseInt(statusBarItem.text.split(':')[1]?.trim() || '0', 10) || 0;
    statusBarItem.text = `$(git-commit) AI: ${current + 1}`;
}
async function sendHumanCheckpoint(uri) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot)
        return;
    const fileRelPath = path.relative(workspaceRoot, uri.fsPath);
    const payload = {
        type: 'human',
        repo_working_dir: workspaceRoot,
        will_edit_filepaths: [fileRelPath],
    };
    await callGitAiAgentV1(payload);
}
async function sendAiCheckpoint(uri, agentName) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot)
        return;
    const fileRelPath = path.relative(workspaceRoot, uri.fsPath);
    const payload = {
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
async function callGitAiAgentV1(payload) {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceRoot)
        return;
    const hookInput = JSON.stringify(payload);
    console.log('[q-git-ai] calling git-ai checkpoint agent-v1 with:', hookInput);
    return new Promise((resolve) => {
        const proc = (0, child_process_1.spawn)('git-ai', ['checkpoint', 'agent-v1', '--hook-input', hookInput], {
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
function isAmazonQActive() {
    const qExt = vscode.extensions.getExtension('AmazonWebServices.amazon-q-vscode');
    return !!qExt?.isActive;
}
function deactivate() {
    statusBarItem.dispose();
}
//# sourceMappingURL=extension.js.map