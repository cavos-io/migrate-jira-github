import { Octokit } from "@octokit/rest";
import { graphql } from "@octokit/graphql";
import { ghConfig } from "../config.js";

export class GitHubClient {
  constructor() {
    // REST client for creating issues & comments
    this.octokit = new Octokit({ auth: ghConfig.token });
    // GraphQL client for sub-issue linkage
    this.graphql = graphql.defaults({
      headers: { authorization: `token ${ghConfig.token}` },
    });
  }

  async createIssue({ title, body, type, labels = [], assignees = [] }) {
    const { data } = await this.octokit.issues.create({
      owner: ghConfig.owner,
      repo: ghConfig.repo,
      title,
      body,
      type,
      labels,
      assignees,
    });
    return data.number;
  }

  async addComment(issueNumber, comment) {
    await this.octokit.issues.createComment({
      owner: ghConfig.owner,
      repo: ghConfig.repo,
      issue_number: issueNumber,
      body: comment,
    });
  }

  // helper to fetch a Node ID for any issue number
  async getIssueNodeId(issueNumber) {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner:$owner, name:$repo) {
          issue(number:$number) { id }
        }
      }
    `;
    const { repository } = await this.graphql(query, {
      owner: ghConfig.owner,
      repo: ghConfig.repo,
      number: issueNumber,
    });
    return repository.issue.id;
  }

  // GraphQL mutation to nest sub-issues
  async addSubIssue(parentNumber, childNumber) {
    const parentId = await this.getIssueNodeId(parentNumber);
    const childId = await this.getIssueNodeId(childNumber);

    const mutation = `
      mutation($input: AddSubIssueInput!) {
        addSubIssue(input: $input) {
          issue    { number }
          subIssue { number }
        }
      }
    `;
    await this.graphql(mutation, {
      input: {
        issueId: parentId,
        subIssueId: childId,
        replaceParent: false,
      },
    });
  }

  // GraphQL mutation Projects (beta/V2)
  async addIssueToProjectV2(issueNumber) {
    const { projectV2Id } = ghConfig;
    if (!projectV2Id) return;
    const contentId = await this.getIssueNodeId(issueNumber);

    const mutation = `
      mutation($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {
          projectId: $projectId,
          contentId: $contentId
        }) {
          item { id }
        }
      }
    `;

    await this.graphql(mutation, {
      projectId: projectV2Id,
      contentId,
    });
  }
}
