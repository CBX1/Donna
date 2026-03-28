const { formatAge, parseTime, todayIST } = require('../../../src/utils/time');

describe('formatAge', () => {
  it('returns "just now" for timestamps less than 1 hour ago', () => {
    const recent = new Date(Date.now() - 30 * 60 * 1000).toISOString(); // 30 min ago
    expect(formatAge(recent)).toBe('just now');
  });

  it('returns hours for timestamps less than 24 hours ago', () => {
    const fiveHoursAgo = new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString();
    expect(formatAge(fiveHoursAgo)).toBe('5h ago');
  });

  it('returns days for timestamps more than 24 hours ago', () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
    expect(formatAge(threeDaysAgo)).toBe('3d ago');
  });

  it('returns "1h ago" for exactly 1 hour', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect(formatAge(oneHourAgo)).toBe('1h ago');
  });
});

describe('parseTime', () => {
  it('returns null for empty input', () => {
    expect(parseTime(null)).toBeNull();
    expect(parseTime('')).toBeNull();
    expect(parseTime(undefined)).toBeNull();
  });

  it('parses ISO 8601 date strings', () => {
    const iso = '2026-03-28T10:00:00.000Z';
    const result = parseTime(iso);
    expect(result).toBeInstanceOf(Date);
    expect(result.toISOString()).toBe(iso);
  });

  it('parses "in X hours"', () => {
    const before = Date.now();
    const result = parseTime('in 2 hours');
    const after = Date.now();
    const expected = 2 * 60 * 60 * 1000;
    expect(result.getTime()).toBeGreaterThanOrEqual(before + expected - 100);
    expect(result.getTime()).toBeLessThanOrEqual(after + expected + 100);
  });

  it('parses "in X minutes"', () => {
    const before = Date.now();
    const result = parseTime('in 30 minutes');
    const expected = 30 * 60 * 1000;
    expect(result.getTime()).toBeGreaterThanOrEqual(before + expected - 100);
  });

  it('parses "in next X minutes"', () => {
    const result = parseTime('in next 15 minutes');
    expect(result).toBeInstanceOf(Date);
    expect(result.getTime()).toBeGreaterThan(Date.now());
  });

  it('parses "after X hours"', () => {
    const result = parseTime('after 3 hours');
    expect(result).toBeInstanceOf(Date);
    const diff = result.getTime() - Date.now();
    expect(diff).toBeGreaterThan(2.9 * 60 * 60 * 1000);
    expect(diff).toBeLessThan(3.1 * 60 * 60 * 1000);
  });

  it('parses "half an hour"', () => {
    const result = parseTime('half an hour');
    expect(result).toBeInstanceOf(Date);
    const diff = result.getTime() - Date.now();
    expect(diff).toBeGreaterThan(29 * 60 * 1000);
    expect(diff).toBeLessThan(31 * 60 * 1000);
  });

  it('parses "tomorrow at 10am"', () => {
    const result = parseTime('tomorrow at 10am');
    expect(result).toBeInstanceOf(Date);
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(result.getDate()).toBe(tomorrow.getDate());
    expect(result.getHours()).toBe(10);
    expect(result.getMinutes()).toBe(0);
  });

  it('parses "tomorrow at 3:30pm"', () => {
    const result = parseTime('tomorrow at 3:30pm');
    expect(result).toBeInstanceOf(Date);
    expect(result.getHours()).toBe(15);
    expect(result.getMinutes()).toBe(30);
  });

  it('parses "at 4pm"', () => {
    const result = parseTime('at 4pm');
    expect(result).toBeInstanceOf(Date);
    expect(result.getHours()).toBe(16);
    expect(result.getMinutes()).toBe(0);
  });

  it('parses "at 9:15am"', () => {
    const result = parseTime('at 9:15am');
    expect(result).toBeInstanceOf(Date);
    // Should be 9 AM (or next day if past 9 AM)
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(15);
  });

  it('returns null for unparseable strings', () => {
    expect(parseTime('whenever you feel like it')).toBeNull();
  });
});

describe('todayIST', () => {
  it('returns a YYYY-MM-DD formatted string', () => {
    const result = todayIST();
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
