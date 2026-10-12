window.paletteUi = (() => {
  const esc=accountEscape, symbols={wine:'♧',electronics:'ϟ',cars:'◇',toys:'✦',tools:'⚒',jewellery:'♢'};
  let catalog=null, purchases=[], category='', pending=null, busy=false, error='', stage=null, sequence=0, animations=[];
  const label=offer=>t(offer.name,offer.nameDe), tier=offer=>t(offer.tierName,offer.tierNameDe);
  function art(offer) {
    return `<svg class="stock-palette-art" viewBox="0 0 300 230" fill="none" aria-hidden="true"><ellipse cx="150" cy="204" rx="112" ry="16" fill="currentColor" opacity=".1"/><path d="m35 179 113 26 120-47-113-27Z" fill="#956849"/><path d="M35 179v12l113 28v-14m120-47v13l-120 48" stroke="#583f31" stroke-width="7"/><path d="m53 74 98-38 95 31v105l-98 35-95-29Z" fill="#c69761"/><path d="m53 74 95 32 98-39-95-31Z" fill="#e9bd80"/><path d="M148 106v101l98-35V67Z" fill="#a97948"/><path d="m95 57 97 32v102m-96-42 93-34" stroke="currentColor" stroke-width="15" opacity=".85"/><rect x="66" y="100" width="56" height="49" rx="5" fill="#fff6df"/><text x="94" y="134" fill="#503c2c" font-size="32" text-anchor="middle">${symbols[offer.category]||'✦'}</text><path d="m205 120 24-8v32l-24 8Z" fill="#fff6df"/><text x="158" y="31" fill="currentColor" font-size="19" font-weight="800" text-anchor="middle">${offer.quantity}×</text><path d="m27 55 4-12 4 12 12 4-12 4-4 12-4-12-12-4Zm230 133 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="currentColor"/></svg>`;
  }
  const image=item=>item.image?`<img src="${esc(item.image)}" alt="" loading="lazy">`:`<span class="palette-item-placeholder" aria-hidden="true">${symbols[stage?.offer.category]||'✦'}</span>`;
  function odds(offer) {
    return `<details class="palette-odds"><summary>${t('Contents & exact odds','Inhalte & genaue Chancen')}</summary>${offer.luckPercent?`<p class="skill-luck-notice"><strong>+${offer.luckPercent}% ${t('luck active','Glücksbonus aktiv')}</strong>${t('Your skill is included in the odds below.','Dein Skill ist in den folgenden Chancen berücksichtigt.')}</p>`:''}<p>${t('Three independent item draws. Repeats are possible. The quantities always add up to the advertised total.','Drei unabhängige Artikelauslosungen. Wiederholungen sind möglich. Die Mengen ergeben immer die angezeigte Gesamtzahl.')}</p><dl>${offer.dropChances.map(chance=>`<div><dt>${esc(rarityLabel(chance.rarity))}</dt><dd>${number(chance.percent,2)}%</dd></div>`).join('')}</dl><h4>${t('Quantity per draw','Menge pro Auslosung')}</h4><dl>${offer.multiplierChances.map(chance=>`<div><dt>×${chance.quantity}</dt><dd>${number(chance.percent,2)}%</dd></div>`).join('')}</dl><ul class="palette-split-odds">${offer.quantitySplits.map(split=>`<li>${split.quantities.map(quantity=>'×'+quantity).join(' + ')} <strong>${split.weight}%</strong></li>`).join('')}</ul><p>${t('Split order is shuffled equally.','Die Reihenfolge der Mengen wird gleichmäßig gemischt.')}</p><p>${t('Quantity rolls are linked to keep the total fixed; each item roll is independent of quantity. Within each rarity every item is equally likely.','Die Mengenauslosungen sind verbunden, damit die Gesamtmenge gleich bleibt; jede Artikelauslosung ist unabhängig von der Menge. Innerhalb einer Seltenheitsstufe ist jeder Artikel gleich wahrscheinlich.')}</p><p>${t('Average contents at current market estimates','Durchschnittlicher Inhalt zu aktuellen Marktschätzungen')}: <strong>${justizEuro(Math.round(offer.expectedMarket))}</strong>. ${t('Price includes all quantity odds and a margin. Resale prices and store demand vary.','Der Preis berücksichtigt alle Mengenchancen und eine Marge. Verkaufspreise und Ladennachfrage schwanken.')}</p><ul class="palette-pool">${offer.items.map(item=>`<li class="rarity-${esc(item.rarity)}">${image(item)}<span>${esc(item.title)}<small>${esc(rarityLabel(item.rarity))} · ${justizEuro(item.price)}</small></span></li>`).join('')}</ul></details>`;
  }
  function stop() {sequence++;for(const animation of animations)animation.cancel();animations=[];stage=null;pending=null;busy=false;error='';}
  async function load(visit) {
    catalog=null;purchases=[];category=new URLSearchParams(location.search).get('category')||'';
    if(!economyFlags.palettes)return;
    const owner=account?.id,results=await Promise.all([window.justizEconomy.stockPalettes(),account?accountApi('stock-palettes'):null]);
    if(visit!==accountVisit||owner!==account?.id)return;
    catalog=results[0];purchases=results[1]?.palettes||[];
    if(!catalog)throw new Error(t('Palettes could not be loaded. Try again.','Paletten konnten nicht geladen werden. Versuche es erneut.'));
    if(!catalog.categories.some(entry=>entry.id===category&&entry.available))category=catalog.categories.find(entry=>entry.available)?.id||'';
    const legacy=new URLSearchParams(location.search).get('auction');
    if(legacy&&account&&economyFlags.paletteAuctions){
      const [result,lot]=await Promise.all([window.justizEconomy.paletteAuctionRewards(legacy),window.justizEconomy.paletteAuction(legacy)]);
      if(visit!==accountVisit||owner!==account?.id)return;
      const auction=lot?.auction,rewards=result.reveal.rewards.map(reward=>({...reward,quantity:1,inventoryIds:[reward.inventoryId]}));
      stage={id:legacy,offer:{name:auction?.name||'Legacy palette',nameDe:auction?.nameDe||'Bisherige Palette',quantity:3,
        tier:'standard',tierName:'Original auction contents',tierNameDe:'Ursprüngliche Auktionsinhalte',category:auction?.paletteId,
        multiplierChances:[{quantity:1,percent:100}]},pool:auction?.items?.length?auction.items:rewards.map(reward=>reward.item),rewards,index:0,phase:'item',completed:[]};
    }
    const open=new URLSearchParams(location.search).get('open');
    if(open&&account){const result=await accountApi('stock-palettes/reveal',{id:open});if(visit!==accountVisit||owner!==account?.id)return;updateAccount(result.user);stage={...result.palette,index:0,phase:'item',completed:[]};}
  }
  function card(offer) {
    return `<article class="palette-offer is-${offer.tier}"><div class="palette-offer-top"><span class="palette-tier-tag">${esc(tier(offer))}</span><span>${t('ALWAYS AVAILABLE','IMMER VERFÜGBAR')}</span></div>${art(offer)}<div class="palette-offer-body"><p class="palette-total">${offer.quantity}× <span>${esc(label(offer))}</span></p><p class="palette-offer-description">${t('3 item rolls + quantity multipliers','3 Artikelauslosungen + Mengenmultiplikatoren')}</p><div class="palette-price"><strong>${justizEuro(offer.cost)}</strong><span>${t('per palette','pro Palette')}</span></div>${account?`<button type="button" class="primary-button palette-buy" data-palette-buy="${esc(offer.id)}" ${busy?'disabled':''}>${t('Buy & reveal','Kaufen & aufdecken')} <span aria-hidden="true">→</span></button>`:`<a class="primary-button palette-buy" href="/login" data-page>${t('Log in to buy','Zum Kauf anmelden')} →</a>`}${account&&account.tokens<offer.cost?`<p class="palette-shortfall">${t('You need','Dir fehlen')} ${justizEuro(offer.cost-account.tokens)} ${t('more','')}. <a href="/" data-page>Daily →</a></p>`:''}${odds(offer)}</div></article>`;
  }
  function render() {
    if(stage){if(!busy)renderStage();return;}
    if(!economyFlags.palettes||!catalog){accountContent.innerHTML=pageHeading(t('Palettes unavailable','Paletten nicht verfügbar'));return;}
    accountContent.innerHTML=`<div class="palette-page"><header class="palette-hero"><div><p class="eyebrow">${t('THE STOCK DROP','DER WAREN-DROP')}</p><h1 tabindex="-1">${t('Mystery palettes','Mystery-Paletten')}</h1><p>${t('Pick your category. Pull your finds. Multiply your stock.','Wähle deine Kategorie. Ziehe deine Funde. Vervielfache deinen Bestand.')}</p><div class="palette-hero-steps"><span>01 ${t('Item','Artikel')}</span><i>→</i><span>02 ${t('Multiplier','Multiplikator')}</span><i>→</i><span>03 ${t('Restock','Auffüllen')}</span></div></div><div class="palette-hero-mark" aria-hidden="true">×<strong>24</strong><span>JACKPOT?</span></div></header><div class="palette-toolbar"><p>${account?`${t('YOUR BALANCE','DEIN GUTHABEN')} <strong>${justizEuro(account.tokens)}</strong>`:t('Stock for your collection and stores.','Waren für deine Sammlung und Läden.')}</p><a href="/inventory" data-page>${t('Your inventory','Dein Inventar')} →</a></div>${error?`<p class="account-error" role="alert">${esc(error)}</p>`:''}${purchases.length?`<section class="palette-unopened"><h2>${t('Your sealed palettes','Deine versiegelten Paletten')}</h2>${purchases.map(purchase=>`<button type="button" data-palette-open="${esc(purchase.id)}" ${busy?'disabled':''}><span aria-hidden="true">▣</span><span><strong>${purchase.offer.quantity}× ${esc(label(purchase.offer))}</strong><small>${esc(tier(purchase.offer))} · ${t('Ready to reveal','Bereit zum Aufdecken')}</small></span><b aria-hidden="true">→</b></button>`).join('')}</section>`:''}<nav class="palette-categories" aria-label="${t('Stock category','Warenkategorie')}">${catalog.categories.map(entry=>`<button type="button" data-palette-category="${esc(entry.id)}" aria-pressed="${entry.id===category}" ${busy||!entry.available?'disabled':''}><span aria-hidden="true">${symbols[entry.id]}</span>${esc(label(entry))}${!entry.available?`<small>${t('No archived stock','Keine Archivware')}</small>`:''}</button>`).join('')}</nav><section class="palette-offers" aria-label="${t('Choose a palette','Wähle eine Palette')}">${catalog.offers.filter(offer=>offer.category===category).map(card).join('')}</section><p class="palette-footer-note">${t('No auction wait. Contents are fixed when bought. All units go to your inventory; move them onto store shelves with Quick Restock. Pool rotates daily; prices follow the market.','Keine Auktionswartezeit. Inhalte werden beim Kauf festgelegt. Alle Einheiten landen im Inventar; mit Schnell auffüllen kommen sie in deine Ladenregale. Der Pool wechselt täglich; Preise folgen dem Markt.')}</p></div>`;
  }
  function reel(type,winner) {
    const pool=type==='item'?stage.pool:stage.offer.multiplierChances.map(entry=>entry.quantity);
    const cards=Array.from({length:34},(_,index)=>index===30?winner:pool[index%pool.length]);
    return `<div class="palette-slot-window" data-palette-reel="${type}"><div class="palette-slot-marker" aria-hidden="true"></div><div class="palette-slot-track" aria-hidden="true">${cards.map(value=>`<div class="palette-slot-cell ${type==='item'?'rarity-'+esc(value.rarity):'is-multiplier'}">${type==='item'?`${image(value)}<strong>${esc(value.title)}</strong><small>${esc(rarityLabel(value.rarity))}</small>`:`<strong>×${value}</strong><small>${t('UNITS','EINHEITEN')}</small>`}</div>`).join('')}</div></div>`;
  }
  function renderStage() {
    const done=stage.phase==='done',reward=stage.rewards[stage.index],quantity=reward.quantity;
    accountContent.innerHTML=`<section class="palette-reveal-screen is-${esc(stage.offer.tier)}"><header class="palette-reveal-header"><div><p class="eyebrow">${t('PALETTE UNLOCKED','PALETTE FREIGESCHALTET')}</p><h1 tabindex="-1">${stage.offer.quantity}× ${esc(label(stage.offer))}</h1><span>${esc(tier(stage.offer))} · ${t('Your stock is secured','Deine Waren sind gesichert')}</span></div><button class="secondary-button" type="button" data-palette-finish>${t('To inventory','Zum Inventar')} ↗</button></header>${done?summary():`<ol class="palette-rounds" aria-label="${t('Reveal progress','Aufdeckungsfortschritt')}">${stage.rewards.map((_,index)=>`<li class="${index<stage.index?'is-complete':index===stage.index?'is-current':''}">${index<stage.index?'✓':index+1}<span>${t('DROP','DROP')} ${index+1}</span></li>`).join('')}</ol><div class="palette-slot-machine"><div class="palette-slot-head"><span>${stage.phase==='item'?t('01 · FIND YOUR ITEM','01 · FINDE DEINEN ARTIKEL'):t('02 · MULTIPLY YOUR FIND','02 · VERVIELFACHE DEINEN FUND')}</span><strong>${stage.phase==='item'?'?':esc(reward.item.title)}</strong></div><div class="palette-reel-group"><span class="palette-reel-label">${t('ITEM','ARTIKEL')}</span>${stage.phase==='item'?reel('item',reward.item):`<div class="palette-locked-item rarity-${esc(reward.item.rarity)}">${image(reward.item)}<div><strong>${esc(reward.item.title)}</strong><span>${esc(rarityLabel(reward.item.rarity))}</span></div><i aria-hidden="true">✓</i></div>`}</div><div class="palette-reel-group palette-quantity-group ${stage.phase==='item'?'is-locked':''}"><span class="palette-reel-label">${t('MULTIPLIER','MULTIPLIKATOR')}</span>${stage.phase==='result'?`<div class="palette-multiplier-win"><strong>×${quantity}</strong><span>${t('Added to your inventory','Zum Inventar hinzugefügt')}</span></div>`:stage.phase==='quantity'?reel('quantity',quantity):`<div class="palette-multiplier-locked"><strong>×?</strong><span>${t('Pull an item to unlock','Ziehe einen Artikel zum Freischalten')}</span></div>`}</div><div class="palette-slot-action"><p data-palette-announcement role="status">${stage.phase==='result'?`${quantity}× ${esc(reward.item.title)}`:stage.phase==='quantity'?`${esc(reward.item.title)} · ${esc(rarityLabel(reward.item.rarity))}`:t('Your next drop is waiting.','Dein nächster Drop wartet.')}</p><button class="palette-pull" type="button" data-palette-pull ${busy?'disabled':''}><span aria-hidden="true">${stage.phase==='result'?'→':'↓'}</span>${stage.phase==='item'?t('Pull item','Artikel ziehen'):stage.phase==='quantity'?t('Pull multiplier','Multiplikator ziehen'):stage.index<2?t('Next drop','Nächster Drop'):t('See your haul','Deine Ausbeute ansehen')}</button></div></div><div class="palette-haul"><span>${t('YOUR HAUL','DEINE AUSBEUTE')}</span>${stage.completed.map(entry=>`<span class="rarity-${esc(entry.item.rarity)}"><b>×${entry.quantity}</b> ${esc(entry.item.title)}</span>`).join('')||`<span>${t('Three drops. One full palette.','Drei Drops. Eine volle Palette.')}</span>`}</div>`}</section>`;
    accountContent.querySelector('[data-palette-pull], [data-palette-finish]')?.focus({preventScroll:true});
  }
  function summary() {
    return `<div class="palette-haul-summary"><p class="eyebrow">${t('STOCK JACKPOT','WAREN-JACKPOT')}</p><h2>${t('Your haul is in.','Deine Ausbeute ist da.')}</h2><strong class="palette-summary-total">${stage.offer.quantity}<span>${t('new units','neue Einheiten')}</span></strong><div class="palette-summary-items">${stage.rewards.map(reward=>`<article class="rarity-${esc(reward.item.rarity)}">${image(reward.item)}<span>×${reward.quantity}</span><h3>${esc(reward.item.title)}</h3><small>${esc(rarityLabel(reward.item.rarity))}</small></article>`).join('')}</div><p>${t('Keep, list or fill your shelves. All units are already in your inventory.','Behalten, anbieten oder Regale füllen. Alle Einheiten sind bereits in deinem Inventar.')}</p><div class="palette-summary-actions"><a class="primary-button" href="/inventory" data-page>${t('View inventory','Inventar ansehen')} →</a>${economyFlags.businesses?`<a class="secondary-button" href="/businesses" data-page>${t('Restock stores','Läden auffüllen')}</a>`:''}<button class="secondary-button" type="button" data-palette-shop>${t('More palettes','Weitere Paletten')}</button></div></div>`;
  }
  async function spin(type) {
    const own=sequence,visit=accountVisit,owner=account?.id;
    busy=true;const button=accountContent.querySelector('[data-palette-pull]');button.disabled=true;
    button.lastChild.textContent=t('Rolling…','Wird ausgelost …');
    const root=accountContent.querySelector(`[data-palette-reel="${type}"]`),track=root.querySelector('.palette-slot-track'),cells=track.children;
    const width=cells[0].getBoundingClientRect().width,gap=parseFloat(getComputedStyle(track).gap)||0;
    const end=root.clientWidth/2-(30*(width+gap)+width/2);
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const animation=track.animate([{transform:'translateX(0)'},{transform:`translateX(${end}px)`}],{duration:reduced?150:type==='item'?2900:2400,easing:'cubic-bezier(.12,.72,.18,1)',fill:'forwards'});
    animations.push(animation);
    try{await animation.finished;}catch{return;}
    animations=animations.filter(entry=>entry!==animation);
    if(own!==sequence||visit!==accountVisit||owner!==account?.id)return;
    busy=false;if(type==='item')stage.phase='quantity';else{stage.phase='result';stage.completed.push(stage.rewards[stage.index]);}
    renderStage();
  }
  async function open(id) {
    const visit=accountVisit,owner=account?.id;busy=true;error='';render();
    const query=new URLSearchParams(location.search);query.set('open',id);history.replaceState({},'','/palettes?'+query);
    try{const result=await accountApi('stock-palettes/reveal',{id});if(visit!==accountVisit||owner!==account?.id)return;
      updateAccount(result.user);stage={...result.palette,index:0,phase:'item',completed:[]};purchases=purchases.filter(entry=>entry.id!==id);
      busy=false;renderStage();window.scrollTo({top:0,behavior:'instant'});
    }catch(failure){if(visit===accountVisit&&owner===account?.id){error=failure.message;busy=false;render();}}
  }
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-palette-category], [data-palette-buy], [data-palette-open], [data-palette-pull], [data-palette-finish], [data-palette-shop]');
    if(!button||currentAccountPage!=='/palettes')return;
    if(button.hasAttribute('data-palette-finish')){navigateAccountPage('/inventory');return;}
    if(busy)return;
    if(button.dataset.paletteCategory){category=button.dataset.paletteCategory;pending=null;history.replaceState({},'','/palettes?category='+category);render();accountContent.querySelector(`[data-palette-category="${category}"]`)?.focus({preventScroll:true});return;}
    if(button.hasAttribute('data-palette-shop')){stop();history.replaceState({},'','/palettes?category='+category);render();accountContent.querySelector(`[data-palette-category="${category}"]`)?.focus({preventScroll:true});return;}
    if(button.hasAttribute('data-palette-pull')){if(stage.phase==='result'){if(stage.index===2)stage.phase='done';else{stage.index++;stage.phase='item';}renderStage();}else await spin(stage.phase);return;}
    if(button.dataset.paletteOpen){await open(button.dataset.paletteOpen);return;}
    if(button.dataset.paletteBuy&&account){
      const offerId=button.dataset.paletteBuy,visit=accountVisit,owner=account.id;error='';busy=true;
      if(!pending||pending.offerId!==offerId)pending={offerId,revision:catalog.revision,requestId:crypto.randomUUID()};render();
      try{const result=await accountApi('stock-palettes/buy',pending);if(visit!==accountVisit||owner!==account?.id)return;updateAccount(result.user);pending=null;purchases.unshift(result.palette);busy=false;await open(result.palette.id);}
      catch(failure){if(visit!==accountVisit||owner!==account?.id)return;error=failure.message;busy=false;
        if(failure.code==='catalog_changed'){pending=null;const next=await window.justizEconomy.stockPalettes();if(visit!==accountVisit||owner!==account?.id)return;if(next)catalog=next;}render();}
    }
  });
  return {load,render,stop,art};
})();
