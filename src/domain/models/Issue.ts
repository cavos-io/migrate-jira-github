import { PendingRelation } from "./PendingRelation";

export interface Issue {
  id: string;
  key: string;
  title: string;
  description?: string;
  status: string;
  priority?: string;
  issueType: string;
  labels: string[];
  assignee?: string;
  creator?: string;
  createdAt: Date;
  updatedAt: Date;
  attachments?: Attachment[];
  comments?: Comment[];
  pendingRelations?: PendingRelation[];
}

export interface Attachment {
  id: string;
  mediaUuid?: string;
  filename: string;
  mimeType: string;
  contentUrl: string;
}

export interface Comment {
  id: string;
  author: string;
  body: string;
  createdAt: Date;
}

export interface MigrationIssue extends Issue {
  mappedStatusOptionId: string;
  mappedPriorityOptionId: string;
}
