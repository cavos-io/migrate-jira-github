import { adfToMarkdown } from "../utils/adfConverter";
import type { IJiraClient, IGitHubClient } from "../clients/types";
import type {
  IssueMigratorOptions,
  PendingRelation,
  IssueTypeMap,
  PriorityOptionMap,
  StatusOptionMap,
  UserMap,
} from "./types";

export class IssueMigrator {
  private jira: IJiraClient;
  private _defaultGhClient: IGitHubClient;
  private dryRun: boolean;
  private issueTypeMap: IssueTypeMap;
  private priorityOptionMap: PriorityOptionMap;
  private statusOptionMap: StatusOptionMap;
  private userMap: UserMap;

  private projectV2StatusFieldId?: string;
  private projectV2PriorityFieldId?: string;
  private defaultPriorityOption?: string;

  private keyToNumber: Map<string, number>;
  private pendingRelations: PendingRelation[];
  private _ghClients: Map<string, IGitHubClient>;

  constructor(
    jiraClient: IJiraClient,
    githubClient: IGitHubClient,
    issueTypeMap: IssueTypeMap,
    priorityOptionMap: PriorityOptionMap,
    statusOptionMap: StatusOptionMap,
    userMap: UserMap,
    options: IssueMigratorOptions = {}
  ) {
    this.jira = jiraClient;
    this._defaultGhClient = githubClient;
    this.dryRun = options.dryRun ?? false;
    this.issueTypeMap = issueTypeMap;
    this.priorityOptionMap = priorityOptionMap;
    this.statusOptionMap = statusOptionMap;
    this.userMap = userMap;

    this.projectV2StatusFieldId = githubClient.projectV2StatusFieldId;
    this.projectV2PriorityFieldId = githubClient.projectV2PriorityFieldId;
    this.defaultPriorityOption = githubClient.defaultPriorityOption;

    this.keyToNumber = new Map();
    this.pendingRelations = [];

    this._ghClients = new Map([[githubClient.authToken, githubClient]]);
  }

  /** get or create a GitHubClient for `token` */
  private _getGhClient(token: string): IGitHubClient {
    if (!token) throw new Error("No GitHub token provided");
    if (!this._ghClients.has(token)) {
      const baseConfig = {
        owner: this._defaultGhClient.owner,
        repo: this._defaultGhClient.repo,
        projectV2Id: this._defaultGhClient.projectV2Id,
        projectV2StatusFieldId: this.projectV2StatusFieldId,
        projectV2PriorityFieldId: this.projectV2PriorityFieldId,
        defaultPriorityOption: this.defaultPriorityOption,
        token,
      };
      const client = new (this._defaultGhClient.constructor as any)(
        baseConfig
      ) as IGitHubClient;

      if (this.dryRun) {
        import("../utils/dryRun").then(({ default: applyDryRunToClient }) => {
          applyDryRunToClient(client);
        });
      }
      this._ghClients.set(token, client);
    }
    return this._ghClients.get(token)!;
  }

  async migrate(): Promise<void> {
    const issues = await this.jira.fetchAllIssues();
    issues.sort(
      (a, b) =>
        Number(a.fields.issuetype.subtask) - Number(b.fields.issuetype.subtask)
    );
    for (const issue of issues) {
      try {
        await this._migrateSingle(issue);
      } catch (err) {
        console.error(`Failed migrating ${issue.key}:`, err);
      }
    }
    await this._patchPendingRelations();
  }

