export class IssueMigrator {
  constructor(jiraClient, githubClient) {
    this.jira = jiraClient;
    this.gh = githubClient;
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

    // 1) grab raw description
    const rawDesc = fields.description;
    let body = "";

    // 2) coerce to string
    if (!rawDesc) {
      body = "";
    } else if (typeof rawDesc === "string") {
      body = rawDesc;
    } else {
      // assume Atlassian Document Format (ADF)
      body = this.extractTextFromADF(rawDesc);
    }

    // 3) if subtask, append parent link
    if (isSub) {
      const parentKey = fields.parent.key;
      const parentNum = this.keyToNumber.get(parentKey);
      // Concept to handle related issue on Jira
      // Todo: relate real issues
      if (parentNum) {
        body += `\n\n*Parent: [#${parentNum}](https://github.com/${process.env.GH_OWNER}/${process.env.GH_REPO}/issues/${parentNum})*`;
      }
    }

    // 4) create on GitHub
    const ghNum = await this.gh.createIssue({ title, body });

    if (isSub) {
      const parentKey = fields.parent.key;
      const parentNum = this.keyToNumber.get(parentKey);
      if (parentNum) {
        // instead of only appending a link, actually nest it:
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
