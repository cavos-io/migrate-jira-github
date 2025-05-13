import { ghConfig } from "../config.js";
import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";

export class GitHubClient {
  constructor() {
    this.octokit = new Octokit({
      auth: ghConfig.token,
      request: { fetch },
    });

    this.graphql = graphql.defaults({
      request: { fetch },
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

  async getIssue(issueNumber) {
    const { data } = await this.octokit.issues.get({
      owner: ghConfig.owner,
      repo: ghConfig.repo,
      issue_number: issueNumber,
    });
    return data;
  }

  async updateIssue(issueNumber, { body, state, state_reason }) {
    await this.octokit.issues.update({
      owner: ghConfig.owner,
      repo: ghConfig.repo,
      issue_number: issueNumber,
      ...(body && { body }),
      ...(state && { state }),
      ...(state_reason && { state_reason }),
    });
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

    const result = await this.graphql(mutation, {
      projectId: projectV2Id,
      contentId,
    });

    return result.addProjectV2ItemById.item.id;
  }

  // GraphQL mutation update Project status
  async updateProjectV2ItemFieldValue(itemId, fieldId, optionId) {
    const mutation = `
      mutation($input: UpdateProjectV2ItemFieldValueInput!) {
        updateProjectV2ItemFieldValue(input: $input) {
          projectV2Item { id }
        }
      }
    `;
    await this.graphql(mutation, {
      input: {
        projectId: ghConfig.projectV2Id,
        itemId,
        fieldId,
        value: { singleSelectOptionId: optionId },
      },
    });
  }
}