  private async _migrateSingle(issue: any): Promise<void> {
    const { key, fields } = issue;
    const isSubtask = Boolean(fields.issuetype.subtask);

    // build the issue body
    let body = adfToMarkdown(fields.description, this.userMap);
    const jiraKeyPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
    let ref;
    while ((ref = jiraKeyPattern.exec(body)) !== null) {
      const otherKey = ref[1];
      if (otherKey !== key && !this.keyToNumber.has(otherKey)) {
        // we haven’t seen this target yet, queue it
        this.pendingRelations.push({
          sourceKey: key,
          jiraKey: otherKey,
          relType: "ref",
        });
      }
    }

    // choose a GitHub token: personal if mapped, else default
    const creatorId = fields.creator?.accountId;
    const ghUsername = creatorId && this.userMap[creatorId];
    const personalTokens = this._defaultGhClient.personalTokens || {};
    const token =
      (ghUsername && personalTokens[ghUsername]) ||
      this._defaultGhClient.authToken;
    const ghClient = this._getGhClient(token);

    // if using default, annotate original author
    if (!ghUsername || !personalTokens[ghUsername]) {
      const displayName = fields.creator?.displayName || creatorId;
      body = `*Originally created by ${displayName} in Jira*\n\n${body}`;
      console.warn(`No personal token for ${creatorId}; using default token`);
    }

    // append any related-links placeholder
    body = this._appendRelatedIssues(body, fields.issuelinks, key);

    // create the GH issue
    const title = `[${key}] ${fields.summary}`;
    const labels = this._buildLabels(fields);
    const assignees = this._buildAssignees(fields);
    const type =
      this.issueTypeMap[fields.issuetype.name] || fields.issuetype.name;

    const ghNumber = await ghClient.createIssue({
      title,
      body,
      type,
      labels,
      assignees,
    });
    this.keyToNumber.set(key, ghNumber);

    // migrate attachments
    const jiraAttachments = await this.jira.fetchAttachments(key);
    const urlMap: Record<string, string> = {};
    await Promise.all(
      jiraAttachments.map(async (a) => {
        try {
          const arrayBuf = await this.jira.downloadAttachment(a.content);
          const buf = Buffer.from(arrayBuf);
          const { url } = await ghClient.uploadAttachment(
            ghNumber,
            buf,
            a.filename,
            a.mimeType
          );
          urlMap[a.content] = url;
        } catch (err) {
          console.error(
            `❌ Failed processing attachment "${a.filename}" on ${key}:`,
            err
          );
        }
      })
    );

    let newBody = body;
    for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
      newBody = newBody.replace(new RegExp(escapeRegExp(oldUrl), "g"), newUrl);
    }

    if (newBody !== body) {
      await ghClient.updateIssue(ghNumber, { body: newBody });
    }

    // add to project & set status/priority
    const projectItemId = await ghClient.addIssueToProjectV2(ghNumber);
    await this._updateProjectFields(
      ghClient,
      projectItemId,
      fields.status.id,
      fields.priority?.name
    );

    // migrate comments
    await this._migrateComments(ghNumber, key, urlMap);

    // link subtasks under parent
    if (isSubtask && fields.parent) {
      const parentNum = this.keyToNumber.get(fields.parent.key);
      if (parentNum) {
        await ghClient.addSubIssue(parentNum, ghNumber);
        console.log(
          `🔗 Linked subtask ${key} under parent ${fields.parent.key}`
        );
      } else {
        this.pendingRelations.push({
          sourceKey: fields.parent.key,
          jiraKey: key,
          relType: "subtask",
        });
      }
    }

    // close if Jira was Done
    if (fields.status?.statusCategory?.name === "Done") {
      await ghClient.updateIssue(ghNumber, {
        state: "closed",
        state_reason: "completed",
      });
      console.log(`🔒 Closed GH #${ghNumber}`);
    }

