// One shared category quote for the Auction House and inventory cards.
window.marketTrendUi = (() => {
  let categories=new Map(),sequence=0;
  async function load(visit) {
    const request=++sequence;
    await economyReady;
    const result=economyFlags.market?await window.justizEconomy.market():null;
    if(request!==sequence||visit!==accountVisit)return;
    categories=new Map((result?.categories||[]).map(category=>[category.category,category]));
  }
  function markup(category) {
    if(!economyFlags.market||!category)return '';
    const quote=categories.get(category);if(!quote)return '';
    const label=t(quote.name,quote.nameDe||quote.name),value=quote.changePercent24h;
    const ready=typeof value==='number'&&Number.isFinite(value),rounded=ready?Math.round(value*10)/10:0;
    const state=!ready||rounded===0?'flat':rounded>0?'up':'down',arrow=state==='up'?'↗':state==='down'?'↘':'→';
    const change=ready?`${rounded>0?'+':''}${number(rounded,1)}%`:'—';
    const description=ready?t(`${label} market: ${change} over the last 24 hours.`,`${label}: ${change} in den letzten 24 Stunden.`):t(`${label}: not enough market history for a 24-hour change yet.`,`${label}: noch nicht genug Markthistorie für eine Veränderung über 24 Stunden.`);
    return `<span class="item-market-trend is-${state}" data-market-trend="${accountEscape(category)}" title="${accountEscape(description)}" aria-label="${accountEscape(description)}"><span aria-hidden="true">${ready?arrow:'·'}</span> ${change}<span class="item-market-period" aria-hidden="true">· 24h</span></span>`;
  }
  return {load,markup};
})();
