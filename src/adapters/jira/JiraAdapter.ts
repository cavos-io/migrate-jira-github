import { adfToMarkdown } from "../../utils/adfConverter";
import { Issue, Attachment, Comment } from "../../domain/models/Issue";
import { JiraClient } from "./JiraClient";
import { JiraIssue } from "../../domain/models/JiraClientModels";
import { JiraPort } from "../../domain/ports/JiraPort";
import { PendingRelation } from "../../domain/models/PendingRelation";
import { IssueTypeMap, UserMap } from "../../domain/models/MappingModels";

export class JiraAdapter implements JiraPort {
  constructor(
    private jiraClient: JiraClient,
    private issueTypeMap: IssueTypeMap,
    private userMap: UserMap
  ) {}

  async getIssue(issueKey: string): Promise<Issue> {
    const jiraIssue = await this.jiraClient.fetchIssue(issueKey);
    return this.mapToIssue(jiraIssue);
  }

  async getIssuesByQuery(jql: string): Promise<Issue[]> {
    const jiraIssues = await this.jiraClient.fetchIssues(jql);
    return jiraIssues.map(this.mapToIssue.bind(this));
  }

  async getAttachments(issueKey: string): Promise<Attachment[]> {
    const raw = await this.jiraClient.fetchAttachments(issueKey);
    const enriched = await Promise.all(
      raw.map(async (a) => {
        const uuid = await this.jiraClient.getMediaUuid(a.id);
        return {
          id: a.id,
          mediaUuid: uuid,
          filename: a.filename,
          mimeType: a.mimeType,
          contentUrl: a.content,
        };
      })
    );

    return enriched;
  }

  async downloadAttachment(contentUrl: string): Promise<Buffer> {
    return await this.jiraClient.downloadAttachment(contentUrl);
  }

  async getComments(issueKey: string): Promise<Comment[]> {
    const jiraComments = await this.jiraClient.fetchComments(issueKey);
    return jiraComments.map((c) => {
      const authorId = c.author.accountId;
      const author = this.userMap[authorId] ?? c.author.displayName;

      return {
        id: c.id,
        author,
        body: adfToMarkdown(c.body, this.userMap),
        createdAt: new Date(c.created),
      };
    });
  }

  private mapToIssue(jiraIssue: JiraIssue): Issue {
    const assigneeId = jiraIssue.fields.assignee?.accountId;
    const assignee = assigneeId ? this.userMap[assigneeId] : undefined;
    const relations: PendingRelation[] = [];

    // creator
    const creatorId = jiraIssue.fields.creator.accountId;
    const creator =
      this.userMap[creatorId] ?? jiraIssue.fields.creator.displayName;

    // issue type & labels
    const issueType =
      this.issueTypeMap[jiraIssue.fields.issuetype.name] ??
      jiraIssue.fields.issuetype.name;
    const labels = Array.from(
      new Set(
        [
          ...jiraIssue.fields.labels,
          jiraIssue.fields.issuetype.name === "Bug" ? "bug" : undefined,
        ].filter(Boolean) as string[]
      )
    );

    // subtasks
    for (const st of jiraIssue.fields.subtasks || []) {
      relations.push({
        sourceKey: jiraIssue.key,
        targetKey: st.key,
        relType: "sub_issue",
      });
    }

    // issue links
    for (const link of jiraIssue.fields.issuelinks || []) {
      if (link.outwardIssue) {
        relations.push({
          sourceKey: jiraIssue.key,
          targetKey: link.outwardIssue.key,
          relType: "issue_links",
          relName: link.type.name,
        });
      }
    }

    return {
      id: jiraIssue.id,
      key: jiraIssue.key,
      title: jiraIssue.fields.summary,
      description: adfToMarkdown(jiraIssue.fields.description, this.userMap),
      status: jiraIssue.fields.status.name,
      priority: jiraIssue.fields.priority?.name,
      issueType,
      labels,
      assignee,
      creator,
      createdAt: new Date(),
      updatedAt: new Date(),
      pendingRelations: relations,
    };
  }
}
