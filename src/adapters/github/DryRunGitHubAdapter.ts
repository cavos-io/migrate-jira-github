import { GitHubPort } from "../../domain/ports/GitHubPort";
import { Issue, Comment } from "../../domain/models/Issue";
import { MigrationResult } from "../../domain/models/MigrationResult";
import { GitHubAttachment } from "../../domain/models/GitHubClientModels";

export class DryRunGitHubAdapter implements GitHubPort {
  async createIssue(issue: Issue): Promise<MigrationResult> {
    const url = `dry-run://issues/1`;
    const bodyWithMeta = [
      `*Originally by @${issue.creator} on ${issue.createdAt.toISOString()}*`,
      ``,
      issue.description || "",
    ].join("\n");
    console.log(`[DryRun] would create GitHub issue: ${issue.title}`);
    return MigrationResult.success(-1, url, bodyWithMeta);
  }

  async updateIssue(issueNumber: number, params: any): Promise<void> {
    console.log(`[DryRun] would update issue #${issueNumber}`, params);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    console.log(`[DryRun] would close issue #${issueNumber}`);
  }

  async uploadAttachment(
    issueNumber: number,
    fileBuffer: Buffer,
    filename: string
  ): Promise<GitHubAttachment> {
    console.log(
      `[DryRun] would upload attachment to #${issueNumber}: ${filename}`
    );
    return { id: issueNumber, url: `dry-run://attachment/${filename}` };
  }

  async addComment(issueNumber: number, comment: Comment): Promise<Comment> {
    console.log(`[DryRun] would add comment to #${issueNumber}:`, comment.body);
    return { ...comment, id: `dry-run-${issueNumber}` };
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    console.log(`[DryRun] would update comment #${commentId}:`, body);
  }

  async addSubIssue(parentNumber: number, childNumber: number): Promise<void> {
    console.log(
      `[DryRun] would add sub-issue #${childNumber} under parent #${parentNumber}`
    );
    return Promise.resolve();
  }

  async addIssueToProject(issueNumber: number): Promise<string> {
    console.log(`[DryRun] would add issue #${issueNumber} to project`);
    return `dry-run-item-${issueNumber}`;
  }

  async updateProjectIssueFields(
    itemId: string,
    statusOptionId?: string,
    priorityOptionId?: string
  ): Promise<void> {
    console.log(`[DryRun] would set project fields on ${itemId}:`, {
      statusOptionId,
      priorityOptionId,
    });
  }
}