    console.log(
      `${isSubtask ? "📌 Subtask" : "✅ Parent"} ${key} → GH #${ghNumber}`
    );
  }

  private _buildLabels(fields: any): string[] {
    const set = new Set<string>(fields.labels || []);
    if (fields.issuetype.name === "Bug") set.add("bug");
    return [...set];
  }

  private _buildAssignees(fields: any): string[] {
    const jiraId = fields.assignee?.accountId;
    const user = jiraId && this.userMap[jiraId];
    return user ? [user] : [];
  }

  private async _updateProjectFields(
    ghClient: IGitHubClient,
    itemId: string | undefined,
    statusId: number,
    priorityName?: string
  ): Promise<void> {
    if (!itemId) return;
    const statusOpt = this.statusOptionMap[String(statusId)];
    if (statusOpt) {
      await ghClient.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2StatusFieldId!,
        statusOpt
      );
    }
    const prioOpt =
      this.defaultPriorityOption ??
      (priorityName ? this.priorityOptionMap[priorityName] : undefined);
    if (prioOpt) {
      await ghClient.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2PriorityFieldId!,
        prioOpt
      );
    }
  }

  private _appendRelatedIssues(
    body: string,
    issueLinks: any[] = [],
    sourceKey: string
  ): string {
    if (!Array.isArray(issueLinks) || issueLinks.length === 0) return body;

    const lines = issueLinks
      .filter((link) => link.outwardIssue)
      .map((link) => {
        const jiraKey = link.outwardIssue.key;
        const relType = link.type.name;
        const ghNum = this.keyToNumber.get(jiraKey);

        if (!ghNum) {
          this.pendingRelations.push({ sourceKey, jiraKey, relType });
          return `*${relType} ${jiraKey}*`;
        }

        return `*${relType} [#${ghNum}](https://github.com/${this._defaultGhClient.owner}/${this._defaultGhClient.repo}/issues/${ghNum})*`;
      });

    return lines.length
      ? `${body}\n\n---\n**Related:**\n${lines.join("\n")}`
      : body;
  }

  private async _migrateComments(
    ghNumber: number,
    jiraKey: string,
    urlMap: Record<string, string>
  ): Promise<void> {
    const comments = await this.jira.fetchComments(jiraKey);

    for (const c of comments) {
      // 1) convert ADF → markdown and rewrite attachment URLs
      let text = adfToMarkdown(c.body, this.userMap);
      for (const [oldUrl, newUrl] of Object.entries(urlMap)) {
        text = text.replace(new RegExp(escapeRegExp(oldUrl), "g"), newUrl);
      }

      // 2) scan for bare JIRA-refs and queue any we can’t link yet
      const jiraKeyPattern = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
      let m;
      while ((m = jiraKeyPattern.exec(text)) !== null) {
        const otherKey = m[1];
        const ghNum = this.keyToNumber.get(otherKey);
        if (ghNum) {
          // already migrated → replace inline now
          const ghLink = `[#${ghNum}](https://github.com/${this._defaultGhClient.owner}/${this._defaultGhClient.repo}/issues/${ghNum})`;
          text = text.replace(new RegExp(`\\b${otherKey}\\b`, "g"), ghLink);
        } else {
          // queue for later
          this.pendingRelations.push({
            sourceCommentId: undefined,
            jiraKey: otherKey,
            relType: "ref_in_comment",
          });
        }
      }

      // 3) prefix with author and timestamp
      const jiraId = c.author.accountId;
      const ghUsername = this.userMap[jiraId];
      const authorMention = ghUsername
        ? `@${ghUsername}`
        : c.author.displayName;
      const prefix = ghUsername
        ? `*Comment by ${authorMention} on ${c.created}*\n\n`
        : `*Comment by ${c.author.displayName} in Jira*\n\n`;

      // 4) post it
      const client = this._getGhClient(
        (ghUsername && this._defaultGhClient.personalTokens[ghUsername]) ||
          this._defaultGhClient.authToken
      );
      const { id: commentId } = await client.addComment(
        ghNumber,
        prefix + text
      );

      // 5) back-patch any pendingRelations entries to include this commentId
      this.pendingRelations = this.pendingRelations.map((rel) => {
        if (rel.relType === "ref_in_comment" && rel.sourceCommentId == null) {
          return { ...rel, sourceCommentId: commentId };
        }
        return rel;
      });

      console.log(`💬 Migrated comment ${c.id} → GH comment ${commentId}`);
    }
  }

  private async _patchPendingRelations(): Promise<void> {
    const client = this._defaultGhClient;

    for (const rel of this.pendingRelations) {
      const { sourceKey, sourceCommentId, jiraKey, relType } = rel;
      const targetNum = this.keyToNumber.get(jiraKey);
      if (!targetNum) {
        console.warn(`⚠️ Missing target for ${relType}→${jiraKey}`);
        continue;
      }

      if (relType === "ref_in_comment" && sourceCommentId) {
        // fetch the comment
        const { body: currentBody } = await client.getComment(sourceCommentId);
        const ghLink = `[#${targetNum}](https://github.com/${client.owner}/${client.repo}/issues/${targetNum})`;
        const updatedBody = currentBody.replace(
          new RegExp(`\\b${jiraKey}\\b`, "g"),
          ghLink
        );
        if (updatedBody !== currentBody) {
          await client.updateComment(sourceCommentId, { body: updatedBody });
          console.log(
            `🔄 Patched comment ${sourceCommentId}: ${jiraKey} → #${targetNum}`
          );
        }
      } else if (sourceKey) {
        // your existing issue‐body patch logic
        const sourceNum = this.keyToNumber.get(sourceKey);
        if (!sourceNum) continue;
        const { body: currentBody } = await client.getIssue(sourceNum);
        let updatedBody;

        // ref in body
        if (relType === "ref") {
          const ghLink = `[#${targetNum}](https://github.com/${client.owner}/${client.repo}/issues/${targetNum})`;
          updatedBody = currentBody.replace(
            new RegExp(`\\b${jiraKey}\\b`, "g"),
            ghLink
          );

          // other structured placeholders
        } else {
          const placeholder = `*${relType} ${jiraKey}*`;
          const replacement = `*${relType} [#${targetNum}](https://github.com/${client.owner}/${client.repo}/issues/${targetNum})*`;
          updatedBody = currentBody.replace(
            new RegExp(escapeRegExp(placeholder), "g"),
            replacement
          );
        }

        if (updatedBody !== currentBody) {
          await client.updateIssue(sourceNum, { body: updatedBody });
          console.log(
            `🔄 Patched issue ${sourceNum}: ${relType} ${jiraKey} → #${targetNum}`
          );
        }
      }
    }
  }
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
