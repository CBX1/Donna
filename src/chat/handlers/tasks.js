const notion = require('../../integrations/notion');

function formatAge(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const CREATE_REPLIES = [
  (t) => `Done. "${t}" is on the board. I'll remember even if you won't.`,
  (t) => `Added "${t}" to your list. You're welcome.`,
  (t) => `"${t}" — noted. I've got you covered.`,
  (t) => `Task created: "${t}". Now go make it happen.`,
  (t) => `"${t}" is tracked. One less thing for you to forget.`,
];

const DONE_REPLIES = [
  (t) => `"${t}" — done and dusted. Feels good, doesn't it?`,
  (t) => `Crossed off "${t}". Another one bites the dust.`,
  (t) => `"${t}" marked as done. I knew you had it in you.`,
  (t) => `Done. "${t}" is off your plate.`,
];

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function handleCreate(params) {
  try {
    await notion.createTask(params.title);
    return pick(CREATE_REPLIES)(params.title);
  } catch (err) {
    console.error('Task creation failed:', err.message);
    return `Hmm, couldn't create that task. Notion's being difficult: ${err.message}`;
  }
}

async function handleQuery(params) {
  try {
    const status = params.status || 'open';
    const allItems = await notion.queryTasks(status);
    const tasks = allItems.filter(t => t.type !== 'PR Review');

    if (tasks.length === 0) {
      return status === 'done'
        ? "No completed tasks yet. The journey of a thousand tasks begins with a single checkbox."
        : "Your task list is empty. Either you're crushing it or you're in denial. 😏";
    }

    const lines = tasks.map(t =>
      `• ${t.status === 'Done' ? '~' + t.title + '~' : t.title} — ${formatAge(t.created)}`
    );

    const label = status === 'all' ? 'All' : status === 'done' ? 'Completed' : 'Open';
    const header = status === 'open'
      ? `You've got *${tasks.length} open tasks*. Here's what's on your plate:`
      : `*${label} tasks (${tasks.length}):*`;
    return `${header}\n${lines.join('\n')}`;
  } catch (err) {
    console.error('Task query failed:', err.message);
    return `I tried to check your tasks, but Notion wasn't cooperating: ${err.message}`;
  }
}

async function handleUpdate(params) {
  try {
    const task = await notion.updateTaskStatus(params.query, params.status);
    if (!task) {
      return `Couldn't find anything matching "${params.query}". Try being a little more specific — I'm good, but I'm not _that_ good.`;
    }
    return pick(DONE_REPLIES)(task.title);
  } catch (err) {
    console.error('Task update failed:', err.message);
    return `Tried to update that task but hit a wall: ${err.message}`;
  }
}

module.exports = { handleCreate, handleQuery, handleUpdate };
