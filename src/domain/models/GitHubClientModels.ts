export interface GitHubIssueParams {
  title: string;
  body: string;
  type: string;
  labels?: string[];
  assignees?: string[];
}

export interface GitHubIssueUpdateParams {
  body?: string;
  labels?: string[];
  assignees?: string[];
  state?: "open" | "closed";
  state_reason?: "completed" | "not_planned" | "reopened" | null;
}

export interface GitHubComment {
  id: number;
  body: string;
}

export interface GitHubAttachment {
  id: number;
  url: string;
}
