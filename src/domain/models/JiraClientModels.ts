export interface JiraIssue {
  id: string;
  key: string;
  fields: {
    summary: string;
    description: any;
    issuetype: { name: string; subtask: boolean };
    labels: string[];
    status: { id: string; name: string };
    creator: { accountId: string; displayName: string };
    assignee?: { accountId: string };
    attachment?: JiraAttachment[];
    subtasks?: JiraSubtask[];
    parent?: { key: string };
    issuelinks?: JiraIssueLink[];
    priority?: { name: string };
  };
}

export interface JiraAttachment {
  id: string;
  mediaUuid: string;
  filename: string;
  mimeType: string;
  content: string;
}

export interface JiraSubtask {
  id: string;
  key: string;
}

export interface JiraIssueLink {
  type: { name: string };
  outwardIssue?: { key: string };
  inwardIssue?: { key: string };
}

export interface JiraComment {
  id: string;
  author: { accountId: string; displayName: string };
  body: any;
  created: string;
}
