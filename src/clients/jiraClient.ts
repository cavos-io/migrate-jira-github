import axios, { AxiosInstance } from "axios";
import type { JiraClientOptions, IJiraClient } from "./types";

export class JiraClient implements IJiraClient {
  private jql: string;
  private pageSize: number;
  private client: AxiosInstance;

  constructor(options: JiraClientOptions) {
    const { baseUrl, user, token, jql, pageSize = 50 } = options;

    this.jql = jql;
    this.pageSize = pageSize;

    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, "")}/rest/api/3`,
      auth: { username: user, password: token },
      headers: { Accept: "application/json" },
    });
  }

  /** Retrieve all Jira issues matching the configured JQL */
  async fetchAllIssues(): Promise<any[]> {
    let startAt = 0;
    const all: any[] = [];

    while (true) {
      const resp = await this.client.get<{
        issues: any[];
        startAt: number;
        maxResults: number;
        total: number;
      }>("/search", {
        params: {
          jql: this.jql,
          startAt,
          maxResults: this.pageSize,
          fields: [
            "summary",
            "description",
            "issuetype",
            "parent",
            "subtasks",
            "issuelinks",
            "attachment",
            "labels",
            "status",
            "creator",
            "assignee",
          ],
        },
      });

      all.push(...resp.data.issues);
      if (resp.data.startAt + resp.data.maxResults >= resp.data.total) break;
      startAt += resp.data.maxResults;
    }
    return all;
  }

  /** Get attachments metadata for a single issue */
  async fetchAttachments(issueKey: string): Promise<any[]> {
    const resp = await this.client.get<{ fields: { attachment: any[] } }>(
      `/issue/${issueKey}`,
      {
        params: { fields: "attachment" },
      }
    );
    return resp.data.fields.attachment;
  }

  /** Download a binary attachment from its URL */
  async downloadAttachment(url: string): Promise<ArrayBuffer> {
    try {
      const resp = await axios.get<ArrayBuffer>(url, {
        auth: this.client.defaults.auth,
        responseType: "arraybuffer",
      });
      return resp.data;
    } catch (err) {
      console.error(`❌ Jira downloadAttachment failed for ${url}:`, err);
      throw err;
    }
  }

  /** Fetch all comments for a Jira issue */
  async fetchComments(issueKey: string): Promise<any[]> {
    const resp = await this.client.get<{ comments: any[] }>(
      `/issue/${issueKey}/comment`,
      {
        params: { maxResults: 1000 },
      }
    );
    return resp.data.comments;
  }
}
