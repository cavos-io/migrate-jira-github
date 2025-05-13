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
  }

  /**
   * Handle migration of a single issue.
   */
  async _migrateSingle(issue) {
    const { key, fields } = issue;
    const isSubtask = Boolean(fields.issuetype.subtask);
    const title = `[${key}] ${fields.summary}`;
    let body = this.extractText(fields.description);
    const assignees = this._buildAssignees(fields);
    const labels = this._buildLabels(fields);
    const type =
      this.issueTypeMap[fields.issuetype.name] || fields.issuetype.name;

    // If subtask, append a link to its parent
    if (isSubtask && fields.parent) {
      const parentNum = this.keyToNumber.get(fields.parent.key);
      if (parentNum) {
        body += `\n\n*Parent: [#${parentNum}](https://github.com/${this.owner}/${this.repo}/issues/${parentNum})*`;
      }
    }

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
}
