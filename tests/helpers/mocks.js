/**
 * Shared mock helpers for Donna Slack bot tests.
 */

/**
 * Creates a mock `say()` function that captures all messages sent to it.
 * Access captured calls via `say.mock.calls` or the `messages` array.
 */
function createMockSay() {
  const messages = [];
  const say = async (msg) => {
    messages.push(msg);
  };
  say.messages = messages;
  say.reset = () => { messages.length = 0; };
  return say;
}

/**
 * Creates a mock Slack Web API client with stubs for the methods Donna uses.
 */
function createMockSlackClient() {
  return {
    conversations: {
      info: async ({ channel }) => ({
        ok: true,
        channel: { id: channel, name: `channel-${channel}`, is_member: true },
      }),
      history: async ({ channel, oldest, limit }) => ({
        ok: true,
        messages: [],
      }),
      join: async ({ channel }) => ({ ok: true }),
    },
    users: {
      info: async ({ user }) => ({
        ok: true,
        user: { id: user, name: `user-${user}`, real_name: `User ${user}` },
      }),
    },
  };
}

/**
 * Creates a mock `sendDm` function that records sent DMs.
 */
function createMockSendDm() {
  const sent = [];
  const sendDm = async (userId, message) => {
    sent.push({ userId, message });
  };
  sendDm.sent = sent;
  sendDm.reset = () => { sent.length = 0; };
  return sendDm;
}

module.exports = { createMockSay, createMockSlackClient, createMockSendDm };
