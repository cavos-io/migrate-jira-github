import dotenv from "dotenv";
dotenv.config();

const required = [
  "JIRA_BASE_URL",
  "JIRA_USER",
  "JIRA_API_TOKEN",
  "JIRA_JQL",
  "GH_OWNER",
  "GH_REPO",
  "GH_TOKEN",
];
required.forEach((k) => {
  if (!process.env[k]) throw new Error(`Missing env var ${k}`);
});

export const jiraConfig = {
  baseUrl: process.env.JIRA_BASE_URL,
  user: process.env.JIRA_USER,
  token: process.env.JIRA_API_TOKEN,
  jql: process.env.JIRA_JQL,
  pageSize: parseInt(process.env.JIRA_PAGE_SIZE, 10) || 50,
};

export const ghConfig = {
  owner: process.env.GH_OWNER,
  repo: process.env.GH_REPO,
  token: process.env.GH_TOKEN,
  projectV2Id: process.env.GH_PROJECT_V2_ID,
  projectV2StatusFieldId: process.env.GH_PROJECT_V2_STATUS_FIELD_ID,
  projectV2PriorityFieldId: process.env.GH_PROJECT_V2_PRIORITY_FIELD_ID,
  defaultPriorityOption: process.env.GH_DEFAULT_PRIORITY_OPTION,
  personalTokens: process.env.GH_USER_TOKENS
    ? JSON.parse(process.env.GH_USER_TOKENS)
    : {},
};
