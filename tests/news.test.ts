import { describe, expect, it } from 'vitest';
import {
  parseDirectory,
  parseFeed,
  parseHeadlines,
  relativeTime,
  renderDirectory,
  renderHeadlines,
  renderItems,
  renderStatus,
} from '../src/lib/news';

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

const goodHeadline = {
  source: 'BleepingComputer',
  sourceUrl: 'https://www.bleepingcomputer.com/',
  title: 'Big breach at Example Corp',
  link: 'https://www.bleepingcomputer.com/news/big-breach/',
  date: '2026-08-16T09:00:00Z',
  excerpt: 'An example excerpt.',
};

describe('parseHeadlines', () => {
  it('keeps well-formed items', () => {
    const feed = parseHeadlines({ updated: '2026-08-16T11:30:00Z', items: [goodHeadline] });
    expect(feed.updated).toBe('2026-08-16T11:30:00Z');
    expect(feed.items).toHaveLength(1);
  });

  it('returns an empty feed for junk payloads', () => {
    for (const junk of [null, 'nope', 42, {}, { items: 'nope' }]) {
      expect(parseHeadlines(junk).items).toHaveLength(0);
    }
  });

  it('drops items whose link is not https', () => {
    const feed = parseHeadlines({
      items: [
        { ...goodHeadline, link: 'http://insecure.example/story' },
        // eslint-disable-next-line no-script-url
        { ...goodHeadline, link: 'javascript:alert(1)' },
        { ...goodHeadline, link: '' },
      ],
    });
    expect(feed.items).toHaveLength(0);
  });

  it('blanks a non-https sourceUrl but keeps the item', () => {
    const feed = parseHeadlines({ items: [{ ...goodHeadline, sourceUrl: 'ftp://x' }] });
    expect(feed.items[0].sourceUrl).toBe('');
  });
});

describe('renderHeadlines', () => {
  it('escapes markup smuggled into titles and sources', () => {
    const html = renderHeadlines(
      parseHeadlines({
        items: [{ ...goodHeadline, title: '<img src=x onerror=alert(1)>', source: '<b>x</b>' }],
      }).items,
      NOW,
    );
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<b>');
    expect(html).toContain('&lt;img');
  });

  it('links each headline to the original story', () => {
    const html = renderHeadlines(parseHeadlines({ items: [goodHeadline] }).items, NOW);
    expect(html).toContain('href="https://www.bleepingcomputer.com/news/big-breach/"');
    expect(html).toContain('3 hours ago');
  });
});

const goodFeedInfo = {
  name: 'Krebs on Security',
  category: 'Blogs',
  url: 'https://krebsonsecurity.com/feed/',
  homepage: 'https://krebsonsecurity.com/',
  blurb: 'Investigative reporting.',
};

describe('parseDirectory and renderDirectory', () => {
  it('parses and groups by category', () => {
    const feeds = parseDirectory({
      feeds: [goodFeedInfo, { ...goodFeedInfo, name: 'The Record', category: 'News' }],
    });
    expect(feeds).toHaveLength(2);
    const html = renderDirectory(feeds);
    expect(html).toContain('<h3>Blogs</h3>');
    expect(html).toContain('<h3>News</h3>');
    expect(html).toContain('href="https://krebsonsecurity.com/feed/"');
  });

  it('drops entries without an https feed url and returns [] for junk', () => {
    expect(parseDirectory({ feeds: [{ ...goodFeedInfo, url: 'http://x' }] })).toHaveLength(0);
    expect(parseDirectory(null)).toHaveLength(0);
    expect(parseDirectory({ feeds: 'nope' })).toHaveLength(0);
  });

  it('escapes markup in names and blurbs', () => {
    const html = renderDirectory(
      parseDirectory({
        feeds: [{ ...goodFeedInfo, name: '<script>x</script>', blurb: '<i>y</i>', homepage: '' }],
      }),
    );
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<i>');
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
