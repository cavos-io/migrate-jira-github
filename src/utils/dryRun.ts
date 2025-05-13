import type { IGitHubClient } from "../clients/types";

export default function applyDryRunToClient(
  client: IGitHubClient
): IGitHubClient {
  let _fake = 1000;
  // helper to log and return a dummy ID
  const fakeId = () => _fake++;

  // Stub methods that mutate state:
  client.createIssue = async function (opts) {
    console.log(`[Dry-Run] createIssue →`, opts);
    return fakeId();
  };

  client.getIssue = async function (num) {
    console.log(`[Dry-Run] getIssue #${num}`);
    return { body: "" };
  };

  client.updateIssue = async function (num, opts) {
    console.log(`[Dry-Run] updateIssue #${num} →`, opts);
  };

  client.uploadAttachment = async function (
    issueNumber,
    fileBuffer,
    filename,
    mimeType
  ) {
    console.log(
      `[Dry-Run] uploadAttachment #${issueNumber} → ${filename} ` +
        `(${fileBuffer.length} bytes, ${mimeType})`
    );
    return {
      id: issueNumber,
      url: `https://dry.run/${filename}`,
    };
  };

  client.addComment = async function (num, comment) {
    console.log(`[Dry-Run] addComment #${num} →`, comment);
    return { id: num, body: comment };
  };

  client.getComment = async function (commentId) {
    console.log(`[Dry-Run] getComment #${commentId}`);
    return { body: "" };
  };

  client.updateComment = async function (commentId, opts) {
    console.log(`[Dry-Run] updateComment #${commentId} →`, opts);
  };

  client.addSubIssue = async function (parent, child) {
    console.log(`[Dry-Run] addSubIssue parent=#${parent}, child=#${child}`);
  };

  client.addIssueToProjectV2 = async function (num) {
    console.log(`[Dry-Run] addIssueToProjectV2 #${num}`);
    return `dry-item-${num}`;
  };

  client.updateProjectV2ItemFieldValue = async function (
    itemId,
    fieldId,
    optionId
  ) {
    console.log(
      `[Dry-Run] updateProjectV2ItemFieldValue item=${itemId} ` +
        `field=${fieldId} opt=${optionId}`
    );
  };

  return client;
}
