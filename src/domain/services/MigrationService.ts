import { GitHubPort } from "../ports/GitHubPort";
import { JiraPort } from "../ports/JiraPort";
import { MigrationIssue, Attachment, Comment } from "../models/Issue";
import { MigrationResult } from "../models/MigrationResult";
import type { GitHubAttachment } from "../models/GitHubClientModels";

export interface IssueMigrationOptions {
  statusOptionMap: Record<string, string>;
  priorityOptionMap: Record<string, string>;
  issueTypeMap: Record<string, string>;
  defaultPriorityOption?: string;
}

export class IssueMigrationService {
  constructor(
    private jira: JiraPort,
    private github: GitHubPort,
    private opts: IssueMigrationOptions
  ) {}

  /**
   * Compose a full Issue by fetching core data, attachments, comments,
   * and applying type to label mapping.
   */
  private async composeFullIssue(key: string): Promise<MigrationIssue> {
    const issue = await this.jira.getIssue(key);
    issue.attachments = await this.jira.getAttachments(key);
    issue.comments = await this.jira.getComments(key);

    const mappedStatusOptionId = this.opts.statusOptionMap[issue.status];
    const mappedPriorityOptionId =
      this.opts.priorityOptionMap[issue.priority!] ??
      this.opts.defaultPriorityOption!;

    return {
      ...issue,
      mappedStatusOptionId,
      mappedPriorityOptionId,
    };
  }

  /**
   * Batch-migrate Jira issues by JQL:
   * Phase 1: create GitHub issues and build a Jira→GH map.
   * Phase 2: sync project fields, map attachments, patch description & comments, closing.
   * Phase 3: process pending relations.
   */
  async migrateIssuesByQuery(jql: string): Promise<MigrationResult[]> {
    // Phase 1: fetch from Jira and create GitHub issues
    const jiraList = await this.jira.getIssuesByQuery(jql);
    const creations = await Promise.all(
      jiraList.map(async (ji) => {
        const issue = await this.composeFullIssue(ji.key);
        const result = await this.github.createIssue(issue);
        return { key: ji.key, issue, result };
      })
    );

    const jiraToGh: Record<string, number> = {};
    for (const { key, result } of creations) {
      if (result.success && result.githubIssueNumber) {
        jiraToGh[key] = result.githubIssueNumber;
      }
    }

    // Phase 2: project fields, map attachments, patch description & comments, closing
    await Promise.all(
      creations.map(async ({ issue, result }) => {
        if (!result.success || !result.githubIssueNumber) return;
        const ghNum = result.githubIssueNumber!;

        const itemId = await this.github.addIssueToProject(ghNum);
        if (itemId) {
          await this.github.updateProjectIssueFields(
            itemId,
            issue.mappedStatusOptionId,
            issue.mappedPriorityOptionId
          );
        }

        const attachmentMap = await this.uploadAttachments(
          ghNum,
          issue.attachments ?? []
        );

        if (result.body) {
          const patched = this.patchMarkdown(result.body, attachmentMap);
          if (patched !== result.body) {
            await this.github.updateIssue(ghNum, { body: patched });
          }
        }

        for (const cm of issue.comments ?? []) {
          const patchedBody = this.patchMarkdown(cm.body, attachmentMap);
          await this.github.addComment(ghNum, { ...cm, body: patchedBody });
        }

        if (issue.status.toLowerCase() === "done") {
          await this.github.closeIssue(ghNum);
        }
      })
    );

    // Phase 3: sub‐issues & links
    await this.processRelations(
      jiraToGh,
      creations.map(({ issue, result }) => ({ issue, result }))
    );

    return creations.map(({ result }) => ({
      success: result.success,
      githubIssueNumber: result.githubIssueNumber,
      url: result.url,
    }));
  }

  private patchMarkdown(
    raw: string,
    attachmentMap: Record<string, GitHubAttachment>
  ): string {
    const text = raw.replace(/\r\n/g, "\n");
    return text.replace(/!\[([^\]]*)\]\(([^)]+)\)/gm, (_, alt, id) =>
      attachmentMap[id]
        ? `![${alt}](${attachmentMap[id].url})`
        : `![${alt}](${id})`
    );
  }

  private async uploadAttachments(
    issueNumber: number,
    attachments: Attachment[]
  ): Promise<Record<string, GitHubAttachment>> {
    const map: Record<string, GitHubAttachment> = {};

    for (const att of attachments) {
      const buf = await this.jira.downloadAttachment(att.contentUrl);
      const ghAtt = await this.github.uploadAttachment(
        issueNumber,
        buf,
        att.filename
      );

      map[att.id] = ghAtt;
      if (att.mediaUuid) {
        map[att.mediaUuid] = ghAtt;
      }
    }

    return map;
  }

  private async processRelations(
    jiraToGh: Record<string, number>,
    issues: Array<{ issue: MigrationIssue; result: MigrationResult }>
  ) {
    type Bucket = { subs: number[]; links: number[]; issue: MigrationIssue };
    const map: Record<number, Bucket> = {};

    for (const { issue, result } of issues) {
      if (!result.success || !result.githubIssueNumber) continue;
      const parent = result.githubIssueNumber;
      map[parent] ||= { subs: [], links: [], issue };

      for (const rel of issue.pendingRelations || []) {
        const child = jiraToGh[rel.targetKey];
        if (!child) continue;
        if (rel.relType === "sub_issue") {
          map[parent].subs.push(child);
        } else {
          map[parent].links.push(child);
        }
      }
    }

    for (const [parentStr, { subs, links, issue }] of Object.entries(map)) {
      const parent = Number(parentStr);

      for (const child of subs) {
        await this.github.addSubIssue(parent, child);
      }

      for (const child of links) {
        // if you have a method for plain issue links, call it here
        // await this.github.addIssueLink(parent, child);
      }
    }
  }
}
