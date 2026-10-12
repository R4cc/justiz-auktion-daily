window.paletteUi = (() => {
  const esc=accountEscape, symbols={wine:'♧',electronics:'ϟ',cars:'◇',toys:'✦',tools:'⚒',jewellery:'♢'};
  let busy=false,stage=null,sequence=0,animations=[];
  const label=offer=>t(offer.name,offer.nameDe), tier=offer=>t(offer.tierName,offer.tierNameDe);
  function art(offer) {
    return `<svg class="stock-palette-art" viewBox="0 0 300 230" fill="none" aria-hidden="true"><ellipse cx="150" cy="204" rx="112" ry="16" fill="currentColor" opacity=".1"/><path d="m35 179 113 26 120-47-113-27Z" fill="#956849"/><path d="M35 179v12l113 28v-14m120-47v13l-120 48" stroke="#583f31" stroke-width="7"/><path d="m53 74 98-38 95 31v105l-98 35-95-29Z" fill="#c69761"/><path d="m53 74 95 32 98-39-95-31Z" fill="#e9bd80"/><path d="M148 106v101l98-35V67Z" fill="#a97948"/><path d="m95 57 97 32v102m-96-42 93-34" stroke="currentColor" stroke-width="15" opacity=".85"/><rect x="66" y="100" width="56" height="49" rx="5" fill="#fff6df"/><text x="94" y="134" fill="#503c2c" font-size="32" text-anchor="middle">${symbols[offer.category]||'✦'}</text><path d="m205 120 24-8v32l-24 8Z" fill="#fff6df"/><text x="158" y="31" fill="currentColor" font-size="19" font-weight="800" text-anchor="middle">${offer.openingMode?'?':offer.quantity+'×'}</text><path d="m27 55 4-12 4 12 12 4-12 4-4 12-4-12-12-4Zm230 133 3-9 3 9 9 3-9 3-3 9-3-9-9-3Z" fill="currentColor"/></svg>`;
  }
  const image=item=>item.image?`<img src="${esc(item.image)}" alt="" loading="lazy">`:`<span class="palette-item-placeholder" aria-hidden="true">${symbols[stage?.offer.category]||'✦'}</span>`;
  function odds(offer,{luckPreview=false}={}) {
    if(offer.openingMode==='opening-v2'){
      const bonus=luckPreview?(account?.skills?.luckPercent||0):(offer.luckPercent||0);
      const adjust=weights=>{if(!luckPreview||!bonus)return weights;const first=weights.findIndex(weight=>weight>0);return weights.map((weight,index)=>weight*(index>first?100+bonus:100));};
      const weights=adjust(offer.weights),total=weights.reduce((a,b)=>a+b,0),quantities=offer.quantityOdds,amountWeights=adjust(quantities.map(choice=>choice.weight)),amountTotal=amountWeights.reduce((a,b)=>a+b,0);
      const rarities=['common','uncommon','rare','epic','legendary'];
      return `<details class="palette-odds"><summary>${t('Rarity & quantity odds','Seltenheits- & Mengenchancen')}</summary><p>${t('Items and amounts are drawn when you open it. Three independent drops; repeats are possible. Nothing is guaranteed beyond one unit per drop.','Artikel und Mengen werden beim Öffnen ausgelost. Drei unabhängige Drops; Wiederholungen sind möglich. Garantiert ist nur eine Einheit pro Drop.')}</p>${bonus?`<p class="skill-luck-notice"><strong>+${bonus}% ${t('luck active','Glücksbonus aktiv')}</strong> · ${t('Your current Luck improves both rolls. The rank you have when opening applies.','Dein aktuelles Glück verbessert beide Auslosungen. Es zählt dein Rang beim Öffnen.')}</p>`:''}<h4>${t('Item rarity per drop','Artikelseltenheit pro Drop')}</h4><dl>${rarities.map((rarity,index)=>`<div><dt>${esc(rarityLabel(rarity))}</dt><dd>${number(weights[index]/total*100,2)}%</dd></div>`).join('')}</dl><h4>${t('Quantity per drop','Menge pro Drop')}</h4><dl>${quantities.map((choice,index)=>`<div><dt>×${choice.quantity}</dt><dd>${number(amountWeights[index]/amountTotal*100,2)}%</dd></div>`).join('')}</dl><p>${t('The starting price sets this chance structure. Higher bids do not improve it. You can get a small haul or luck out on rarity and quantity.','Der Startpreis legt diese Chancen fest. Höhere Gebote verbessern sie nicht. Du kannst eine kleine Ausbeute bekommen oder bei Seltenheit und Menge Glück haben.')}</p></details>`;
    }

    if(luckPreview&&account?.skills?.luckPercent){
      const bonus=account.skills.luckPercent,first=offer.weights.findIndex(weight=>weight>0),weights=offer.weights.map((weight,index)=>weight*(index>first?100+bonus:100)),total=weights.reduce((a,b)=>a+b,0);
      const rarities=['common','uncommon','rare','epic','legendary'];
      const mean=weights.reduce((sum,weight,index)=>{if(!weight)return sum;const pool=offer.items.filter(item=>item.rarity===rarities[index]);return sum+weight/total*pool.reduce((value,item)=>value+(item.referenceValue??item.price),0)/pool.length;},0);
      offer={...offer,luckPercent:bonus,expectedMarket:mean*offer.quantity,dropChances:rarities.map((rarity,index)=>({rarity,percent:weights[index]/total*100}))};
    }
    return `<details class="palette-odds"><summary>${t('Contents & exact odds','Inhalte & genaue Chancen')}</summary>${offer.luckPercent?`<p class="skill-luck-notice"><strong>+${offer.luckPercent}% ${t('luck active','Glücksbonus aktiv')}</strong>${t('Your current skill is shown in the odds below and applies when the auction settles.','Dein aktueller Skill ist in den folgenden Chancen berücksichtigt und wird beim Auktionsabschluss angewendet.')}</p>`:''}<p>${t('Three independent item draws. Repeats are possible. The quantities always add up to the advertised total.','Drei unabhängige Artikelauslosungen. Wiederholungen sind möglich. Die Mengen ergeben immer die angezeigte Gesamtzahl.')}</p><dl>${offer.dropChances.map(chance=>`<div><dt>${esc(rarityLabel(chance.rarity))}</dt><dd>${number(chance.percent,2)}%</dd></div>`).join('')}</dl><h4>${t('Quantity per draw','Menge pro Auslosung')}</h4><dl>${offer.multiplierChances.map(chance=>`<div><dt>×${chance.quantity}</dt><dd>${number(chance.percent,2)}%</dd></div>`).join('')}</dl><ul class="palette-split-odds">${offer.quantitySplits.map(split=>`<li>${split.quantities.map(quantity=>'×'+quantity).join(' + ')} <strong>${split.weight}%</strong></li>`).join('')}</ul><p>${t('Split order is shuffled equally.','Die Reihenfolge der Mengen wird gleichmäßig gemischt.')}</p><p>${t('Quantity rolls are linked to keep the total fixed; each item roll is independent of quantity. Within each rarity every item is equally likely.','Die Mengenauslosungen sind verbunden, damit die Gesamtmenge gleich bleibt; jede Artikelauslosung ist unabhängig von der Menge. Innerhalb einer Seltenheitsstufe ist jeder Artikel gleich wahrscheinlich.')}</p><p>${t('Average contents at the lot’s reference values','Durchschnittlicher Inhalt zu den Referenzwerten des Loses')}: <strong>${justizEuro(Math.round(offer.expectedMarket))}</strong>. ${t('The starting bid includes all quantity odds. The winning bid is your final price. Resale values and store demand vary.','Das Startgebot berücksichtigt alle Mengenchancen. Das Gewinnergebot ist dein endgültiger Preis. Verkaufswerte und Ladennachfrage schwanken.')}</p><ul class="palette-pool">${offer.items.map(item=>`<li class="rarity-${esc(item.rarity)}">${image(item)}<span>${esc(item.title)}<small>${esc(rarityLabel(item.rarity))} · ${justizEuro(item.price)}</small></span></li>`).join('')}</ul></details>`;
  }
  function stop() {sequence++;for(const animation of animations)animation.cancel();animations=[];stage=null;busy=false;}
  async function load(visit) {
    const owner=account?.id,query=new URLSearchParams(location.search),auctionId=query.get('reveal'),purchaseId=query.get('open-palette');
    if(!owner)throw new Error(t('Log in to reveal your winning palette.','Melde dich an, um deine gewonnene Palette aufzudecken.'));
    if(auctionId){
      const [result,lot]=await Promise.all([window.justizEconomy.paletteAuctionRewards(auctionId),window.justizEconomy.paletteAuction(auctionId)]);
      if(visit!==accountVisit||owner!==account?.id)return;
      const auction=lot?.auction,reveal=result.reveal;
      const rewards=reveal.offer?reveal.rewards:reveal.rewards.map(reward=>({...reward,quantity:1,inventoryIds:[reward.inventoryId]}));
      stage={id:auctionId,offer:reveal.offer||{name:auction?.name||'Legacy palette',nameDe:auction?.nameDe||'Bisherige Palette',quantity:3,
        tier:'standard',tierName:'Original auction contents',tierNameDe:'Ursprüngliche Auktionsinhalte',category:auction?.paletteId,multiplierChances:[{quantity:1,percent:100}]},
        pool:reveal.pool||auction?.items||rewards.map(reward=>reward.item),rewards,index:0,phase:'item',completed:[]};
    }else if(purchaseId){
      const result=await accountApi('stock-palettes/reveal',{id:purchaseId});if(visit!==accountVisit||owner!==account?.id)return;
      updateAccount(result.user);stage={...result.palette,index:0,phase:'item',completed:[]};
    }
    const session=await accountApi('me');if(visit!==accountVisit||owner!==account?.id)return;updateAccount(session.user);
  }
  function render(){if(stage&&!busy)renderStage();}
  function reel(type,winner) {
    const pool=type==='item'?stage.pool:stage.offer.multiplierChances.map(entry=>entry.quantity);
    const cards=Array.from({length:34},(_,index)=>index===30?winner:pool[index%pool.length]);
    return `<div class="palette-slot-window" data-palette-reel="${type}"><div class="palette-slot-marker" aria-hidden="true"></div><div class="palette-slot-track" aria-hidden="true">${cards.map(value=>`<div class="palette-slot-cell ${type==='item'?'rarity-'+esc(value.rarity):'is-multiplier'}">${type==='item'?`${image(value)}<strong>${esc(value.title)}</strong><small>${esc(rarityLabel(value.rarity))}</small>`:`<strong>×${value}</strong><small>${t('UNITS','EINHEITEN')}</small>`}</div>`).join('')}</div></div>`;
  }
  function renderStage() {
    const done=stage.phase==='done',reward=stage.rewards[stage.index],quantity=reward.quantity;
    accountContent.innerHTML=`<section class="palette-reveal-screen is-${esc(stage.offer.tier)}"><header class="palette-reveal-header"><div><p class="eyebrow">${t('PALETTE UNLOCKED','PALETTE FREIGESCHALTET')}</p><h1 tabindex="-1">${stage.offer.openingMode&&!done?esc(label(stage.offer))+' · ?':stage.offer.quantity+'× '+esc(label(stage.offer))}</h1><span>${esc(tier(stage.offer))} · ${t('Your stock is secured','Deine Waren sind gesichert')}</span></div><button class="secondary-button" type="button" data-palette-finish>${t('To inventory','Zum Inventar')} ↗</button></header>${done?summary():`<ol class="palette-rounds" aria-label="${t('Reveal progress','Aufdeckungsfortschritt')}">${stage.rewards.map((_,index)=>`<li class="${index<stage.index?'is-complete':index===stage.index?'is-current':''}">${index<stage.index?'✓':index+1}<span>${t('DROP','DROP')} ${index+1}</span></li>`).join('')}</ol><div class="palette-slot-machine"><div class="palette-slot-head"><span>${stage.phase==='item'?t('01 · FIND YOUR ITEM','01 · FINDE DEINEN ARTIKEL'):t('02 · MULTIPLY YOUR FIND','02 · VERVIELFACHE DEINEN FUND')}</span><strong>${stage.phase==='item'?'?':esc(reward.item.title)}</strong></div><div class="palette-reel-group"><span class="palette-reel-label">${t('ITEM','ARTIKEL')}</span>${stage.phase==='item'?reel('item',reward.item):`<div class="palette-locked-item rarity-${esc(reward.item.rarity)}">${image(reward.item)}<div><strong>${esc(reward.item.title)}</strong><span>${esc(rarityLabel(reward.item.rarity))}</span></div><i aria-hidden="true">✓</i></div>`}</div><div class="palette-reel-group palette-quantity-group ${stage.phase==='item'?'is-locked':''}"><span class="palette-reel-label">${t('MULTIPLIER','MULTIPLIKATOR')}</span>${stage.phase==='result'?`<div class="palette-multiplier-win"><strong>×${quantity}</strong><span>${t('Added to your inventory','Zum Inventar hinzugefügt')}</span></div>`:stage.phase==='quantity'?reel('quantity',quantity):`<div class="palette-multiplier-locked"><strong>×?</strong><span>${t('Pull an item to unlock','Ziehe einen Artikel zum Freischalten')}</span></div>`}</div><div class="palette-slot-action"><p data-palette-announcement role="status">${stage.phase==='result'?`${quantity}× ${esc(reward.item.title)}`:stage.phase==='quantity'?`${esc(reward.item.title)} · ${esc(rarityLabel(reward.item.rarity))}`:t('Your next drop is waiting.','Dein nächster Drop wartet.')}</p><button class="palette-pull" type="button" data-palette-pull ${busy?'disabled':''}><span aria-hidden="true">${stage.phase==='result'?'→':'↓'}</span>${stage.phase==='item'?t('Pull item','Artikel ziehen'):stage.phase==='quantity'?t('Pull multiplier','Multiplikator ziehen'):stage.index<2?t('Next drop','Nächster Drop'):t('See your haul','Deine Ausbeute ansehen')}</button></div></div><div class="palette-haul"><span>${t('YOUR HAUL','DEINE AUSBEUTE')}</span>${stage.completed.map(entry=>`<span class="rarity-${esc(entry.item.rarity)}"><b>×${entry.quantity}</b> ${esc(entry.item.title)}</span>`).join('')||`<span>${t('Three drops. One full palette.','Drei Drops. Eine volle Palette.')}</span>`}</div>`}</section>`;
    accountContent.querySelector('[data-palette-pull], [data-palette-finish]')?.focus({preventScroll:true});
  }
  function summary() {
    return `<div class="palette-haul-summary"><p class="eyebrow">${t('STOCK JACKPOT','WAREN-JACKPOT')}</p><h2>${t('Your haul is in.','Deine Ausbeute ist da.')}</h2><strong class="palette-summary-total">${stage.offer.quantity}<span>${t('new units','neue Einheiten')}</span></strong><div class="palette-summary-items">${stage.rewards.map(reward=>`<article class="rarity-${esc(reward.item.rarity)}">${image(reward.item)}<span>×${reward.quantity}</span><h3>${esc(reward.item.title)}</h3><small>${esc(rarityLabel(reward.item.rarity))}</small></article>`).join('')}</div><p>${t('Keep, list or fill your shelves. All units are already in your inventory.','Behalten, anbieten oder Regale füllen. Alle Einheiten sind bereits in deinem Inventar.')}</p><div class="palette-summary-actions"><a class="primary-button" href="/inventory" data-page>${t('View inventory','Inventar ansehen')} →</a>${economyFlags.businesses?`<a class="secondary-button" href="/businesses" data-page>${t('Restock stores','Läden auffüllen')}</a>`:''}<button class="secondary-button" type="button" data-palette-shop>${t('Back to Auction House','Zurück zum Auktionshaus')}</button></div></div>`;
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
  document.addEventListener('click',async event=>{
    const button=event.target.closest('[data-palette-pull], [data-palette-finish], [data-palette-shop]');
    if(!button||currentAccountPage!=='/auction-house'||!stage)return;
    if(button.hasAttribute('data-palette-finish')){navigateAccountPage('/inventory');return;}
    if(button.hasAttribute('data-palette-shop')){navigateAccountPage('/auction-house?type=mystery');return;}
    if(busy)return;
    if(stage.phase==='result'){if(stage.index===2)stage.phase='done';else{stage.index++;stage.phase='item';}renderStage();}
    else await spin(stage.phase);
  });
  return {load,render,stop,art,odds,active:()=>Boolean(stage)};
})();
