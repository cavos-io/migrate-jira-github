import { GitHubPort } from "../../domain/ports/GitHubPort";
import { GitHubClient } from "./GitHubClient";
import { Issue, Comment } from "../../domain/models/Issue";
import { MigrationResult } from "../../domain/models/MigrationResult";
import { GitHubIssueUpdateParams } from "../../domain/models/GitHubClientModels";

export class GitHubAdapter implements GitHubPort {
  constructor(private ghClient: GitHubClient) {}

  async createIssue(issue: Issue): Promise<MigrationResult> {
    try {
      const bodyWithMeta = [
        `*Originally by @${issue.creator} on ${issue.createdAt.toISOString()}*`,
        ``,
        issue.description || "",
      ].join("\n");

      const { number, url } = await this.ghClient.createIssue({
        title: issue.title,
        body: bodyWithMeta,
        type: issue.issueType,
        labels: issue.labels,
        assignees: issue.assignee ? [issue.assignee] : [],
      });

      return MigrationResult.success(number, url, bodyWithMeta);
    } catch (error: any) {
      return MigrationResult.failure([error.message]);
    }
  }

  async updateIssue(
    issueNumber: number,
    params: GitHubIssueUpdateParams
  ): Promise<void> {
    await this.ghClient.updateIssue(issueNumber, params);
  }

  async closeIssue(issueNumber: number): Promise<void> {
    await this.ghClient.updateIssue(issueNumber, { state: "closed" });
  }

  async uploadAttachment(
    issueNumber: number,
    fileBuffer: Buffer,
    filename: string
  ) {
    return await this.ghClient.uploadAttachment(
      issueNumber,
      fileBuffer,
      filename
    );
  }

  async addComment(issueNumber: number, comment: Comment): Promise<Comment> {
    const bodyWithMeta = [
      `*Comment by @${comment.author} on ${comment.createdAt.toISOString()}*`,
      ``,
      comment.body,
    ].join("\n");

    const ghComment = await this.ghClient.addComment(issueNumber, bodyWithMeta);
    return {
      ...comment,
      id: ghComment.id.toString(),
      body: bodyWithMeta,
    };
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.ghClient.updateComment(commentId, body);
  }

  async addSubIssue(parent: number, child: number): Promise<void> {
    return this.ghClient.addSubIssue(parent, child);
  }

  async addIssueToProject(issueNumber: number): Promise<string | undefined> {
    if (!this.ghClient.config.projectV2Id) return undefined;
    return await this.ghClient.addIssueToProject(issueNumber);
  }

  async updateProjectIssueFields(
    itemId: string,
    statusOptionId?: string,
    priorityOptionId?: string
  ): Promise<void> {
    await this.ghClient.updateProjectIssueFields(
      itemId,
      statusOptionId,
      priorityOptionId
    );
  }
}
