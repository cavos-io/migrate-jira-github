#!/usr/bin/env node
import "dotenv/config";
import { jiraConfig, ghConfig } from "../config.js";
import {
  issueTypeMap,
  priorityOptionMap,
  statusOptionMap,
  userMap,
} from "../mappings.js";
import { JiraClient } from "../clients/jiraClient.js";
import { GitHubClient } from "../clients/githubClient.js";
import { IssueMigrator } from "../services/issueMigrator.js";

async function main() {
  const jiraClient = new JiraClient(jiraConfig);
  const githubClient = new GitHubClient(ghConfig);

  const migrator = new IssueMigrator(
    jiraClient,
    githubClient,
    issueTypeMap,
    priorityOptionMap,
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
