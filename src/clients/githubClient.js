import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import fetch from "node-fetch";

export class GitHubClient {
  constructor({
    owner,
    repo,
    token,
    projectV2Id,
    projectV2StatusFieldId,
    projectV2PriorityFieldId,
    defaultPriorityOption,
    personalTokens,
  }) {
    this.owner = owner;
    this.repo = repo;
    this.authToken = token;
    this.projectV2Id = projectV2Id;
    this.projectV2StatusFieldId = projectV2StatusFieldId;
    this.projectV2PriorityFieldId = projectV2PriorityFieldId;
    this.defaultPriorityOption = defaultPriorityOption;
    this.personalTokens = personalTokens;

    this.octokit = new Octokit({ auth: token, request: { fetch } });
    this.graphql = graphql.defaults({
      headers: { authorization: `token ${token}` },
      request: { fetch },
    });
  }

  async createIssue({ title, body, type, labels = [], assignees = [] }) {
    const { data } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
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
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    return data;
  }

  async updateIssue(issueNumber, { body, state, state_reason }) {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      ...(body && { body }),
      ...(state && { state }),
      ...(state_reason && { state_reason }),
    });
  }

  async addComment(issueNumber, comment) {
    await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body: comment,
    });
  }

  async getIssueNodeId(issueNumber) {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner:$owner, name:$repo) {
          issue(number:$number) { id }
        }
      }
    `;
    const { repository } = await this.graphql(query, {
      owner: this.owner,
      repo: this.repo,
      number: issueNumber,
    });
    return repository.issue.id;
  }

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

  async addIssueToProjectV2(issueNumber) {
    if (!this.projectV2Id) return;
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
      projectId: this.projectV2Id,
      contentId,
    });
    return result.addProjectV2ItemById.item.id;
  }

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
        projectId: this.projectV2Id,
        itemId,
        fieldId,
        value: { singleSelectOptionId: optionId },
      },
    });
  }
}
