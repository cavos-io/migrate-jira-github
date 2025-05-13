import dotenv from "dotenv";
dotenv.config();

export const jira = {
  baseUrl: "https://cavos.atlassian.net",
  user: process.env.JIRA_USER,
  token: process.env.JIRA_API_TOKEN,
  jql: "project = Development AND statusCategory != Done AND issuetype in (Story, Task, Bug) AND issue in (TEC-696) order by created DESC",
  pageSize: 50,
};

export const github = {
  owner: process.env.GH_OWNER,
  repo: process.env.GH_REPO,
  token: process.env.GH_TOKEN,
};
