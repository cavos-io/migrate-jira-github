import fetch, { FormData, Blob } from "node-fetch";
import { lookup as lookupMime } from "mime-types";
import { Octokit } from "@octokit/rest";
import { getGitHubBrowserCookie } from "../../utils/getBrowserCookie";
import { GitHubConfig } from "../../domain/models/ConfigModels";
import {
  GitHubIssueParams,
  GitHubIssueUpdateParams,
  GitHubComment,
  GitHubAttachment,
} from "../../domain/models/GitHubClientModels";

const USER_AGENT = "Mozilla/5.0";

export class GitHubClient {
  private octokit: Octokit;
  private _repoId?: number;

  constructor(public readonly config: GitHubConfig) {
    this.octokit = new Octokit({
      auth: config.token,
      request: {
        fetch,
      },
    });
  }

  async createIssue(
    params: GitHubIssueParams
  ): Promise<{ number: number; url: string }> {
    const res = await this.octokit.issues.create({
      owner: this.config.owner,
      repo: this.config.repo,
      title: params.title,
      body: params.body,
      type: params.type,
      labels: params.labels,
      assignees: params.assignees,
    });
    return {
      number: res.data.number,
      url: res.data.html_url,
    };
  }

  async updateIssue(
    issueNumber: number,
    params: GitHubIssueUpdateParams
  ): Promise<void> {
    await this.octokit.issues.update({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      ...params,
    });
  }

  async uploadAttachment(
    issueNumber: number,
    fileBuffer: Buffer,
    filename: string
  ): Promise<GitHubAttachment> {
    // 1) Browser cookie for auth
    const cookie = await getGitHubBrowserCookie();

    // 2) Fetch the upload policy
    const repoId = await this.getRepoId();
    const mimeType = lookupMime(filename) || "application/octet-stream";

    const policyForm = new FormData();
    policyForm.append("repository_id", String(repoId));
    policyForm.append("name", filename);
    policyForm.append("size", String(fileBuffer.length));
    policyForm.append("content_type", mimeType);

    const policyRes = await fetch("https://github.com/upload/policies/assets", {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: "https://github.com",
        Referer: `https://github.com/${this.config.owner}/${this.config.repo}/issues/${issueNumber}`,
        "X-Requested-With": "XMLHttpRequest",
        "github-verified-fetch": "true",
        Accept: "application/json",
        "User-Agent": USER_AGENT,
      },
      body: policyForm,
    });

    if (!policyRes.ok) {
      throw new Error(
        `Failed to fetch upload policy: ${policyRes.status} ${await policyRes.text()}`
      );
    }

    const policy = (await policyRes.json()) as {
      upload_url: string;
      form: Record<string, string>;
      asset_upload_url: string;
      upload_authenticity_token: string;
      asset: { id: number };
    };

    // 3) POST the file to S3
    const s3Form = new FormData();
    for (const [k, v] of Object.entries(policy.form)) {
      s3Form.append(k, v);
    }

    const blob = new Blob([fileBuffer], { type: policy.form.content_type });
    s3Form.append("file", blob, filename);

    const s3Res = await fetch(policy.upload_url, {
      method: "POST",
      body: s3Form,
    });
    if (s3Res.status !== 204) {
      throw new Error(`S3 upload failed: ${s3Res.status}`);
    }

    // 4) Register the upload to Github
    const confirmForm = new FormData();
    confirmForm.append("authenticity_token", policy.upload_authenticity_token);

    const confirmRes = await fetch(
      `https://github.com${policy.asset_upload_url}`,
      {
        method: "PUT",
        headers: {
          Cookie: cookie,
          Origin: "https://github.com",
          Referer: `https://github.com/${this.config.owner}/${this.config.repo}/issues/${issueNumber}`,
          "X-Requested-With": "XMLHttpRequest",
          "github-verified-fetch": "true",
          Accept: "application/json",
          "User-Agent": USER_AGENT,
        },
        body: confirmForm,
      }
    );
    if (!confirmRes.ok) {
      throw new Error(
        `Asset confirmation failed: ${confirmRes.status} ${await confirmRes.text()}`
      );
    }
    const { href } = (await confirmRes.json()) as { href: string };

    // 5) Return the GitHub-hosted URL
    return { id: policy.asset.id, url: href };
  }

  async addComment(issueNumber: number, body: string): Promise<GitHubComment> {
    const res = await this.octokit.issues.createComment({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
      body,
    });
    return { id: res.data.id, body: res.data.body || "" };
  }

  async updateComment(commentId: number, body: string): Promise<void> {
    await this.octokit.issues.updateComment({
      owner: this.config.owner,
      repo: this.config.repo,
      comment_id: commentId,
      body,
    });
  }

  private async getIssueNodeId(issueNumber: number): Promise<string> {
    const { data } = await this.octokit.issues.get({
      owner: this.config.owner,
      repo: this.config.repo,
      issue_number: issueNumber,
    });
    return data.node_id;
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
    await this.octokit.graphql(mutation, {
      input: { issueId: parentId, subIssueId: childId, replaceParent: false },
    });
  }

  async addIssueToProject(issueNumber: number): Promise<string> {
    const res = await this.octokit.graphql<{
      addProjectV2ItemById: { item: { id: string } };
    }>(
      `
      mutation ($projectId: ID!, $contentId: ID!) {
        addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
          item { id }
        }
      }`,
      {
        projectId: this.config.projectV2Id,
        contentId: (
          await this.octokit.issues.get({
            owner: this.config.owner,
            repo: this.config.repo,
            issue_number: issueNumber,
          })
        ).data.node_id,
      }
    );

    return res.addProjectV2ItemById.item.id;
  }

  private async updateProjectField(
    itemId: string,
    fieldId: string,
    optionId: string
  ): Promise<void> {
    await this.octokit.graphql(
      `
      mutation ($projectId: ID!, $itemId: ID!, $fieldId: ID!, $optionId: String!) {
        updateProjectV2ItemFieldValue(input: {
          projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: { singleSelectOptionId: $optionId }
        }) { projectV2Item { id } }
      }`,
      {
        projectId: this.config.projectV2Id,
        itemId,
        fieldId,
        optionId,
      }
    );
  }

  async updateProjectIssueFields(
    itemId: string,
    statusOptionId?: string,
    priorityOptionId?: string
  ): Promise<void> {
    if (statusOptionId && this.config.projectV2StatusFieldId) {
      await this.updateProjectField(
        itemId,
        this.config.projectV2StatusFieldId,
        statusOptionId
      );
    }
    if (priorityOptionId && this.config.projectV2PriorityFieldId) {
      await this.updateProjectField(
        itemId,
        this.config.projectV2PriorityFieldId,
        priorityOptionId
      );
    }
  }

  private async getRepoId(): Promise<number> {
    if (this._repoId !== undefined) return this._repoId;
    const { data } = await this.octokit.repos.get({
      owner: this.config.owner,
      repo: this.config.repo,
    });
    this._repoId = data.id;
    return data.id;
  }
}
