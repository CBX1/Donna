const config = require('../config');
const log = require('../utils/logger').child({ module: 'notion' });

const BASE_URL = 'https://api.notion.com/v1';
const HEADERS = {
  'Authorization': `Bearer ${config.notion.apiKey}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28',
};

async function apiCall(path, method = 'GET', body = null) {
  const options = { method, headers: HEADERS };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${BASE_URL}${path}`, options);
  const data = await res.json();
  if (!res.ok) throw new Error(data.message || 'Notion API error');
  return data;
}

function parsePage(page) {
  return {
    id: page.id,
    title: page.properties.Name?.title?.[0]?.plain_text || 'Untitled',
    status: page.properties.Status?.select?.name || 'Unknown',
    type: page.properties.Type?.select?.name || '',
    assignee: page.properties.Assignee?.rich_text?.[0]?.plain_text || '',
    url: page.properties.URL?.url || '',
    created: page.created_time,
  };
}

async function createTask(databaseId, title) {
  const page = await apiCall('/pages', 'POST', {
    parent: { database_id: databaseId },
    properties: {
      'Name': { title: [{ text: { content: title } }] },
      'Status': { select: { name: 'Open' } },
      'Type': { select: { name: 'Task' } },
    },
  });
  return parsePage(page);
}

async function createPrReview(databaseId, { prUrl, context, assignee }) {
  // Check if PR already exists in Notion by URL
  const existing = await apiCall(`/databases/${databaseId}/query`, 'POST', {
    filter: { property: 'URL', url: { equals: prUrl } },
    page_size: 1,
  });
  if (existing.results?.length > 0) {
    const page = existing.results[0];
    const currentStatus = page.properties?.Status?.select?.name;
    // Re-open if it was marked Done
    if (currentStatus === 'Done') {
      await apiCall(`/pages/${page.id}`, 'PATCH', {
        properties: { 'Status': { select: { name: 'Open' } } },
      });
    }
    return parsePage(page);
  }

  const page = await apiCall('/pages', 'POST', {
    parent: { database_id: databaseId },
    properties: {
      'Name': { title: [{ text: { content: context } }] },
      'Status': { select: { name: 'Open' } },
      'Type': { select: { name: 'PR Review' } },
      'Assignee': { rich_text: [{ text: { content: assignee } }] },
      'URL': { url: prUrl },
    },
  });
  return parsePage(page);
}

async function queryTasks(databaseId, status) {
  const filter = status && status !== 'all'
    ? { property: 'Status', select: { equals: status === 'done' ? 'Done' : 'Open' } }
    : undefined;

  const body = { page_size: 100 };
  if (filter) body.filter = filter;
  body.sorts = [{ timestamp: 'created_time', direction: 'descending' }];

  const data = await apiCall(`/databases/${databaseId}/query`, 'POST', body);
  return data.results.map(parsePage);
}

async function updateTaskStatus(databaseId, query, status) {
  const tasks = await queryTasks(databaseId, 'all');
  const match = tasks.find(t => t.title.toLowerCase().includes(query.toLowerCase()));
  if (!match) return null;

  await apiCall(`/pages/${match.id}`, 'PATCH', {
    properties: {
      'Status': { select: { name: status === 'done' ? 'Done' : 'Open' } },
    },
  });
  return match;
}

/**
 * Mark a PR as Done in Notion by finding it via URL.
 */
async function markPrDoneByUrl(databaseId, prUrl) {
  try {
    const data = await apiCall(`/databases/${databaseId}/query`, 'POST', {
      filter: { property: 'URL', url: { equals: prUrl } },
      page_size: 1,
    });
    if (!data.results?.length) return null;

    const pageId = data.results[0].id;
    await apiCall(`/pages/${pageId}`, 'PATCH', {
      properties: {
        'Status': { select: { name: 'Done' } },
      },
    });
    return parsePage(data.results[0]);
  } catch (err) {
    log.error({ err }, 'Failed to mark PR done');
    return null;
  }
}

/**
 * Query PR Review pages from Notion, filtered by Status.
 * Returns pages of Type='PR Review' and (optionally) Status='Open'.
 */
async function queryPrReviews(databaseId, status = 'open') {
  const filters = [
    { property: 'Type', select: { equals: 'PR Review' } },
  ];
  if (status && status !== 'all') {
    filters.push({ property: 'Status', select: { equals: status === 'done' ? 'Done' : 'Open' } });
  }

  const body = {
    filter: { and: filters },
    sorts: [{ timestamp: 'created_time', direction: 'descending' }],
    page_size: 100,
  };

  const data = await apiCall(`/databases/${databaseId}/query`, 'POST', body);
  return data.results.map(page => ({
    ...parsePage(page),
    ghState: page.properties['GH State']?.select?.name || null,
    reviewStatus: page.properties['Review Status']?.select?.name || null,
  }));
}

/**
 * Update fields on an existing PR Review page found by URL.
 */
async function updatePrReview(databaseId, prUrl, fields) {
  try {
    const data = await apiCall(`/databases/${databaseId}/query`, 'POST', {
      filter: { property: 'URL', url: { equals: prUrl } },
      page_size: 1,
    });
    if (!data.results?.length) return null;

    const pageId = data.results[0].id;
    const properties = {};

    if (fields.status) {
      properties['Status'] = { select: { name: fields.status === 'done' ? 'Done' : 'Open' } };
    }
    if (fields.ghState) {
      properties['GH State'] = { select: { name: fields.ghState } };
    }
    if (fields.reviewStatus) {
      properties['Review Status'] = { select: { name: fields.reviewStatus } };
    }

    await apiCall(`/pages/${pageId}`, 'PATCH', { properties });
    return { id: pageId, prUrl };
  } catch (err) {
    log.error({ err }, 'Failed to update PR review');
    return null;
  }
}

async function ensureColumns(databaseId) {
  try {
    await fetch(`${BASE_URL}/databases/${databaseId}`, {
      method: 'PATCH',
      headers: HEADERS,
      body: JSON.stringify({
        properties: {
          'Type': { select: { options: [{ name: 'Task', color: 'blue' }, { name: 'PR Review', color: 'purple' }] } },
          'Assignee': { rich_text: {} },
          'URL': { url: {} },
          'GH State': { select: { options: [
            { name: 'open', color: 'green' },
            { name: 'closed', color: 'red' },
            { name: 'merged', color: 'purple' },
            { name: 'draft', color: 'gray' },
          ] } },
          'Review Status': { select: { options: [
            { name: 'pending', color: 'yellow' },
            { name: 'approved', color: 'green' },
            { name: 'changes_requested', color: 'red' },
          ] } },
        },
      }),
    });
  } catch { /* expected: ensureColumns is best-effort, column may already exist */ }
}

module.exports = { createTask, createPrReview, queryPrReviews, updatePrReview, queryTasks, updateTaskStatus, markPrDoneByUrl, ensureColumns };
