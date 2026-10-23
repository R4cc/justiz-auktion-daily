// Shared, code-native case artwork for the store, inventory and auction lots.
function caseArtwork(item = {}) {
  const designs = ['lost-property', 'evidence-locker', 'seizure', 'vault', 'collectors-cache'];
  const tiers = ['common', 'uncommon', 'rare', 'epic', 'legendary'];
  const requested = item.caseType || item.id;
  const themedDesign=item.caseDesign||item.design;
  const design = designs.includes(themedDesign)?themedDesign:designs.includes(requested) ? requested : designs[Math.max(0, tiers.indexOf(item.caseTier))];
  const badge = accountEscape(item.caseBadge || item.badge || (item.caseTier ? rarityLabel(item.caseTier) : ['LP','EL','ST','VT','CC'][designs.indexOf(design)]));
  const box = (top, front, side, detail) => `<path d="${top}" class="case-surface-top"/><path d="${side}" class="case-surface-side"/><path d="${front}" class="case-surface-front"/>${detail}`;
  const pictures = {
    'lost-property': box('M54 87 185 51 269 85 138 122Z', 'M54 87 138 122 138 204 54 168Z', 'M138 122 269 85 269 167 138 204Z',
      `<g class="case-wood-lines"><path d="M54 110 138 145 269 108M54 141 138 176 269 139"/></g><path class="case-band" d="m88 101 15 6v82l-15-6Zm122-34 15 6-131 36-15-6Z"/><path class="case-edge" d="m138 122 0 82M54 87l84 35 131-37"/><path fill="#f5e9cb" d="m170 139 58-16v33l-58 16Z"/><path stroke="#514b3a" stroke-width="3" d="m180 143 38-11m-38 19 22-6m-22 14 33-9"/><circle fill="#c45839" cx="252" cy="111" r="7"/>`),
    'evidence-locker': box('M53 98 184 63 271 97 140 133Z', 'M53 98 140 133 140 194 53 160Z', 'M140 133 271 97 271 160 140 194Z',
      `<path class="case-edge" d="m53 111 87 34 131-36m-131 36v49"/><path fill="none" stroke="#aecbd1" stroke-width="5" d="m125 79 20-6 29 11v9l-8 2v-7l-19-7-14 4v6l-8-3Z"/><g fill="#d0e2e3"><path d="m53 98 18 7v9l-18-7Zm0 53 18 7v9l-18-7Zm73-24 14 6v12l-14-6Zm14 6 18-5v12l-18 5Zm113-31 18-5v12l-18 5Zm0 53 18-5v12l-18 5Z"/></g><path fill="#e2ac5e" d="m198 117 15-4v61l-15 4Z"/><path fill="#ecede5" d="m224 127 27-7v16l-27 7Z"/><path stroke="#24444e" stroke-width="2" d="m230 130 15-4m-15 10 12-4"/>`),
    seizure: box('M49 94Q43 66 83 62L182 34Q217 29 274 74L139 112Z', 'M49 94 139 112 139 200 49 165Z', 'M139 112 274 74 274 162 139 200Z',
      `<path class="case-edge" d="m49 104 90 34 135-38M49 149l90 34 135-38"/><path class="case-band" d="m78 97 15 5v80l-15-6Zm166-47 14 9-135 37-13-6Z"/><path fill="#ecc278" d="m190 118 28-8v27l-28 8Z"/><path fill="#704a28" d="m198 121 11-3v10l-11 3Z"/><g fill="#d5ae68"><circle cx="62" cy="114" r="3"/><circle cx="122" cy="136" r="3"/><circle cx="153" cy="139" r="3"/><circle cx="260" cy="108" r="3"/><circle cx="260" cy="154" r="3"/><circle cx="61" cy="157" r="3"/></g>`),
    vault: box('M74 65 202 31 261 63 133 98Z', 'M74 65 133 98 133 209 74 177Z', 'M133 98 261 63 261 174 133 209Z',
      `<path class="case-vault-door" d="m148 110 97-27v80l-97 27Z"/><path fill="none" stroke="#9ba8bc" stroke-width="4" d="m156 111 0 66m-4-60 8-2m-8 54 8-2"/><ellipse cx="208" cy="134" rx="22" ry="25" fill="#18262e" stroke="#afbbc7" stroke-width="4"/><g stroke="#e4e8d9" stroke-width="5" stroke-linecap="round"><path d="m208 134 0-15m0 15 14 4m-14-4-12 12"/></g><ellipse cx="208" cy="134" rx="5" ry="6" fill="#afbcd0"/><path stroke="#78dac2" stroke-width="3" d="m229 98 7-2"/><path class="case-edge" d="m74 65 59 33 128-35m-128 35v111"/>`),
    'collectors-cache': box('M49 88 184 46 273 83 138 125Z', 'M49 88 138 125 138 203 49 166Z', 'M138 125 273 83 273 160 138 203Z',
      `<path class="case-gold-line" d="m49 88 89 37 135-42m-135 42v78M58 105l69 29v50l-69-28Zm92 30 111-35v50l-111 35Z"/><path fill="#e8c883" d="m65 96 19 8v17l-19-8Zm-16 50 20 9v19l-20-8Zm70-26 19 5 19-6v17l-19 6-19-8Zm135-31 19-6v18l-19 6Zm0 55 19-6v22l-19 6Z"/><path fill="#efd28f" d="m197 117 16 9-4 26-21 6-5-24Z"/><path fill="#695c92" d="m197 124 10 5-3 17-12 3-3-13Z"/><path class="case-gold-line" d="m120 79 30-9 23 9-30 9Zm23 0v9"/>`)
  };
  return `<div class="case-object case-design-${design}" aria-hidden="true"><svg viewBox="0 0 320 250" fill="none" xmlns="http://www.w3.org/2000/svg"><ellipse class="case-object-shadow" cx="166" cy="216" rx="109" ry="15"/>${pictures[design]}<text x="104" y="151" transform="rotate(22 104 151)" text-anchor="middle" class="case-object-badge">${badge}</text></svg></div>`;
}
