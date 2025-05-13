import { Issue, Attachment, Comment } from "../models/Issue";

export interface JiraPort {
  getIssue(issueKey: string): Promise<Issue>;
  getIssuesByQuery(jql: string): Promise<Issue[]>;
  getAttachments(issueKey: string): Promise<Attachment[]>;
  downloadAttachment(contentUrl: string): Promise<Buffer>;
  getComments(issueKey: string): Promise<Comment[]>;
}
