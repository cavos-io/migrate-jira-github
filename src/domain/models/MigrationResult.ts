export interface MigrationResult {
  success: boolean;
  githubIssueNumber?: number;
  url?: string;
  body?: string;
  errors?: string[];
}

export namespace MigrationResult {
  export function success(
    issueNumber: number,
    url: string,
    body: string
  ): MigrationResult {
    return {
      success: true,
      githubIssueNumber: issueNumber,
      url,
      body,
    };
  }

  export function failure(errors: string[]): MigrationResult {
    return {
      success: false,
      errors,
    };
  }
}
