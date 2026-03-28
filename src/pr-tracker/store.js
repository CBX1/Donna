/**
 * In-memory PR review tracking store.
 * Each PR: { prUrl, context, assignee, timestamp, status }
 */

const prs = [];

function add({ prUrl, context, assignee }) {
  // Don't add duplicates
  if (prs.find(pr => pr.prUrl === prUrl)) return false;

  prs.push({
    prUrl,
    context,       // 8-9 word summary
    assignee,      // who requested the review
    timestamp: new Date(),
    status: 'pending',
  });
  return true;
}

function getPending() {
  return prs.filter(pr => pr.status === 'pending');
}

function getStale(hoursThreshold = 24) {
  const cutoff = new Date(Date.now() - hoursThreshold * 60 * 60 * 1000);
  return prs.filter(pr => pr.status === 'pending' && pr.timestamp < cutoff);
}

function markReviewed(prUrl) {
  const pr = prs.find(p => p.prUrl === prUrl);
  if (pr) {
    pr.status = 'reviewed';
    return true;
  }
  return false;
}

function getAll() {
  return [...prs];
}

module.exports = { add, getPending, getStale, markReviewed, getAll };
