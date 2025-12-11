import * as vscode from 'vscode';
import { spawn } from 'child_process';

export function runCommand(command: string, args: string[], cwd: string, showOutput: boolean = false): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(command, args, { cwd, shell: true });

    if (showOutput) {
      proc.stdout?.on('data', (d) => console.log(`[cmd] ${d}`));
      proc.stderr?.on('data', (d) => console.error(`[cmd] ${d}`));
    }

    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Exit code ${code}`));
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
