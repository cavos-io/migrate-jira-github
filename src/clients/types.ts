export interface IGitHubClient {
  createIssue(opts: {
    title: string;
    body: string;
    type: string;
    labels: string[];
    assignees: string[];
  }): Promise<number>;

  updateIssue(
    issueNumber: number,
    opts: Partial<{
      body: string;
      state?: "open" | "closed";
      state_reason?: "completed" | "not_planned" | "reopened" | null;
    }>
  ): Promise<void>;

  uploadAttachment(
    issueNumber: number,
    buf: Buffer,
    filename: string,
    mimeType: string
  ): Promise<{
    id: number;
    url: string;
  }>;

  addComment(
    issueNumber: number,
    comment: string
  ): Promise<{ id: number; body: string }>;

  getIssue(issueNumber: number): Promise<{ body: string }>;

  getComment(commentId: number): Promise<{ body: string }>;

  updateComment(commentId: number, opts: { body: string }): Promise<void>;

  addSubIssue(parent: number, child: number): Promise<void>;

  addIssueToProjectV2(issueNumber: number): Promise<string | undefined>;

  updateProjectV2ItemFieldValue(
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void>;

  readonly owner: string;
  readonly repo: string;
  readonly authToken: string;
  readonly personalTokens: Record<string, string>;
  readonly projectV2Id?: string;
  readonly projectV2StatusFieldId?: string;
  readonly projectV2PriorityFieldId?: string;
  readonly defaultPriorityOption?: string;
}

export interface GitHubClientOptions {
  owner: string;
  repo: string;
  token: string;
  projectV2Id?: string;
  projectV2StatusFieldId?: string;
  projectV2PriorityFieldId?: string;
  defaultPriorityOption?: string;
  personalTokens?: Record<string, string>;
}

export interface UploadPolicy {
  form: Record<string, string>;
  upload_url: string;
  asset: { id: number };
  asset_upload_url: string;
  asset_upload_authenticity_token: string;
}

export interface IJiraClient {
  fetchAllIssues(): Promise<any[]>;
  fetchAttachments(issueKey: string): Promise<any[]>;
  downloadAttachment(url: string): Promise<ArrayBuffer>;
  fetchComments(issueKey: string): Promise<any[]>;
}

export interface JiraClientOptions {
  baseUrl: string;
  user: string;
  token: string;
  jql: string;
  pageSize?: number;
}
