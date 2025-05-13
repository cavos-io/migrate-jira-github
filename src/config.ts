import dotenv from "dotenv";
dotenv.config();

const requiredEnv = [
  "JIRA_BASE_URL",
  "JIRA_USER",
  "JIRA_API_TOKEN",
  "JIRA_JQL",
  "GH_OWNER",
  "GH_REPO",
  "GH_TOKEN",
  "GH_USER",
  "GH_PASSWORD",
] as const;

requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    throw new Error(`Missing env var ${key}`);
  }
});

export interface JiraConfig {
  baseUrl: string;
  user: string;
  token: string;
  jql: string;
  pageSize: number;
}

export interface GhConfig {
  owner: string;
  repo: string;
  token: string;
  projectV2Id?: string;
  projectV2StatusFieldId?: string;
  projectV2PriorityFieldId?: string;
  defaultPriorityOption?: string;
  personalTokens: Record<string, string>;
}

export interface GhAuth {
  username: string;
  password: string;
  twoFactorSecret?: string;
}

export const jiraConfig: JiraConfig = {
  baseUrl: process.env.JIRA_BASE_URL!.replace(/\/+$/, ""),
  user: process.env.JIRA_USER!,
  token: process.env.JIRA_API_TOKEN!,
  jql: process.env.JIRA_JQL!,
  pageSize: process.env.JIRA_PAGE_SIZE
    ? Number.parseInt(process.env.JIRA_PAGE_SIZE, 10)
    : 50,
};

export const ghConfig: GhConfig = {
  owner: process.env.GH_OWNER!,
  repo: process.env.GH_REPO!,
  token: process.env.GH_TOKEN!,
  projectV2Id: process.env.GH_PROJECT_V2_ID,
  projectV2StatusFieldId: process.env.GH_PROJECT_V2_STATUS_FIELD_ID,
  projectV2PriorityFieldId: process.env.GH_PROJECT_V2_PRIORITY_FIELD_ID,
  defaultPriorityOption: process.env.GH_DEFAULT_PRIORITY_OPTION,
  personalTokens: process.env.GH_USER_TOKENS
    ? JSON.parse(process.env.GH_USER_TOKENS)
    : {},
};

export const ghAuth: GhAuth = {
  username: process.env.GH_USER!,
  password: process.env.GH_PASSWORD!,
  twoFactorSecret: process.env.GH_2FA_SECRET,
};
