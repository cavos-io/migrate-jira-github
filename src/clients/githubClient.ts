import { graphql as graphqlOrig } from "@octokit/graphql";
import { Octokit } from "@octokit/rest";
import fetch, { FormData, Blob } from "node-fetch";
import type { GitHubClientOptions, IGitHubClient, UploadPolicy } from "./types";

export class GitHubClient implements IGitHubClient {
  public readonly owner: string;
  public readonly repo: string;
  public readonly authToken: string;
  public readonly browserCookie: string;
  public readonly projectV2Id?: string;
  public readonly projectV2StatusFieldId?: string;
  public readonly projectV2PriorityFieldId?: string;
  public readonly defaultPriorityOption?: string;
  public readonly personalTokens: Record<string, string>;

  private octokit: Octokit;
  private graphql: typeof graphqlOrig;
  private _repoId?: number;

  constructor(options: GitHubClientOptions, browserCookie = "") {
    const {
      owner,
      repo,
      token,
      projectV2Id,
      projectV2StatusFieldId,
      projectV2PriorityFieldId,
      defaultPriorityOption,
      personalTokens = {},
    } = options;

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
    this.graphql = graphqlOrig.defaults({
      headers: { authorization: `token ${token}` },
      request: { fetch },
    });
  }

  async createIssue(params: {
    title: string;
    body: string;
    type: string;
    labels?: string[];
    assignees?: string[];
  }): Promise<number> {
    const { data } = await this.octokit.issues.create({
      owner: this.owner,
      repo: this.repo,
      title: params.title,
      body: params.body,
      type: params.type,
      labels: params.labels,
      assignees: params.assignees,
    });
    return data.number;
  }

  async getIssue(issueNumber: number): Promise<any> {
    const { data } = await this.octokit.issues.get({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
    });
    return data;
  }

  async updateIssue(
    issueNumber: number,
    opts: {
      body?: string;
      state?: "open" | "closed";
      state_reason?: "completed" | "not_planned" | "reopened" | null;
    }
  ): Promise<void> {
    await this.octokit.issues.update({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      ...(opts.body && { body: opts.body }),
      ...(opts.state && { state: opts.state }),
      ...(opts.state_reason && { state_reason: opts.state_reason }),
    });
  }

  private async getRepoId(): Promise<number> {
    if (this._repoId !== undefined) return this._repoId;
    const { data } = await this.octokit.repos.get({
      owner: this.owner,
      repo: this.repo,
    });
    this._repoId = data.id;
    return data.id;
  }

  async fetchUploadPolicy(
    issueNumber: number,
    fileName: string,
    size: number,
    mimeType: string
  ): Promise<UploadPolicy> {
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
    // Cast into our known shape
    return (await resp.json()) as UploadPolicy;
  }

  async postToS3(
    policy: UploadPolicy,
    fileBuffer: Buffer,
    fileName: string
  ): Promise<void> {
    const form = new FormData();
    // now policy.form values are guaranteed string
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

  async registerAsset(
    policy: UploadPolicy,
    issueNumber: number
  ): Promise<string> {
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
    const data = (await resp.json()) as { href: string };
    if (!data.href) {
      throw new Error(`No asset URL found: ${JSON.stringify(data)}`);
    }
    return data.href;
  }

  async uploadAttachment(
    issueNumber: number,
    fileBuffer: Buffer,
    fileName: string,
    mimeType: string
  ): Promise<{ id: number; url: string }> {
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

  async addComment(
    issueNumber: number,
    body: string
  ): Promise<{ id: number; body: string }> {
    const { data } = await this.octokit.issues.createComment({
      owner: this.owner,
      repo: this.repo,
      issue_number: issueNumber,
      body,
    });
    return { id: data.id, body: data.body ?? "" };
  }

  async getComment(commentId: number): Promise<{ body: string }> {
    const { data } = await this.octokit.issues.getComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
    });
    return { body: data.body ?? "" };
  }

  async updateComment(commentId: number, opts: { body: string }): Promise<any> {
    const { data } = await this.octokit.issues.updateComment({
      owner: this.owner,
      repo: this.repo,
      comment_id: commentId,
      body: opts.body,
    });
    return data;
  }

  async getIssueNodeId(issueNumber: number): Promise<string> {
    const query = `
      query($owner: String!, $repo: String!, $number: Int!) {
        repository(owner:$owner, name:$repo) {
          issue(number:$number) { id }
        }
      }
    `;
    const result = await this.graphql<{
      repository: { issue: { id: string } };
    }>(query, { owner: this.owner, repo: this.repo, number: issueNumber });
    return result.repository.issue.id;
  }

  async addSubIssue(parentNumber: number, childNumber: number): Promise<void> {
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

  async addIssueToProjectV2(issueNumber: number): Promise<string | undefined> {
    if (!this.projectV2Id) return undefined;
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
    const result = await this.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(mutation, { projectId: this.projectV2Id, contentId });
    return result.addProjectV2ItemById.item.id;
  }

  async updateProjectV2ItemFieldValue(
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    const mutation = `
      mutation($input: UpdateProjectV2ItemFieldValueInput!) {
        updateProjectV2ItemFieldValue(input: $input) {
          projectV2Item { id }
        }
      }
    `;
    await this.graphql(mutation, {
      input: {
        projectId: this.projectV2Id!,
        itemId,
        fieldId,
        value: { singleSelectOptionId: optionId },
      },
    });
  }
}
