import * as vscode from 'vscode';
import minimatch = require('minimatch');

export class Config {
  static get agentName(): string {
    return vscode.workspace.getConfiguration('q-git-ai').get<string>('agentName') || 'amazon-q';
  }

  static get minChangeSize(): number {
    return vscode.workspace.getConfiguration('q-git-ai').get<number>('minChangeSize') || 3;
  }

  static get allowRepositories(): string[] {
    return vscode.workspace.getConfiguration('q-git-ai').get<string[]>('allow_repositories') || ['*'];
  }

  static get excludeRepositories(): string[] {
    return vscode.workspace.getConfiguration('q-git-ai').get<string[]>('exclude_repositories') || [];
  }

  static isRepositoryAllowed(repoRoot: string): boolean {
    const allowPatterns = this.allowRepositories;
    const excludePatterns = this.excludeRepositories;

    // Normalize path for glob matching
    const normalizedPath = repoRoot.replace(/\\/g, '/');

    // Check exclude first
    for (const pattern of excludePatterns) {
      if (minimatch(normalizedPath, pattern)) {
        console.log(`[q-git-ai] Repository excluded by pattern ${pattern}: ${repoRoot}`);
        return false;
      }
    }

    // Check allow
    for (const pattern of allowPatterns) {
      if (minimatch(normalizedPath, pattern)) {
        return true;
      }
    }

    console.log(`[q-git-ai] Repository not allowed: ${repoRoot}`);
    return false;
  }
}
