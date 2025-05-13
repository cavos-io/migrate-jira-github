import { graphql } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import fetch, { FormData, Blob } from "node-fetch";

export class GitHubClient {
  constructor(
    {
      owner,
      repo,
      token,
      projectV2Id,
      projectV2StatusFieldId,
      projectV2PriorityFieldId,
      defaultPriorityOption,
      personalTokens,
    },
    browserCookie = ""
  ) {
    this.owner = owner;
    this.repo = repo;
    this.authToken = token;
    this.browserCookie = browserCookie;
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

  async getRepoId() {
    if (this._repoId) return this._repoId;
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    this._repoId = data.id;
    return data.id;
  }

  async fetchUploadPolicy(issueNumber, fileName, size, mimeType) {
    const repoId = await this.getRepoId();

    const form = new FormData();
    form.append("repository_id", String(repoId));
    form.append("name", fileName);
    form.append("size", String(size));
    form.append("content_type", mimeType);

    const headers = {
      cookie: this.browserCookie,
      origin: "https://github.com",
      referer: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
      "x-requested-with": "XMLHttpRequest",
      "github-verified-fetch": "true",
      accept: "application/json",
    };

    const resp = await fetch("https://github.com/upload/policies/assets", {
      method: "POST",
      headers,
      body: form,
    });

    if (!resp.ok) {
      throw new Error(`Failed to fetch upload policy: ${resp.status}`);
    }
    return resp.json();
  }

  async postToS3(policy, fileBuffer, fileName) {
    const form = new FormData();
    for (const [k, v] of Object.entries(policy.form)) {
      form.append(k, v);
    }

    const blob = new Blob([fileBuffer], { type: policy.form.content_type });
    form.append("file", blob, fileName);

    const resp = await fetch(policy.upload_url, {
      method: "POST",
      body: form,
    });

    if (!resp.ok) {
      throw new Error(`S3 upload failed: ${resp.status}`);
    }
  }

  async registerAsset(policy, issueNumber) {
    const url = `https://github.com${policy.asset_upload_url}`;
    const form = new FormData();
    form.append("authenticity_token", policy.asset_upload_authenticity_token);

    const headers = {
      Accept: "application/json",
      Cookie: this.browserCookie,
      Origin: "https://github.com",
      Referer: `https://github.com/${this.owner}/${this.repo}/issues/${issueNumber}`,
      "X-Requested-With": "XMLHttpRequest",
      "github-verified-fetch": "true",
    };

    const resp = await fetch(url, { method: "PUT", headers, body: form });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(`Asset registration failed: ${resp.status} ${text}`);
    }

    const data = await resp.json();
    if (!data.href) {
      throw new Error(
        `No asset URL found in registerAsset response: ${JSON.stringify(data)}`
      );
    }

    return data.href;
  }

  async uploadAttachment(issueNumber, fileBuffer, fileName, mimeType) {
    if (!this.browserCookie) {
      throw new Error(
        "uploadAttachment requires a valid GitHub browser cookie"
      );
    }

    const policy = await this.fetchUploadPolicy(
      issueNumber,
      fileName,
      fileBuffer.length,
      mimeType
    );

    await this.postToS3(policy, fileBuffer, fileName);

    const href = await this.registerAsset(policy, issueNumber);
    return { id: policy.asset.id, url: href };
  }

  async addComment(issueNumber, body) {
    const { data } = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
    return data;
  }

  async getComment(commentId) {
    const { data } = await this.octokit.issues.getComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
    });
    return data;
  }

  async updateComment(commentId, { body }) {
    const { data } = await this.octokit.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body,
    });
    return data;
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
