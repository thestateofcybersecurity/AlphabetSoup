import { describe, expect, it } from 'vitest';
import { parseFeed, relativeTime, renderItems, renderStatus } from '../src/lib/news';

/**
 * The feed payload originates on criminal leak sites, so these tests care most
 * about the hostile paths: markup in names must render inert, and links must
 * not escape the ransomware.live allowlist.
 */

const NOW = new Date('2026-08-16T12:00:00Z');

const goodItem = {
  group: 'qilin',
  victim: 'Example Corp',
  sector: 'Technology',
  country: 'CA',
  discovered: '2026-08-16T09:00:00Z',
  link: 'https://www.ransomware.live/id/abc123',
};

describe('parseFeed', () => {
  it('keeps well-formed items and the updated stamp', () => {
    const feed = parseFeed({ updated: '2026-08-16T11:30:00Z', items: [goodItem] });
    expect(feed.updated).toBe('2026-08-16T11:30:00Z');
    expect(feed.items).toHaveLength(1);
    expect(feed.items[0].victim).toBe('Example Corp');
  });

  it('returns an empty feed for junk payloads', () => {
    for (const junk of [null, 'nope', 42, {}, { items: 'nope' }]) {
      expect(parseFeed(junk).items).toHaveLength(0);
    }
  });

  it('drops items without a group or a parseable timestamp', () => {
    const feed = parseFeed({
      items: [goodItem, { ...goodItem, group: '' }, { ...goodItem, discovered: 'someday' }, 'junk'],
    });
    expect(feed.items).toHaveLength(1);
  });

  it('drops links that leave ransomware.live', () => {
    const feed = parseFeed({
      items: [
        { ...goodItem, link: 'https://evil.example/phish' },
        // eslint-disable-next-line no-script-url
        { ...goodItem, link: 'javascript:alert(1)' },
        { ...goodItem, link: 'https://www.ransomware.live.evil.example/' },
      ],
    });
    expect(feed.items.map((item) => item.link)).toEqual(['', '', '']);
  });

  it('falls back to a placeholder victim name', () => {
    const feed = parseFeed({ items: [{ ...goodItem, victim: '  ' }] });
    expect(feed.items[0].victim).toBe('Unnamed victim');
  });
});

describe('renderItems', () => {
  it('escapes markup smuggled into names', () => {
    const html = renderItems(
      parseFeed({
        items: [
          {
            ...goodItem,
            group: '<img src=x onerror=alert(1)>',
            victim: '"><script>alert(2)</script>',
            sector: '<b>bold</b>',
            link: '',
          },
        ],
      }).items,
      NOW,
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;script&gt;');
  });

  it('links the victim only when a link survived parsing', () => {
    const [linked, bare] = parseFeed({ items: [goodItem, { ...goodItem, link: '' }] }).items;
    expect(renderItems([linked], NOW)).toContain('href="https://www.ransomware.live/id/abc123"');
    expect(renderItems([bare], NOW)).not.toContain('<a ');
  });
});

describe('relativeTime', () => {
  it.each([
    ['2026-08-16T11:59:30Z', 'just now'],
    ['2026-08-16T11:35:00Z', '25 minutes ago'],
    ['2026-08-16T09:00:00Z', '3 hours ago'],
    ['2026-08-13T12:00:00Z', '3 days ago'],
    ['not-a-date', ''],
  ])('formats %s as "%s"', (iso, expected) => {
    expect(relativeTime(iso, NOW)).toBe(expected);
  });

  it('never reports the future for clock skew', () => {
    expect(relativeTime('2026-08-16T12:04:00Z', NOW)).toBe('just now');
  });
});

describe('renderStatus', () => {
  it('reports count and freshness', () => {
    const feed = parseFeed({ updated: '2026-08-16T11:00:00Z', items: [goodItem] });
    expect(renderStatus(feed, NOW)).toBe('1 recent claim, updated 1 hour ago');
  });

  it('omits freshness when the stamp is missing', () => {
    const feed = parseFeed({ items: [goodItem, goodItem] });
    expect(renderStatus(feed, NOW)).toBe('2 recent claims');
  });
});
