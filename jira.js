import axios from "axios";
import { jira } from "./config.js";

const jiraClient = axios.create({
  baseURL: `${jira.baseUrl}/rest/api/3`,
  auth: {
    username: jira.user,
    password: jira.token,
  },
  headers: { Accept: "application/json" },
});

/**
 * Fetch all issues matching JQL, including sub‐tasks.
 */
export async function fetchAllIssues() {
  let startAt = 0;
  const all = [];
  try {
    while (true) {
      const resp = await jiraClient.get("/search", {
        params: {
          jql: jira.jql,
          startAt,
          maxResults: jira.pageSize,
          fields: ["summary", "description", "issuetype", "subtasks", "parent"],
        },
      });
      all.push(...resp.data.issues);
      if (resp.data.startAt + resp.data.maxResults >= resp.data.total) break;
      startAt += resp.data.maxResults;
    }
    return all;
  } catch (err) {
    if (err.response?.data?.errorMessages) {
      console.error("Jira errorMessages:", err.response.data.errorMessages);
    }
    throw err;
  }
}
