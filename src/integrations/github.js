const config = require('../config');
const log = require('../utils/logger').child({ module: 'github' });

const BASE_URL = 'https://api.github.com';

function headers() {
  return {
    'Authorization': `Bearer ${config.github.token}`,
    'Accept': 'application/vnd.github.v3+json',
  };
}

/**
 * Get PR details from a URL.
 * @returns {{ state, title, author, merged, isDraft, reviewStatus }} or null
 */
async function getPrDetails(prUrl) {
  const match = prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  const [, owner, repo, prNumber] = match;

  try {
    const res = await fetch(`${BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}`, { headers: headers() });
    if (!res.ok) return null;
    const pr = await res.json();

    // Get review status
    const reviewsRes = await fetch(`${BASE_URL}/repos/${owner}/${repo}/pulls/${prNumber}/reviews`, { headers: headers() });
    let reviewStatus = 'pending';
    if (reviewsRes.ok) {
      const reviews = await reviewsRes.json();
      const latestByUser = {};
      reviews.forEach(r => { latestByUser[r.user.login] = r.state; });
      const states = Object.values(latestByUser);
      if (states.includes('CHANGES_REQUESTED')) reviewStatus = 'changes_requested';
      else if (states.includes('APPROVED')) reviewStatus = 'approved';
    }

    return {
      state: pr.merged ? 'merged' : pr.state,
      title: pr.title,
      author: pr.user?.login || 'unknown',
      merged: !!pr.merged,
      isDraft: !!pr.draft,
      reviewStatus,
      requestedReviewers: pr.requested_reviewers?.map(r => r.login) || [],
    };
  } catch (err) {
    log.error({ err, prUrl }, 'Error fetching PR');
    return null;
  }
}

/**
 * Get all open PRs where a user is a requested reviewer.
 * @param {string} username - GitHub username
 * @returns {Array<{prUrl, title, author, repo}>}
 */
async function getReviewRequests(username) {
  try {
    // user-review-requested only matches individual assignments, not team-based
    const query = encodeURIComponent(`user-review-requested:${username} is:pr is:open`);
    const res = await fetch(`${BASE_URL}/search/issues?q=${query}&per_page=50`, { headers: headers() });
    if (!res.ok) return [];
    const data = await res.json();

    return (data.items || []).map(item => ({
      prUrl: item.html_url,
      title: item.title,
      author: item.user?.login || 'unknown',
      repo: item.repository_url?.split('/').slice(-2).join('/'),
      createdAt: item.created_at,
    }));
  } catch (err) {
    log.error({ err }, 'Error fetching review requests');
    return [];
  }
}

module.exports = { getPrDetails, getReviewRequests };
