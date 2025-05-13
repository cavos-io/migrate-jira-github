import axios from "axios";
import { jiraConfig } from "../config.js";

export class JiraClient {
  constructor() {
    this.client = axios.create({
      baseURL: `${jiraConfig.baseUrl}/rest/api/3`,
      auth: {
        username: jiraConfig.user,
        password: jiraConfig.token,
      },
      headers: { Accept: "application/json" },
    });
  }

  async fetchAllIssues() {
    let startAt = 0;
    const all = [];

    while (true) {
      const resp = await this.client.get("/search", {
        params: {
          jql: jiraConfig.jql,
          startAt,
          maxResults: jiraConfig.pageSize,
          fields: [
            "summary",
            "description",
            "issuetype",
            "subtasks",
            "parent",
            "labels",
            "assignee",
            "status",
          ],
        },
      });
      all.push(...resp.data.issues);
      if (resp.data.startAt + resp.data.maxResults >= resp.data.total) break;
      startAt += resp.data.maxResults;
    }

    return all;
  }

  async fetchComments(issueKey) {
    const resp = await this.client.get(`/issue/${issueKey}/comment`, {
      params: { maxResults: 1000 },
    });
    return resp.data.comments;
  }
}
