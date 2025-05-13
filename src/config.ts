import dotenv from "dotenv";
dotenv.config();

import {
  JiraConfig,
  GitHubConfig,
  GitHubAuth,
} from "./domain/models/ConfigModels";

import {
  IssueTypeMap,
  PriorityOptionMap,
  StatusOptionMap,
  UserMap,
} from "./domain/models/MappingModels";

function assertEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env variable ${key}`);
  return value;
}

export const ghAuth: GitHubAuth = {
  username: assertEnv("GH_USER"),
  password: assertEnv("GH_PASSWORD"),
  twoFactorSecret: process.env.GH_2FA_SECRET,
};

export const jiraConfig: JiraConfig = {
  baseUrl: assertEnv("JIRA_BASE_URL").replace(/\/+$/, ""),
  user: assertEnv("JIRA_USER"),
  token: assertEnv("JIRA_API_TOKEN"),
  jql: assertEnv("JIRA_JQL"),
  pageSize: process.env.JIRA_PAGE_SIZE
    ? Number.parseInt(process.env.JIRA_PAGE_SIZE, 10)
    : 50,
};

export const ghConfig: GitHubConfig = {
  owner: assertEnv("GH_OWNER"),
  repo: assertEnv("GH_REPO"),
  token: assertEnv("GH_TOKEN"),
  projectV2Id: process.env.GH_PROJECT_V2_ID,
  projectV2StatusFieldId: process.env.GH_PROJECT_V2_STATUS_FIELD_ID,
  projectV2PriorityFieldId: process.env.GH_PROJECT_V2_PRIORITY_FIELD_ID,
  defaultPriorityOption: process.env.GH_DEFAULT_PRIORITY_OPTION,
  personalTokens: process.env.GH_USER_TOKENS
    ? JSON.parse(process.env.GH_USER_TOKENS)
    : {},
};

function parseJsonEnv<T>(key: string, defaultValue: T): T {
  const v = process.env[key];
  if (!v) return defaultValue;
  try {
    return JSON.parse(v) as T;
  } catch {
    throw new Error(`Invalid JSON in env var ${key}`);
  }
}

export const mappingConfig = {
  userMap: parseJsonEnv<UserMap>("JIRA_GH_USER_MAP", {}),
  issueTypeMap: parseJsonEnv<IssueTypeMap>("JIRA_GH_ISSUE_TYPE_MAP", {}),
  statusOptionMap: parseJsonEnv<StatusOptionMap>(
    "JIRA_GH_STATUS_OPTION_MAP",
    {}
  ),
  priorityOptionMap: parseJsonEnv<PriorityOptionMap>(
    "JIRA_GH_PRIORITY_OPTION_MAP",
    {}
  ),
};
