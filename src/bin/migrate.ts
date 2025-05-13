#!/usr/bin/env node
import "dotenv/config";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import {
  issueTypeMap,
  priorityOptionMap,
  statusOptionMap,
  userMap,
} from "../mappings";
import { jiraConfig, ghConfig } from "../config";
import { JiraClient } from "../clients/jiraClient";
import { GitHubClient } from "../clients/githubClient";
import { getGitHubBrowserCookie } from "../utils/getBrowserCookie";
import { IssueMigrator } from "../services/issueMigrator";
import applyDryRunToClient from "../utils/dryRun";

async function main() {
  const { dryRun } = yargs(hideBin(process.argv))
    .option("dry-run", { type: "boolean", default: false })
    .parseSync();

  const jiraClient = new JiraClient(jiraConfig);
  const browserCookie = await getGitHubBrowserCookie();
  const githubClient = new GitHubClient(ghConfig, browserCookie);

  if (dryRun) {
    console.log("⚡️ DRY RUN mode: no changes will be pushed to GitHub");
    applyDryRunToClient(githubClient);
  }

  const migrator = new IssueMigrator(
    jiraClient,
    githubClient,
    issueTypeMap,
    priorityOptionMap,
    statusOptionMap,
    userMap,
    { dryRun }
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
