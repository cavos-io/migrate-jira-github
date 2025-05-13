import axios from "axios";

export class JiraClient {
  constructor({ baseUrl, user, token, jql, pageSize = 50 }) {
    this.jql = jql;
    this.pageSize = pageSize;
    this.client = axios.create({
      baseURL: `${baseUrl.replace(/\/+$/, "")}/rest/api/3`,
      auth: { username: user, password: token },
      headers: { Accept: "application/json" },
    });
  }

  async fetchAllIssues() {
    let startAt = 0;
    const all = [];
    while (true) {
      const resp = await this.client.get("/search", {
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

  async fetchAttachments(issueKey) {
    const { data } = await this.client.get(`/issue/${issueKey}`, {
      params: { fields: "attachment" },
    });
    return data.fields.attachment;
  }

  async downloadAttachment(url) {
    try {
      const resp = await axios.get(url, {
        auth: this.client.defaults.auth,
        responseType: "arraybuffer",
      });
      return resp.data;
    } catch (err) {
      console.error(`❌ Jira downloadAttachment failed for ${url}:`, err);
      throw err;
    }
  }

  async fetchComments(issueKey) {
    const resp = await this.client.get(`/issue/${issueKey}/comment`, {
      params: { maxResults: 1000 },
    });
    return resp.data.comments;
  }
}
