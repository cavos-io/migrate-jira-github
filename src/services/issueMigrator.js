export class IssueMigrator {
  constructor(
    jiraClient,
    githubClient,
    issueTypeMap,
    priorityOptionMap,
    statusOptionMap,
    userMap,
    options = {}
  ) {
    this.jira = jiraClient;
    this._defaultGhClient = githubClient;
    this.dryRun = options.dryRun || false;
    this.issueTypeMap = issueTypeMap;
    this.priorityOptionMap = priorityOptionMap;
    this.statusOptionMap = statusOptionMap;
    this.userMap = userMap;

    // carry over project-level IDs & defaults from the default client
    this.projectV2StatusFieldId = githubClient.projectV2StatusFieldId;
    this.projectV2PriorityFieldId = githubClient.projectV2PriorityFieldId;
    this.defaultPriorityOption = githubClient.defaultPriorityOption;

    // mapping JIRA key to newly created GH number
    this.keyToNumber = new Map();
    // store relations that couldn’t be linked until all issues exist
    this.pendingRelations = [];

    // cache GitHubClient instances by token (string to instance)
    this._ghClients = new Map([[githubClient.authToken, githubClient]]);
  }

  /** get or create a GitHubClient for `token` */
  _getGhClient(token) {
    if (!token) throw new Error("No GitHub token provided");
    if (!this._ghClients.has(token)) {
      // baseConfig comes from your default client
      const baseConfig = {
        owner: this._defaultGhClient.owner,
        repo: this._defaultGhClient.repo,
        projectV2Id: this._defaultGhClient.projectV2Id,
        projectV2StatusFieldId: this.projectV2StatusFieldId,
        projectV2PriorityFieldId: this.projectV2PriorityFieldId,
        defaultPriorityOption: this.defaultPriorityOption,
        token,
      };
      const client = new this._defaultGhClient.constructor(baseConfig);

      if (this.dryRun) {
        import("../utils/dryRun.js").then(
          ({ default: applyDryRunToClient }) => {
            applyDryRunToClient(client);
          }
        );
      }

      this._ghClients.set(token, client);
    }
    return this._ghClients.get(token);
  }

  extractText(adf) {
    if (!adf) return "";
    if (typeof adf === "string") return adf;
    // simple one-level ADF flatten
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

  async migrate() {
    const issues = await this.jira.fetchAllIssues();

    // ensure parents before subtasks
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

  async _migrateSingle(issue) {
    const { key, fields } = issue;
    const isSubtask = Boolean(fields.issuetype.subtask);

    // build the issue body
    let body = this.extractText(fields.description);

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

    // add to project & set status/priority
    const projectItemId = await ghClient.addIssueToProjectV2(ghNumber);
    await this._updateProjectFields(
      ghClient,
      projectItemId,
      fields.status.id,
      fields.priority?.name
    );

    // migrate comments
    await this._migrateComments(ghNumber, key);

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

  _buildLabels(fields) {
    const set = new Set(fields.labels || []);
    if (fields.issuetype.name === "Bug") set.add("bug");
    return [...set];
  }

  _buildAssignees(fields) {
    const jiraId = fields.assignee?.accountId;
    const user = jiraId && this.userMap[jiraId];
    return user ? [user] : [];
  }

  async _updateProjectFields(ghClient, itemId, statusId, priorityName) {
    if (!itemId) return;
    const statusOpt = this.statusOptionMap[String(statusId)];
    if (statusOpt) {
      await ghClient.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2StatusFieldId,
        statusOpt
      );
    }
    const prioOpt =
      this.priorityOptionMap[priorityName] || this.defaultPriorityOption;
    if (prioOpt) {
      await ghClient.updateProjectV2ItemFieldValue(
        itemId,
        this.projectV2PriorityFieldId,
        prioOpt
      );
    }
  }

  _appendRelatedIssues(body, issueLinks = [], sourceKey) {
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

  async _migrateComments(ghNumber, jiraKey) {
    const comments = await this.jira.fetchComments(jiraKey);

    await Promise.all(
      comments.map(async (c) => {
        const text = this.extractText(c.body);
        const jiraId = c.author.accountId;
        const ghUsername = this.userMap[jiraId];
        const personalTokens = this._defaultGhClient.personalTokens || {};
        const token =
          (ghUsername && personalTokens[ghUsername]) ||
          this._defaultGhClient.authToken;
        const client = this._getGhClient(token);

        if (!ghUsername || !personalTokens[ghUsername]) {
          console.warn(
            `No personal token for comment author ${jiraId}; using default token`
          );
        }

        const authorMention = ghUsername
          ? `@${ghUsername}`
          : c.author.displayName;
        const prefix = ghUsername
          ? `*Comment by ${authorMention} on ${c.created}*\n\n`
          : `*Comment by ${c.author.displayName} in Jira*\n\n*Comment by ${authorMention} on ${c.created}*\n\n`;

        await client.addComment(ghNumber, prefix + text);
        console.log(`💬 Migrated comment ${c.id} for ${jiraKey}`);
      })
    );
  }

  async _patchPendingRelations() {
    for (const { sourceKey, jiraKey, relType } of this.pendingRelations) {
      const sourceNum = this.keyToNumber.get(sourceKey);
      const targetNum = this.keyToNumber.get(jiraKey);
      if (sourceNum && targetNum) {
        const client = this._defaultGhClient;
        const { body: currentBody } = await client.getIssue(sourceNum);
        const placeholder = `*${relType} ${jiraKey}*`;
        const replacement = `*${relType} [#${targetNum}](https://github.com/${client.owner}/${client.repo}/issues/${targetNum})*`;
        const updatedBody = currentBody.replace(
          new RegExp(placeholder, "g"),
          replacement
        );
        await client.updateIssue(sourceNum, { body: updatedBody });
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
