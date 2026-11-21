// Fast drop-in for csv-reader 1.0.0.
//
// Reads one CSV input {text, header} and returns {columns, rows, errors}
// with exactly csv-reader's broken-row policy:
//  - a U+FEFF at the very start is dropped;
//  - a record ends at LF or CRLF, and a line left with no characters is no record;
//  - outside quotes a CR not followed by LF is dropped (stray_cr);
//  - a field that opens with a quote runs to the next quote that is not
//    doubled, "" inside it is one quote, each CRLF or lone CR inside it is
//    read as LF; what follows its closing quote, up to the next comma or line
//    break, is appended as it stands (quote_junk, when the field ends);
//    a quote that never closes is a literal character and the text after it
//    is read again as unquoted (unterminated_quote);
//  - a quote inside an unquoted field is a literal character;
//  - fields stay strings, never trimmed or converted;
//  - columns is the first record when header is true, else null; rows holds
//    the records after it, each padded with "" (short_row, with fields: its
//    field count) or cut (long_row, with extra: the cut fields) to the first
//    record's width;
//  - each error is {code, line, row}, in the order met; line is the 1-based
//    line its record starts on, counting every LF, CRLF and lone CR inside
//    quotes; row is its record's index in rows, null for the header.
//
// Speed comes from indexOf-driven scanning: an unquoted field is one slice
// between the next comma / line break, a quoted field jumps straight to its
// next quote, and the per-character slow paths run only when a CR or a
// newline inside quotes actually shows up. Written from the spec above.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  const n = text.length;
  let columns = null;
  let width = -1;
  let pos = 0;
  let line = 1;
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows.
  let recordLine = 1;
  let recordRow = null;

  // A slice of a quoted field that may hold line breaks: CRLF and lone CR
  // each become one LF, and the line count moves by one per break.
  function convertSegment(start, end) {
    if (end <= start) return '';
    const seg = text.slice(start, end);
    if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) return seg;
    let add = 0;
    for (let i = 0; i < seg.length; i++) {
      const ch = seg.charCodeAt(i);
      if (ch === 10) add++;
      else if (ch === 13) {
        add++;
        if (seg.charCodeAt(i + 1) === 10) i++;
      }
    }
    line += add;
    return seg.replace(/\r\n?/g, '\n');
  }

  // Reads an unquoted field starting at pos, with `prefix` already kept
  // (the opening quote of an unterminated field, or a quoted field's value
  // when junk follows its closing quote). Returns {value, ended}.
  function readUnquoted(prefix) {
    const start = pos;
    const comma = text.indexOf(',', pos);
    const lf = text.indexOf('\n', pos);
    let end;
    let ended;
    if (comma === -1) {
      if (lf === -1) { end = n; ended = END; }
      else { end = lf; ended = LINE_BREAK; }
    } else if (lf === -1) { end = comma; ended = COMMA; }
    else if (comma < lf) { end = comma; ended = COMMA; }
    else { end = lf; ended = LINE_BREAK; }
    // A CR right before the terminating LF is the CRLF break itself, not
    // part of the field and not a stray CR.
    let fieldEnd = end;
    if (ended === LINE_BREAK && end > start && text.charCodeAt(end - 1) === 13) fieldEnd = end - 1;
    // The field is one slice; a stray CR can only hide inside that slice,
    // so look for it there (never scan past the field's end, where the next
    // CR may be thousands of characters away). The prefix never holds a CR:
    // a quoted value has its CRs already turned into LF, and the other
    // prefixes are '' or '"'.
    let value = prefix + text.slice(start, fieldEnd);
    let c = value.indexOf('\r', prefix.length);
    if (c === -1) {
      if (ended === COMMA) pos = end + 1;
      else if (ended === LINE_BREAK) { pos = end + 1; line++; }
      else pos = n;
      return { value, ended };
    }
    // Slow path: drop each stray CR in the slice, one error apiece.
    let kept = prefix;
    let cur = prefix.length;
    while (c !== -1) {
      errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      kept += value.slice(cur, c);
      cur = c + 1;
      c = value.indexOf('\r', cur);
    }
    kept += value.slice(cur);
    if (ended === COMMA) pos = end + 1;
    else if (ended === LINE_BREAK) { pos = end + 1; line++; }
    else pos = n;
    return { value: kept, ended };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let cur = pos + 1;
    let segStart = cur;
    let out = '';
    for (;;) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        line = openLine;
        errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
        pos = open + 1;
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        out += convertSegment(segStart, q);
        out += '"';
        cur = q + 2;
        segStart = q + 2;
        continue;
      }
      out += convertSegment(segStart, q);
      pos = q + 1;
      if (pos >= n) return { value: out, ended: END };
      const c = text.charCodeAt(pos);
      if (c === 44) { pos++; return { value: out, ended: COMMA }; }
      if (c === 10) { pos++; line++; return { value: out, ended: LINE_BREAK }; }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; return { value: out, ended: LINE_BREAK }; }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break; any characters kept are quote_junk.
      const junk = readUnquoted(out);
      if (junk.value.length > out.length) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      return junk;
    }
  }

  while (pos < n) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos++; line++; }
      else if (c === 13 && text.charCodeAt(pos + 1) === 10) { pos += 2; line++; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let ended;
    let quoted = false;
    do {
      let field;
      if (text.charCodeAt(pos) === 34) {
        field = readQuoted();
        quoted = true;
      } else {
        field = readUnquoted('');
        quoted = false;
      }
      fields.push(field.value);
      ended = field.ended;
    } while (ended === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }

  return { columns: header ? (columns ?? []) : null, rows, errors };
}
