export interface IssueMigratorOptions {
  dryRun?: boolean;
}

export interface PendingRelation {
  sourceKey?: string;
  sourceCommentId?: number;
  jiraKey: string;
  relType: "ref" | "subtask" | "ref_in_comment";
}

export type IssueTypeMap = Record<string, string>;
export type PriorityOptionMap = Record<string, string>;
export type StatusOptionMap = Record<string, string>;
export type UserMap = Record<string, string>;
