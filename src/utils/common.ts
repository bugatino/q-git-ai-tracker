import * as vscode from 'vscode';
import { spawn } from 'child_process';

export function runCommand(command: string, args: string[], cwd: string, showOutput: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, shell: true });
    let output = '';

    proc.stdout?.on('data', (d) => {
        const s = d.toString();
        output += s;
        if (showOutput) console.log(`[cmd] ${s}`);
    });
    proc.stderr?.on('data', (d) => {
        const s = d.toString();
        output += s;
        if (showOutput) console.error(`[cmd] ${s}`);
    });

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Command failed with exit code ${code}.\nOutput: ${output.trim().substring(0, 1000)}`)); // Limit output length
    });
  });
}

export function cmdOutput(command: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, shell: true });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (d) => stdout += d.toString());
    proc.stderr?.on('data', (d) => stderr += d.toString());

    proc.on('close', (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`Exit code ${code}: ${stderr}`));
    });
  });
}
