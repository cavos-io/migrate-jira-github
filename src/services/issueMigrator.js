export class IssueMigrator {
  constructor(
    jiraClient,
    githubClient,
    issueTypeMap,
    statusOptionMap,
    userMap
  ) {
    this.jira = jiraClient;
    this.gh = githubClient;
    this.issueTypeMap = issueTypeMap;
    this.statusOptionMap = statusOptionMap;
    this.userMap = userMap;
    this.keyToNumber = new Map();
  }

  /**
   * Flatten a minimal ADF document into plain text.
   */
  extractTextFromADF(adf) {
    if (!adf || !Array.isArray(adf.content)) return "";
    return (
      adf.content
        .map((block) => {
          if (!Array.isArray(block.content)) return "";
          // join all `text` fields in this block
          return block.content
            .filter((node) => typeof node.text === "string")
            .map((node) => node.text)
            .join("");
        })
        // drop empty strings and separate blocks with a blank line
        .filter(Boolean)
        .join("\n\n")
    );
  }

  async migrate() {
    const issues = await this.jira.fetchAllIssues();

    // ensure parents come before subtasks
    issues.sort((a, b) => {
      const aSub = a.fields.issuetype.subtask ? 1 : 0;
      const bSub = b.fields.issuetype.subtask ? 1 : 0;
      return aSub - bSub;
    });

    for (const issue of issues) {
      await this._migrateSingle(issue);
    }
  }

  async _migrateSingle(issue) {
    const { key, fields } = issue;
    const isSub = fields.issuetype.subtask;
    const title = `[${key}] ${fields.summary}`;

    // map Jira issueType to Github type
    const issueType = fields.issuetype.name;
    const type = this.issueTypeMap[issueType] || issueType;
    const labels = [...fields.labels];

    // and if it's a Bug, add the 'bug' label (no dupes)
    if (issueType === "Bug" && !labels.includes("bug")) {
      labels.push("bug");
    }

    // map Jira accountId to GitHub username
    const jiraId = fields.assignee?.accountId;
    const ghUser = jiraId ? this.userMap[jiraId] : undefined;
    const assignees = ghUser ? [ghUser] : [];

    // grab raw description
    const rawDesc = fields.description;
    let body = "";

    // coerce to string
    if (!rawDesc) {
      body = "";
    } else if (typeof rawDesc === "string") {
      body = rawDesc;
    } else {
      // assume Atlassian Document Format (ADF)
      body = this.extractTextFromADF(rawDesc);
    }

    // if subtask, append parent link
    if (isSub) {
      const parentKey = fields.parent.key;
      const parentNum = this.keyToNumber.get(parentKey);
      // Concept to handle related issue on Jira
      // Todo: relate real issues
      if (parentNum) {
        body += `\n\n*Parent: [#${parentNum}](https://github.com/${process.env.GH_OWNER}/${process.env.GH_REPO}/issues/${parentNum})*`;
      }
    }

    // create issue on GitHub
    const ghNum = await this.gh.createIssue({
      title,
      body,
      type,
      labels,
      assignees,
    });

    // add into Projects
    const projectItemId = await this.gh.addIssueToProjectV2(ghNum);

    // grab the Jira status ID:
    const jiraStatusId = fields.status.id;

    // look up the GH option ID:
    const optionId = this.statusOptionMap[jiraStatusId];
    if (optionId) {
      await this.gh.updateProjectV2ItemFieldValue(
        projectItemId,
        process.env.GH_PROJECT_V2_STATUS_FIELD_ID,
        optionId
      );
      console.log(`🏷️  Set project “Status” → ${optionId}`);
    } else {
      console.warn(`⚠️  No mapping for Jira status ${jiraStatusId}`);
    }

    // fetch and migrate comments
    const comments = await this.jira.fetchComments(key);
    for (const c of comments) {
      // extract the comment text
      let text = "";
      if (typeof c.body === "string") {
        text = c.body;
      } else {
        text = this.extractTextFromADF(c.body);
      }

      // map Jira accountId to GitHub username
      const jiraAuthorId = c.author.accountId;
      const ghUsername = this.userMap[jiraAuthorId];
      const authorString = ghUsername ? `@${ghUsername}` : c.author.displayName;

      // build the comment body
      const commentBody = `*Comment by ${authorString} on ${c.created}*\n\n${text}`;

      await this.gh.addComment(ghNum, commentBody);
      console.log(`💬 Migrated comment ${c.id} for ${key}`);
    }

    if (isSub) {
      const parentKey = fields.parent.key;
      const parentNum = this.keyToNumber.get(parentKey);
      if (parentNum) {
        // nest sub-issue
        await this.gh.addSubIssue(parentNum, ghNum);
        console.log(`🔗 Linked ${key} under parent ${parentKey}`);
      } else {
        console.warn(
          `⚠️ Parent ${parentKey} not migrated yet, skipping linkage.`
        );
      }
    }

    this.keyToNumber.set(key, ghNum);
    console.log(`${isSub ? "📌 Subtask" : "✅ Parent"} ${key} → GH #${ghNum}`);
  }
}
