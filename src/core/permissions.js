const userStore = require('../stores/user-store');

function isAdmin(userId) {
  return userStore.isAdmin(userId);
}

function requireAdmin(userId) {
  if (!isAdmin(userId)) {
    throw new Error('ADMIN_ONLY');
  }
}

module.exports = { isAdmin, requireAdmin };
