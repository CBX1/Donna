// Must be first — sets DONNA_DB_PATH=':memory:' before any require of src/db
const { resetDb } = require('../../helpers/db-setup');
const userStore = require('../../../src/stores/user-store');

beforeEach(() => {
  resetDb();
});

// ---------------------------------------------------------------------------
// getOrCreate
// ---------------------------------------------------------------------------

describe('userStore.getOrCreate', () => {
  it('creates a new user and returns it', () => {
    const user = userStore.getOrCreate('U001', 'Alice');
    expect(user).not.toBeNull();
    expect(user.id).toBe('U001');
    expect(user.display_name).toBe('Alice');
  });

  it('returns existing user without duplicating the row', () => {
    userStore.getOrCreate('U001', 'Alice');
    const user2 = userStore.getOrCreate('U001', 'Alice Updated');
    expect(user2.id).toBe('U001');

    // Only one row should exist
    const { db } = require('../../helpers/db-setup');
    const count = db.prepare('SELECT COUNT(*) as c FROM users WHERE id = ?').get('U001');
    expect(count.c).toBe(1);
  });

  it('sets is_admin to 0 by default', () => {
    const user = userStore.getOrCreate('U001', 'Alice');
    expect(user.is_admin).toBe(0);
  });

  it('creates an admin user when is_admin=1 is provided', () => {
    const user = userStore.getOrCreate('U001', 'Alice', 1);
    expect(user.is_admin).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe('userStore.getById', () => {
  it('returns null for a non-existent user', () => {
    expect(userStore.getById('UNONEXISTENT')).toBeNull();
  });

  it('returns the user when it exists', () => {
    userStore.getOrCreate('U001', 'Alice');
    const user = userStore.getById('U001');
    expect(user).not.toBeNull();
    expect(user.display_name).toBe('Alice');
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('userStore.update', () => {
  beforeEach(() => {
    userStore.getOrCreate('U001', 'Alice');
  });

  it('updates allowed fields', () => {
    userStore.update('U001', { display_name: 'Alice Smith', timezone: 'UTC' });
    const user = userStore.getById('U001');
    expect(user.display_name).toBe('Alice Smith');
    expect(user.timezone).toBe('UTC');
  });

  it('updates onboarding_complete', () => {
    userStore.update('U001', { onboarding_complete: 1 });
    const user = userStore.getById('U001');
    expect(user.onboarding_complete).toBe(1);
  });

  it('updates is_admin', () => {
    userStore.update('U001', { is_admin: 1 });
    const user = userStore.getById('U001');
    expect(user.is_admin).toBe(1);
  });

  it('ignores unknown fields', () => {
    // Should not throw even with an unrecognised field
    expect(() => userStore.update('U001', { foo: 'bar' })).not.toThrow();
    const user = userStore.getById('U001');
    expect(user.display_name).toBe('Alice'); // unchanged
  });

  it('is a no-op when fields object is empty', () => {
    expect(() => userStore.update('U001', {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isAdmin
// ---------------------------------------------------------------------------

describe('userStore.isAdmin', () => {
  it('returns false for a non-admin user', () => {
    userStore.getOrCreate('U001', 'Alice');
    expect(userStore.isAdmin('U001')).toBe(false);
  });

  it('returns true for an admin user', () => {
    userStore.getOrCreate('U001', 'Alice', 1);
    expect(userStore.isAdmin('U001')).toBe(true);
  });

  it('returns false for a non-existent user', () => {
    expect(userStore.isAdmin('UNONEXISTENT')).toBe(false);
  });

  it('reflects is_admin changes made via update()', () => {
    userStore.getOrCreate('U001', 'Alice');
    userStore.update('U001', { is_admin: 1 });
    expect(userStore.isAdmin('U001')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// listOnboarded
// ---------------------------------------------------------------------------

describe('userStore.listOnboarded', () => {
  it('returns empty array when no users exist', () => {
    expect(userStore.listOnboarded()).toEqual([]);
  });

  it('returns only users with onboarding_complete = 1', () => {
    userStore.getOrCreate('U001', 'Alice');
    userStore.getOrCreate('U002', 'Bob');
    userStore.update('U001', { onboarding_complete: 1 });

    const onboarded = userStore.listOnboarded();
    expect(onboarded).toHaveLength(1);
    expect(onboarded[0].id).toBe('U001');
  });

  it('does not return users with onboarding_complete = 0', () => {
    userStore.getOrCreate('U001', 'Alice');
    expect(userStore.listOnboarded()).toHaveLength(0);
  });
});
