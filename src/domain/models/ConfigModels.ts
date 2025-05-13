export interface JiraConfig {
  baseUrl: string;
  user: string;
  token: string;
  jql: string;
  pageSize: number;
}

export interface GitHubConfig {
  owner: string;
  repo: string;
  token: string;
  projectV2Id?: string;
  projectV2StatusFieldId?: string;
  projectV2PriorityFieldId?: string;
  defaultPriorityOption?: string;
  personalTokens?: Record<string, string>;
}

export interface GitHubAuth {
  username: string;
  password: string;
  twoFactorSecret?: string;
}
