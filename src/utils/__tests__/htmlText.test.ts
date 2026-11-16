import { htmlToPlainText, looksLikeHtml } from '../htmlText';

// An airline itinerary as a phone calendar delivers it (synthetic data).
const ITINERARY = [
  '<html>',
  '<head>',
  '<meta http-equiv="Content-Type" content="text/html; charset=utf-8">',
  '<style>.x{color:red}</style>',
  '</head>',
  '<body>',
  '<div style="font-family:Segoe UI;font-size:11pt;text-align:center; ">',
  '<div style="padding-top:15px"><span style="font-size:14pt">Example Air flight 2026 (2 hours, 13 minutes)</span><br>',
  'Confirmation code: ABC123</div>',
  '<div height="30px">&nbsp;</div>',
  '<div>Passengers: Dana Lee</div>',
  '<div height="30px">&nbsp;</div>',
  '<div><a href="https://www.example-air.com/manage?pnr=ABC123&amp;lastName=Lee" style="color: #0078D7;">Online check-in</a></div>',
  '<div><b>Departs</b> at 13:00 on Monday, November 16, 2026 from Cancun (CUN)</div>',
  '</div>',
  '</body>',
  '</html>',
].join('\n');

describe('htmlToPlainText', () => {
  it('turns an HTML itinerary into readable lines, keeping the link address', () => {
    expect(htmlToPlainText(ITINERARY)).toBe(
      [
        'Example Air flight 2026 (2 hours, 13 minutes)',
        'Confirmation code: ABC123',
        '',
        'Passengers: Dana Lee',
        '',
        'Online check-in (https://www.example-air.com/manage?pnr=ABC123&lastName=Lee)',
        'Departs at 13:00 on Monday, November 16, 2026 from Cancun (CUN)',
      ].join('\n'),
    );
  });

  it('leaves plain text untouched, even with a "<" in it', () => {
    for (const text of ['Agenda:\n- pricing\n- launch', 'Budget < 5k and > 2k', 'I <3 this', 'Join: https://meet.google.com/abc-defg-hij', '']) {
      expect(htmlToPlainText(text)).toBe(text);
      expect(looksLikeHtml(text)).toBe(false);
    }
  });

  it('handles Google Calendar style markup: br, lists, bold, entities and a bare link', () => {
    const google = 'Agenda:<br><ul><li>Pricing &amp; plans</li><li>Launch&nbsp;date</li></ul><b>Notes</b>: see <a href="https://example.com/doc">https://example.com/doc</a>';
    expect(htmlToPlainText(google)).toBe(['Agenda:', '- Pricing & plans', '- Launch date', 'Notes: see https://example.com/doc'].join('\n'));
  });

  it('decodes numeric entities and folds typographic ones to plain punctuation', () => {
    expect(htmlToPlainText('<p>Caf&#233; &#x2013; 5&nbsp;min &mdash; &ldquo;ok&rdquo;&hellip;</p>')).toBe('Caf\u00E9 \u2013 5 min - "ok"...');
  });

  it('drops scripts, styles and comments with their content, and keeps a mailto address', () => {
    expect(htmlToPlainText('<div><!-- x --><script>alert(1)</script>Write to <a href="mailto:ana@example.com">Ana</a></div>')).toBe(
      'Write to Ana (ana@example.com)',
    );
  });
});
