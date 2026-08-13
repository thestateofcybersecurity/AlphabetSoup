import { describe, expect, it } from 'vitest';
import { escHtml, renderInline } from '../src/lib/inline';

describe('renderInline', () => {
  it('renders a link', () => {
    expect(renderInline('see [MFA](/?q=MFA) first')).toBe('see <a href="/?q=MFA">MFA</a> first');
  });

  it('renders bold', () => {
    expect(renderInline('**Patch first.** Then filter.')).toBe(
      '<strong>Patch first.</strong> Then filter.',
    );
  });

  it('marks external links so they open in a new tab', () => {
    expect(renderInline('[Sucuri](https://example.com/x)')).toBe(
      '<a href="https://example.com/x" rel="noopener" target="_blank">Sucuri</a>',
    );
  });

  it('renders a link nested inside a bold run', () => {
    // The bug this file exists for: the bold run used to swallow the link and
    // emit its source characters as visible text.
    expect(renderInline('**Phishing resistant [MFA](/?q=MFA) on the login page.** Do it.')).toBe(
      '<strong>Phishing resistant <a href="/?q=MFA">MFA</a> on the login page.</strong> Do it.',
    );
  });

  it('renders bold nested inside a link label', () => {
    expect(renderInline('[**Sucuri** platform](/tools/)')).toBe(
      '<a href="/tools/"><strong>Sucuri</strong> platform</a>',
    );
  });

  it('never emits nested anchors, whatever the author brackets', () => {
    // The label matcher stops at the first "]", so a label cannot hold a link.
    // The degenerate input still has to come out as valid markup.
    const html = renderInline('[a [b](/b) c](/a)');
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toBe('<a href="/b">a [b</a> c](/a)');
  });

  it('handles several spans in one string without losing position', () => {
    expect(renderInline('**one [two](/2)** and **three** and [four](/4)')).toBe(
      '<strong>one <a href="/2">two</a></strong> and <strong>three</strong> and <a href="/4">four</a>',
    );
  });

  it('escapes literal text, labels and hrefs', () => {
    expect(renderInline('a < b & "c"')).toBe('a &lt; b &amp; &quot;c&quot;');
    expect(renderInline('[<script>](/x?a=1&b=2)')).toBe(
      '<a href="/x?a=1&amp;b=2">&lt;script&gt;</a>',
    );
    expect(renderInline('**<b>bold</b>**')).toBe('<strong>&lt;b&gt;bold&lt;/b&gt;</strong>');
  });

  it('drops an href that is not a safe scheme, including inside bold', () => {
    expect(renderInline('[x](javascript:alert(1)')).toBe('<a href="#">x</a>');
    expect(renderInline('**[x](data:text/html,hi)**')).toBe('<strong><a href="#">x</a></strong>');
  });

  it('leaves unmatched delimiters as text', () => {
    expect(renderInline('**not closed and [not a link')).toBe('**not closed and [not a link');
  });

  it('returns an empty string unchanged', () => {
    expect(renderInline('')).toBe('');
  });
});

describe('escHtml', () => {
  it('escapes the four characters that break text and attribute context', () => {
    expect(escHtml('&<>"')).toBe('&amp;&lt;&gt;&quot;');
  });
});
