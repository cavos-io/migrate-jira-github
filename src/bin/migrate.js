#!/usr/bin/env node
import "dotenv/config";
import { issueTypeMap, statusOptionMap, userMap } from "../mappings.js";
import { JiraClient } from "../clients/jiraClient.js";
import { GitHubClient } from "../clients/githubClient.js";
import { IssueMigrator } from "../services/issueMigrator.js";

async function main() {
  const migrator = new IssueMigrator(
    new JiraClient(),
    new GitHubClient(),
    issueTypeMap,
    statusOptionMap,
    userMap
  );

  try {
    await migrator.migrate();
    console.log("🎉 Migration complete");
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

main();
