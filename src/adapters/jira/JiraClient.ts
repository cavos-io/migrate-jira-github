import axios, { AxiosInstance } from "axios";
import { JiraConfig } from "../../domain/models/ConfigModels";
import {
  JiraIssue,
  JiraAttachment,
  JiraComment,
} from "../../domain/models/JiraClientModels";

export class JiraClient {
  private client: AxiosInstance;

  constructor(private config: JiraConfig) {
    this.client = axios.create({
      baseURL: `${config.baseUrl}/rest/api/3`,
      auth: { username: config.user, password: config.token },
      maxRedirects: 0,
      validateStatus: (s) => s >= 200 && s < 400,
    });
  }

  async fetchIssue(issueKey: string): Promise<JiraIssue> {
    const res = await this.client.get<JiraIssue>(`/issue/${issueKey}`);
    return res.data;
  }

  async fetchIssues(jql: string): Promise<JiraIssue[]> {
    const res = await this.client.get<{ issues: JiraIssue[] }>("/search", {
      params: { jql, maxResults: this.config.pageSize },
    });
    return res.data.issues;
  }

  async fetchAttachments(issueKey: string): Promise<JiraAttachment[]> {
    const res = await this.fetchIssue(issueKey);
    return res.fields.attachment || [];
  }

  async downloadAttachment(url: string): Promise<Buffer> {
    const res = await axios.get(url, {
      auth: { username: this.config.user, password: this.config.token },
      responseType: "arraybuffer",
    });
    return Buffer.from(res.data);
  }

  async getMediaUuid(attachmentId: string): Promise<string> {
    const res = await this.client.head(`/attachment/content/${attachmentId}`);
    const location = res.headers["location"] as string;
    const m = location.match(/\/file\/([0-9a-fA-F\-]+)\//);
    if (!m) throw new Error(`Cannot parse media UUID from ${location}`);
    return m[1];
  }

  async fetchComments(issueKey: string): Promise<JiraComment[]> {
    const res = await this.client.get<{ comments: JiraComment[] }>(
      `/issue/${issueKey}/comment`
    );
    return res.data.comments;
  }
}
