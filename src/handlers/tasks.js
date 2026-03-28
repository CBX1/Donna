const notion = require('../integrations/notion');
const userStore = require('../stores/user-store');
const { formatAge } = require('../utils/time');

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const CREATE_REPLIES = [
  (t) => `Done. "${t}" is on the board. I'll remember even if you won't.`,
  (t) => `Added "${t}" to your list. You're welcome.`,
  (t) => `"${t}" — noted. I've got you covered.`,
  (t) => `Task created: "${t}". Now go make it happen.`,
];

const DONE_REPLIES = [
  (t) => `"${t}" — done and dusted. Feels good, doesn't it?`,
  (t) => `Crossed off "${t}". Another one bites the dust.`,
  (t) => `"${t}" marked as done. I knew you had it in you.`,
];

async function handleCreate(userId, params) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) {
    return "I don't have a Notion database set up for you yet. Tell me to set up or share a Notion database link.";
  }
  try {
    await notion.createTask(user.notion_database_id, params.title);
    return pick(CREATE_REPLIES)(params.title);
  } catch (err) {
    console.error('Task creation failed:', err.message);
    return `Couldn't create that task. Notion says: ${err.message}`;
  }
}

async function handleQuery(userId, params) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) {
    return "No Notion database set up for you yet. Tell me to set up or share a Notion database link.";
  }
  try {
    const status = params.status || 'open';
    const allItems = await notion.queryTasks(user.notion_database_id, status);
    const tasks = allItems.filter(t => t.type !== 'PR Review');

    if (tasks.length === 0) {
      return status === 'done'
        ? "No completed tasks yet."
        : "Your task list is empty. Either you're crushing it or you're in denial.";
    }

    const lines = tasks.map(t =>
      `• ${t.status === 'Done' ? '~' + t.title + '~' : t.title} — ${formatAge(t.created)}`
    );

    const header = status === 'open'
      ? `You've got *${tasks.length} open tasks*. Here's what's on your plate:`
      : `*${status === 'all' ? 'All' : 'Completed'} tasks (${tasks.length}):*`;
    return `${header}\n${lines.join('\n')}`;
  } catch (err) {
    console.error('Task query failed:', err.message);
    return `Couldn't fetch your tasks: ${err.message}`;
  }
}

async function handleUpdate(userId, params) {
  const user = userStore.getById(userId);
  if (!user?.notion_database_id) return "No Notion database set up for you.";
  try {
    const task = await notion.updateTaskStatus(user.notion_database_id, params.query, params.status);
    if (!task) return `Couldn't find anything matching "${params.query}". Try being more specific.`;
    return pick(DONE_REPLIES)(task.title);
  } catch (err) {
    return `Couldn't update that task: ${err.message}`;
  }
}

module.exports = { handleCreate, handleQuery, handleUpdate };
