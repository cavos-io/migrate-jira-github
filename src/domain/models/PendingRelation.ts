export type RelationType = "sub_issue" | "issue_links";

export interface PendingRelation {
  sourceKey?: string;
  targetKey: string;
  relType: RelationType;
  relName?: string;
}
