#!/usr/bin/env tsx
import { hideBin } from "yargs/helpers";
import yargs from "yargs";
import { JiraAdapter } from "../adapters/jira/JiraAdapter";
import { JiraClient } from "../adapters/jira/JiraClient";
import { GitHubAdapter } from "../adapters/github/GitHubAdapter";
import { GitHubClient } from "../adapters/github/GitHubClient";
import { DryRunGitHubAdapter } from "../adapters/github/DryRunGitHubAdapter";
import { IssueMigrationService } from "../domain/services/MigrationService";
import { mappingConfig, jiraConfig, ghConfig } from "../config";

const argv = yargs(hideBin(process.argv))
  .option("dry-run", {
    alias: "dryRun",
    type: "boolean",
    default: false,
    describe: "Simulate migration without making any GitHub calls",
  })
  .option("issues", {
    type: "array",
    array: true,
    describe:
      "Specific Jira issue keys to migrate (e.g. ISSUE-1). If omitted, uses JQL from config.",
  })
  .help()
  .parseSync();

async function main() {
  const jiraPort = new JiraAdapter(
    new JiraClient(jiraConfig),
    mappingConfig.issueTypeMap,
    mappingConfig.userMap
  );
  const githubPort = argv.dryRun
    ? new DryRunGitHubAdapter()
    : new GitHubAdapter(new GitHubClient(ghConfig));
  const migrator = new IssueMigrationService(jiraPort, githubPort, {
    statusOptionMap: mappingConfig.statusOptionMap,
    priorityOptionMap: mappingConfig.priorityOptionMap,
    issueTypeMap: mappingConfig.issueTypeMap,
    defaultPriorityOption: ghConfig.defaultPriorityOption,
  });

  if (argv.issues && argv.issues.length > 0) {
    // for (const key of argv.issues as string[]) {
    //   const res = await migrator.migrateSingleIssue(key);
    //   console.log(`> ${key}:`, res);
    // }
  } else {
    const results = await migrator.migrateIssuesByQuery(jiraConfig.jql);
    console.log("> Batch results:", results);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
