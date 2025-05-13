import "dotenv/config";
import { fetchAllIssues } from "./jira.js";
import { createIssue } from "./github.js";

/**
 * Migrate Jira → GitHub, preserving parent→child links.
 */
async function migrate() {
  const issues = await fetchAllIssues();

  // Map JIRA key → GitHub issue number
  const keyToNumber = new Map();

  // 1. Create all parent issues (non-subtasks)
  const parents = issues.filter((i) => !i.fields.issuetype.subtask);
  for (const issue of parents) {
    const title = `[${issue.key}] ${issue.fields.summary}`;
    const body = issue.fields.description || "";
    const ghNum = await createIssue({ title, body });
    keyToNumber.set(issue.key, ghNum);
    console.log(`✅ Created parent ${issue.key} → GH #${ghNum}`);
  }

  // 2. Create all subtasks (children), linking back to parent
  const subtasks = issues.filter((i) => i.fields.issuetype.subtask);
  for (const sub of subtasks) {
    const parentKey = sub.fields.parent.key;
    const parentNum = keyToNumber.get(parentKey);
    const title = `[${sub.key}] ${sub.fields.summary}`;
    let body = sub.fields.description || "";
    if (parentNum) {
      body += `\n\n*Parent issue migrated to [#${parentNum}](https://github.com/${process.env.GH_OWNER}/${process.env.GH_REPO}/issues/${parentNum})*`;
    }
    const ghNum = await createIssue({ title, body });
    keyToNumber.set(sub.key, ghNum);
    console.log(`📌 Created subtask ${sub.key} → GH #${ghNum}`);
  }
}

// run the migration
migrate()
  .then(() => console.log("🎉 Migration complete"))
  .catch((err) => {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  });
