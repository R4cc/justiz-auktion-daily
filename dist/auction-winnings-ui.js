window.auctionWinningsUi = (() => {
  const esc = accountEscape;
  function card(reward) {
    return `<a class="house-winnings-card" href="${esc(reward.href)}" data-page data-unopened-reward="${esc(reward.kind+':'+reward.id)}"><span class="house-winnings-art" aria-hidden="true">${reward.kind === 'case' ? caseArtwork(reward.box) : window.paletteUi.art(reward.offer)}</span><span class="house-winnings-copy"><h3>${esc(t(reward.name,reward.nameDe))}</h3><span class="house-winnings-action">${t('Open','Öffnen')} <span aria-hidden="true">→</span></span></span></a>`;
  }
  function markup(rewards) {
    if (!rewards.length) return '';
    const shown = rewards.slice(0,6), remaining = rewards.slice(6);
    return `<section class="house-winnings" aria-labelledby="house-winnings-title"><header><div><h2 id="house-winnings-title">${t('Unopened rewards','Ungeöffnete Gewinne')}</h2></div><span class="house-winnings-count" aria-label="${rewards.length} ${t('unopened rewards','ungeöffnete Gewinne')}">${number(rewards.length)}</span></header><div class="house-winnings-grid">${shown.map(card).join('')}</div>${remaining.length ? `<details class="house-winnings-more"><summary>${t('Show more','Weitere anzeigen')} (${number(remaining.length)})</summary><div class="house-winnings-grid">${remaining.map(card).join('')}</div></details>` : ''}</section>`;
  }
  return { markup };
})();
