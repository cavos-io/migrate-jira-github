import { ghConfig } from "../config.js";

export class IssueMigrator {
  constructor(
    jiraClient,
    githubClient,
    issueTypeMap,
    priorityOptionMap,
    statusOptionMap,
    userMap
  ) {
    this.jira = jiraClient;
    this.gh = githubClient;
    this.issueTypeMap = issueTypeMap;
    this.priorityOptionMap = priorityOptionMap;
    this.statusOptionMap = statusOptionMap;
    this.userMap = userMap;
    this.keyToNumber = new Map();

    // track any related‐links we couldn't yet resolve
    this.pendingRelations = [];

    // Use centralized GitHub configuration
    this.owner = ghConfig.owner;
    this.repo = ghConfig.repo;
    this.projectV2StatusFieldId = ghConfig.projectV2StatusFieldId;
    this.projectV2PriorityFieldId = ghConfig.projectV2PriorityFieldId;
    this.defaultPriorityOption = ghConfig.defaultPriorityOption;
  }

  /**
   * Flatten ADF (Atlassian Document Format) or pass-through strings.
   */
  extractText(adf) {
    if (!adf) return "";
    if (typeof adf === "string") return adf;
    return (
      adf.content
        .map((block) =>
          (block.content || [])
            .filter((node) => typeof node.text === "string")
            .map((node) => node.text)
            .join("")
        )
        .filter(Boolean)
        .join("\n\n") || ""
    );
  }

  /**
   * Fetch and migrate all Jira issues, parents before subtasks.
   */
  async migrate() {
    const issues = await this.jira.fetchAllIssues();

    // Sort so that parent issues run before their subtasks
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

    // Patch any pending relations
    await this._patchPendingRelations();
  }

  /**
   * Handle migration of a single issue.
   */
  async _migrateSingle(issue) {
    const { key, fields } = issue;
    const isSubtask = Boolean(fields.issuetype.subtask);
    const title = `[${key}] ${fields.summary}`;

    let body = this.extractText(fields.description);
    body = this._appendRelatedIssues(body, fields.issuelinks, key);

    const assignees = this._buildAssignees(fields);
    const labels = this._buildLabels(fields);
    const type =
      this.issueTypeMap[fields.issuetype.name] || fields.issuetype.name;

    // Create the GitHub issue
    const ghNumber = await this.gh.createIssue({
      title,
      body,
      type,
      labels,
      assignees,
    });
    this.keyToNumber.set(key, ghNumber);

    // Add to project and set fields
    const projectItemId = await this.gh.addIssueToProjectV2(ghNumber);
    await this._updateProjectFields(
      projectItemId,
      fields.status.id,
      fields.priority?.name
    );

    // Migrate comments
    await this._migrateComments(ghNumber, key);

    // Link nested subtask relationships in GitHub
    if (isSubtask && fields.parent) {
      const parentNum = this.keyToNumber.get(fields.parent.key);
      if (parentNum) {
        await this.gh.addSubIssue(parentNum, ghNumber);
        console.log(
          `🔗 Linked subtask ${key} under parent ${fields.parent.key}`
        );
      }
    }

    console.log(
      `${isSubtask ? "📌 Subtask" : "✅ Parent"} ${key} → GH #${ghNumber}`
    );
  }

  /**
   * Build and map labels
   */
  _buildLabels(fields) {
    const set = new Set(fields.labels || []);
    if (fields.issuetype.name === "Bug") {
      set.add("bug");
    }
    return Array.from(set);
  }

  /**
   * Map Jira assignee to GitHub username.
   */
  _buildAssignees(fields) {
    const jiraId = fields.assignee?.accountId;
    const user = jiraId && this.userMap[jiraId];
    return user ? [user] : [];
  }

  /**
   * Update project status and priority fields using ghConfig IDs.
   */
  async _updateProjectFields(itemId, statusId, priorityName) {
    if (!itemId) return;

    const statusOption = this.statusOptionMap[statusId];
    if (statusOption) {
      await this.gh.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2StatusFieldId,
        statusOption
      );
    }

    const priorityOption =
      this.priorityOptionMap[priorityName] || this.defaultPriorityOption;
    if (priorityOption) {
      await this.gh.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2PriorityFieldId,
        priorityOption
      );
    }
  }

  /**
   * Append all Jira issue-links as “Related” entries in the body.
   */
  _appendRelatedIssues(body, issueLinks = [], sourceKey) {
    if (!Array.isArray(issueLinks) || issueLinks.length === 0) {
      return body;
    }

    const lines = issueLinks
      .filter((link) => link.outwardIssue)
      .map((link) => {
        const jiraKey = link.outwardIssue.key;
        const relType = link.type.name; // e.g. “Blocks”, “Cloners”
        const ghNum = this.keyToNumber.get(jiraKey);

        if (!ghNum) {
          this.pendingRelations.push({ sourceKey, jiraKey, relType });
        }

        const target = ghNum
          ? `[#${ghNum}](https://github.com/${this.owner}/${this.repo}/issues/${ghNum})`
          : jiraKey; // placeholder for now

        return `*${relType} ${target}*`;
      });

    if (lines.length === 0) return body;
    return `${body}\n\n---\n**Related:**\n${lines.join("\n")}`;
  }

  /**
   * Migrate all comments for the given Jira key into the GitHub issue.
   */
  async _migrateComments(ghNumber, jiraKey) {
    const comments = await this.jira.fetchComments(jiraKey);
    const tasks = comments.map((c) => {
      const text = this.extractText(c.body);
      const author = this.userMap[c.author.accountId]
        ? `@${this.userMap[c.author.accountId]}`
        : c.author.displayName;
      const commentBody = `*Comment by ${author} on ${c.created}*\n\n${text}`;
      return this.gh
        .addComment(ghNumber, commentBody)
        .then(() => console.log(`💬 Migrated comment ${c.id} for ${jiraKey}`));
    });
    await Promise.all(tasks);
  }

  /**
   * After every issue has been created, go back and replace any
   * “*Blocks JIRA-123*” placeholders with real GH links.
   */
  async _patchPendingRelations() {
    for (const { sourceKey, jiraKey, relType } of this.pendingRelations) {
      const sourceNum = this.keyToNumber.get(sourceKey);
      const targetNum = this.keyToNumber.get(jiraKey);

      if (sourceNum && targetNum) {
        // fetch current issue body
        const { body: currentBody } = await this.gh.getIssue(sourceNum);
        const placeholder = `*${relType} ${jiraKey}*`;
        const replacement = `*${relType} [#${targetNum}](https://github.com/${this.owner}/${this.repo}/issues/${targetNum})*`;

        const updatedBody = currentBody.replace(
          new RegExp(placeholder, "g"),
          replacement
        );

        await this.gh.updateIssue(sourceNum, { body: updatedBody });
        console.log(
          `🔄 Patched relation ${relType}→${jiraKey} into GH #${sourceNum}`
        );
      } else {
        console.warn(
          `⚠️ Cannot patch ${relType}→${jiraKey} for ${sourceKey}: migration missing`
        );
      }
    }
  }
}
