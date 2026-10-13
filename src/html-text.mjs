import named from './html-entities.json' with { type: 'json' };

// HTML numeric references use these Windows-1252 replacements for C1 controls.
const numericReplacements = {
  128: 0x20ac, 130: 0x201a, 131: 0x0192, 132: 0x201e, 133: 0x2026,
  134: 0x2020, 135: 0x2021, 136: 0x02c6, 137: 0x2030, 138: 0x0160,
  139: 0x2039, 140: 0x0152, 142: 0x017d, 145: 0x2018, 146: 0x2019,
  147: 0x201c, 148: 0x201d, 149: 0x2022, 150: 0x2013, 151: 0x2014,
  152: 0x02dc, 153: 0x2122, 154: 0x0161, 155: 0x203a, 156: 0x0153,
  158: 0x017e, 159: 0x0178
};
const maximumNameLength = Math.max(...Object.keys(named).map(name => name.length));

// Decode exactly once. Decoded angle brackets are text, not a second HTML pass.
// The attribute guard preserves URLs containing e.g. "&copy=2".
export function decodeHtmlEntities(value = '', { attribute = false, legacyRepair = false } = {}) {
  return String(value).replace(/&(?:#[xX][0-9a-fA-F]+;?|#[0-9]+;?|[A-Za-z][A-Za-z0-9]*;?)/g, (match, offset, input) => {
    const reference = match.slice(1);
    if (legacyRepair && match.endsWith(';') && (reference.startsWith('#') || previouslySupported.has(reference.slice(0, -1).toLowerCase()))) return match;
    if (reference.startsWith('#')) {
      const hexadecimal = reference[1]?.toLowerCase() === 'x';
      const point = Number.parseInt(reference.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
      if (!Number.isFinite(point) || !point || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) return '\ufffd';
      return String.fromCodePoint(numericReplacements[point] ?? point);
    }
    // Longest-match handling includes the standard legacy semicolonless names.
    for (let length = Math.min(maximumNameLength, reference.length); length > 0; length--) {
      const name = reference.slice(0, length);
      if (!Object.hasOwn(named, name)) continue;
      const next = reference[length] ?? input[offset + 1 + length] ?? '';
      if (attribute && !name.endsWith(';') && /[=A-Za-z0-9]/.test(next)) return match;
      return named[name] + reference.slice(length);
    }
    return match;
  });
}

// Old collectors already decoded these references. Leave them alone when
// repairing saved text, so deliberately literal "&amp;" etc. aren't decoded twice.
const previouslySupported = new Set('amp quot apos lt gt nbsp auml ouml uuml szlig euro lowbar period comma colon sol frasl permil newline'.split(' '));
export function repairLegacyAuctionText(value) {
  return decodeHtmlEntities(value, { legacyRepair: true });
}
