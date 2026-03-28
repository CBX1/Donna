const { parseChannel, parseUser, parseUrl } = require('../../../src/utils/slack-format');

describe('parseChannel', () => {
  it('returns empty for null/undefined input', () => {
    expect(parseChannel(null)).toEqual({ id: null, name: '' });
    expect(parseChannel(undefined)).toEqual({ id: null, name: '' });
    expect(parseChannel('')).toEqual({ id: null, name: '' });
  });

  it('parses Slack auto-link format: <#C0A6GNR0Y0G|channel-name>', () => {
    const result = parseChannel('<#C0A6GNR0Y0G|backend>');
    expect(result).toEqual({ id: 'C0A6GNR0Y0G', name: 'backend' });
  });

  it('parses raw channel ID', () => {
    const result = parseChannel('C06UP51UFTL');
    expect(result).toEqual({ id: 'C06UP51UFTL', name: null });
  });

  it('parses plain channel name with #', () => {
    const result = parseChannel('#backend');
    expect(result).toEqual({ id: null, name: 'backend' });
  });

  it('parses plain channel name without #', () => {
    const result = parseChannel('backend');
    expect(result).toEqual({ id: null, name: 'backend' });
  });

  it('lowercases plain channel names', () => {
    const result = parseChannel('Backend-Alerts');
    expect(result.name).toBe('backend-alerts');
  });
});

describe('parseUser', () => {
  it('returns null for null/undefined input', () => {
    expect(parseUser(null)).toBeNull();
    expect(parseUser(undefined)).toBeNull();
  });

  it('extracts user ID from Slack format <@U071RRL7Y5S>', () => {
    expect(parseUser('<@U071RRL7Y5S>')).toBe('U071RRL7Y5S');
  });

  it('returns raw value if not in Slack format', () => {
    expect(parseUser('U071RRL7Y5S')).toBe('U071RRL7Y5S');
  });
});

describe('parseUrl', () => {
  it('returns null for null/undefined input', () => {
    expect(parseUrl(null)).toBeNull();
    expect(parseUrl(undefined)).toBeNull();
  });

  it('extracts URL from Slack format <url|text>', () => {
    expect(parseUrl('<https://github.com/foo/bar|github.com/foo/bar>')).toBe('https://github.com/foo/bar');
  });

  it('extracts URL from Slack format without display text', () => {
    expect(parseUrl('<https://example.com>')).toBe('https://example.com');
  });

  it('returns raw value if not in Slack format', () => {
    expect(parseUrl('https://example.com')).toBe('https://example.com');
  });
});
