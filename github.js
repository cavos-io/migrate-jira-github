import { Octokit } from "@octokit/rest";
import { github } from "./config.js";

export async function createIssue({ title, body }) {
  const octokit = new Octokit({ auth: github.token });
  const { data } = await octokit.issues.create({
    owner: github.owner,
    repo: github.repo,
    title,
    body,
  });
  return data.number;
}
