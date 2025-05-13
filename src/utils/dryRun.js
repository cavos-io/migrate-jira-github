export default function applyDryRunToClient(client) {
  let _fake = 1000;
  // helper to log and return a dummy ID
  const fakeId = () => _fake++;

  // stub out methods that mutate state:
  client.createIssue = async function (opts) {
    console.log(`[Dry-Run] createIssue →`, opts);
    return fakeId();
  };

  client.updateIssue = async function (num, opts) {
    console.log(`[Dry-Run] updateIssue #${num} →`, opts);
  };

  client.addComment = async function (num, comment) {
    console.log(`[Dry-Run] addComment #${num} →`, comment);
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
      `[Dry-Run] updateProjectV2ItemFieldValue item=${itemId} field=${fieldId} opt=${optionId}`
    );
  };

  return client;
}
