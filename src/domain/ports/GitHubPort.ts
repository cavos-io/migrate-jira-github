import { Issue, Comment } from "../models/Issue";
import { MigrationResult } from "../models/MigrationResult";
import {
  GitHubIssueUpdateParams,
  GitHubAttachment,
} from "../models/GitHubClientModels";

export interface GitHubPort {
  createIssue(issue: Issue): Promise<MigrationResult>;
  updateIssue(
    issueNumber: number,
    params: GitHubIssueUpdateParams
  ): Promise<void>;
  closeIssue(issueNumber: number): Promise<void>;
  uploadAttachment(
    issueNumber: number,
    fileBuffer: Buffer,
    filename: string
  ): Promise<GitHubAttachment>;
  addComment(issueNumber: number, comment: Comment): Promise<Comment>;
  updateComment(commentId: number, body: string): Promise<void>;
  addSubIssue(parentNumber: number, childNumber: number): Promise<void>;
  addIssueToProject(issueNumber: number): Promise<string | undefined>;
  updateProjectIssueFields(
    itemId: string,
    statusOptionId?: string,
    priorityOptionId?: string
  ): Promise<void>;
}
