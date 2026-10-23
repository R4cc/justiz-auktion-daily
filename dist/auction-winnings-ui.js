window.auctionWinningsUi = (() => {
  const esc = accountEscape;
  let owner=null,moreOpen=false;
  function card(reward) {
    return `<a class="house-winnings-card" href="${esc(reward.href)}" data-page data-unopened-reward="${esc(reward.kind+':'+reward.id)}"><span class="house-winnings-art" aria-hidden="true">${reward.kind === 'case' ? caseArtwork(reward.box) : window.paletteUi.art(reward.offer)}</span><span class="house-winnings-copy"><h3>${esc(t(reward.name,reward.nameDe))}</h3><span class="house-winnings-action">${t('Open','Öffnen')} <span aria-hidden="true">→</span></span></span></a>`;
  }
  function markup(rewards) {
    const sameOwner=owner===account?.id;
    if(!sameOwner){owner=account?.id;moreOpen=false;}
    const previous=document.querySelector('.house-winnings-more');
    if(sameOwner&&previous)moreOpen=previous.open;
    const active=sameOwner?document.activeElement:null,focusedReward=active?.closest('[data-unopened-reward]')?.dataset.unopenedReward;
    const focusedSummary=previous?.querySelector('summary')===active;
    const viewer=owner;
    if(focusedReward||focusedSummary)queueMicrotask(()=>{
      if(account?.id!==viewer||currentAccountPage!=='/auction-house'||document.activeElement!==document.body)return;
      const target=focusedReward?document.querySelector(`[data-unopened-reward="${CSS.escape(focusedReward)}"]`):document.querySelector('.house-winnings-more > summary');
      (target||document.querySelector('.house-winnings-more > summary')||document.querySelector('#house-winnings-title')||document.querySelector('#house-title'))?.focus({preventScroll:true});
    });
    if (!rewards.length) return '';
    const shown = rewards.slice(0,6), remaining = rewards.slice(6);
    return `<section class="house-winnings" aria-labelledby="house-winnings-title"><header><div><h2 id="house-winnings-title" tabindex="-1">${t('Unopened rewards','Ungeöffnete Gewinne')}</h2></div><span class="house-winnings-count" aria-label="${rewards.length} ${t('unopened rewards','ungeöffnete Gewinne')}">${number(rewards.length)}</span></header><div class="house-winnings-grid">${shown.map(card).join('')}</div>${remaining.length ? `<details class="house-winnings-more"${moreOpen?' open':''}><summary>${t('Show more','Weitere anzeigen')} (${number(remaining.length)})</summary><div class="house-winnings-grid">${remaining.map(card).join('')}</div></details>` : ''}</section>`;
  }
  return { markup };
})();
