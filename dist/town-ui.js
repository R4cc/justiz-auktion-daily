window.townUi = (() => {
  const esc=accountEscape, typeLabels={wine:['Wine store','Weinhandlung'],toys:['Toy store','Spielwarenladen'],electronics:['Electronics store','Elektronikladen'],cars:['Car dealership','Autohaus']};
  const sizeLabels={popup:['Street pop-up','Straßenstand'],tiny:['Small shop','Kleiner Laden'],medium:['Medium shop','Mittlerer Laden'],large:['Large shop','Großer Laden']};
  const symbols={wine:'V',toys:'T',electronics:'E',cars:'A'}, sizes={popup:'XS',tiny:'S',medium:'M',large:'L'};
  let data=null,timer=null,request=0,selected=null,district=null,storeType='wine',busy=false;
  const typeName=id=>typeLabels[id]?t(...typeLabels[id]):id, sizeName=id=>sizeLabels[id]?t(...sizeLabels[id]):id;
  function stop(){clearInterval(timer);timer=null;request++;data=null;busy=false;}
  async function refresh(visit,repaint=true){
    const current=++request,owner=account?.id,response=await fetch('/api/town',{headers:{accept:'application/json'}}),result=await response.json();
    if(!response.ok)throw Error(accountError(result.error));
    if(visit!==accountVisit||request!==current||owner!==account?.id)return;
    data=result;
    if(!data.plots.some(plot=>plot.id===selected))selected=data.plots.find(plot=>!plot.occupied)?.id||null;
    if(repaint)render();
  }
  async function load(visit){
    await economyReady;
    if(!economyFlags.businesses){data={disabled:true};return;}
    const query=new URLSearchParams(location.search);selected=query.get('plot');district=query.get('district');storeType='wine';
    await refresh(visit,false);if(visit!==accountVisit)return;
    timer=setInterval(()=>{if(!document.hidden&&!busy&&!document.activeElement?.closest('.town-purchase'))refresh(visit).catch(()=>{});},30000);
  }
  function mapArtwork(){
    return `<svg viewBox="0 0 860 730" class="town-map-art" aria-hidden="true"><defs><pattern id="town-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0v25" fill="none" stroke="#183e36" stroke-opacity=".035"/></pattern></defs><rect width="860" height="730" fill="#f4f0e4"/><rect width="860" height="730" fill="url(#town-grid)"/>${data.districts.map(entry=>{
      const [x,y,w,h]=entry.bounds,opacity=!district||entry.id===district?1:.4;
      return `<g opacity="${opacity}"><path d="M${x+18} ${y}H${x+w-22}L${x+w} ${y+22}V${y+h-20}L${x+w-20} ${y+h}H${x+15}L${x} ${y+h-15}V${y+18}Z" fill="${entry.color}" fill-opacity=".16" stroke="${entry.color}" stroke-opacity=".55" stroke-width="1.5"/><path d="M${x+12} ${y+h*.57}H${x+w-12}" stroke="#fffdf7" stroke-width="9"/><path d="M${x+12} ${y+h*.57}H${x+w-12}" stroke="${entry.color}" stroke-opacity=".2" stroke-dasharray="4 5"/><text x="${x+17}" y="${y+29}" fill="${entry.color}" font-family="Manrope,sans-serif" font-size="${w<200?16:19}" font-weight="800">${entry.number}. ${esc(entry.name)}</text></g>`;
    }).join('')}<path d="M575 -20C580 80 560 160 540 240S528 390 600 430 695 540 828 760" stroke="#b7d8d7" stroke-width="14" fill="none"/><path d="M575 -20C580 80 560 160 540 240S528 390 600 430 695 540 828 760" stroke="#87b9bd" stroke-width="2" fill="none" stroke-dasharray="4 6"/><text x="672" y="494" fill="#527d81" font-family="DM Mono,monospace" font-size="10" transform="rotate(35 672 494)">DONAU / DONAUKANAL</text><path d="m817 28-7 18h14Z" fill="#183e36"/><text x="817" y="65" text-anchor="middle" font-family="DM Mono,monospace" font-size="11" fill="#183e36">N</text><text x="18" y="722" font-family="DM Mono,monospace" font-size="9" letter-spacing="2" fill="#66736b">WIEN · GAME EDITION</text></svg>`;
  }
  function mapPin(plot){
    const business=plot.business,position=`left:${plot.x/860*100}%;top:${plot.y/730*100}%`, muted=district&&plot.districtId!==district?' is-muted':'';
    if(business)return `<a class="town-pin is-occupied${business.own?' is-own':''}${selected===plot.id?' is-selected':''}${muted}" style="${position}" href="/stores?shop=${encodeURIComponent(business.id)}" data-page title="${esc(business.name||typeName(business.type))} · ${esc(business.owner)} · ${esc(plot.streetName)}" aria-label="${esc(t('Visit','Besuchen'))}: ${esc(business.name||typeName(business.type))}, ${esc(business.owner)}, ${esc(plot.districtName)}"><b>${symbols[business.type]||'JG'}</b><small>${sizes[plot.size]}</small></a>`;
    if(plot.occupied)return `<span class="town-pin is-unavailable${muted}" style="${position}" title="${t('Plot reserved','Grundstück reserviert')}"><b>×</b><small>${sizes[plot.size]}</small></span>`;
    return `<button class="town-pin is-free${selected===plot.id?' is-selected':''}${muted}" style="${position}" type="button" data-town-plot="${esc(plot.id)}" title="${esc(plot.streetName)} · ${esc(sizeName(plot.size))}" aria-label="${esc(t('Available plot','Freies Grundstück'))}: ${esc(plot.streetName)}, ${esc(sizeName(plot.size))}, ${esc(plot.districtName)}" aria-pressed="${selected===plot.id}"><b>＋</b><small>${sizes[plot.size]}</small></button>`;
  }
  function plotPanel(){
    const plot=data.plots.find(entry=>entry.id===selected),area=data.districts.find(entry=>entry.id===(plot?.districtId||district));
    if(!plot)return `<aside class="town-plot-panel"><p class="eyebrow">${t('ALL LOCATIONS TAKEN','ALLE STANDORTE BELEGT')}</p><h2>${t('The town is full.','Die Stadt ist voll.')}</h2><p>${t('All plots have owners. Visit their stores to see what is on the shelves.','Alle Grundstücke sind belegt. Besuche die Läden und entdecke ihre Waren.')}</p></aside>`;
    if(plot.occupied)return `<aside class="town-plot-panel"><p class="eyebrow">${area.number}. ${esc(area.name)}</p><h2>${esc(plot.streetName)}</h2><span class="town-size-badge">${esc(sizeName(plot.size))} · ${sizes[plot.size]}</span><p class="town-district-story">${esc(t(area.storyEn,area.storyDe))}</p>${plot.business?`<h3>${esc(plot.business.name||typeName(plot.business.type))}</h3><p>${esc(plot.business.owner)} · ${plot.business.stockCount} ${t('items on shelves','Waren im Regal')}</p><a href="/stores?shop=${encodeURIComponent(plot.business.id)}" data-page class="business-edit-button">${t('Visit store','Laden besuchen')} ↗</a>`:`<p>${t('This plot is reserved. Choose an available + plot to open a store.','Dieses Grundstück ist reserviert. Wähle ein freies +-Grundstück zum Eröffnen.')}</p>`}</aside>`;
    const cost=plot.costs[storeType],capacity=storeType==='cars'?plot.carCapacity:plot.capacity,capped=data.myStoreCount>=data.maxStores;
    return `<aside class="town-plot-panel"><p class="eyebrow">${area.number}. ${esc(area.name)}</p><h2>${esc(plot.streetName)}</h2><span class="town-size-badge">${esc(sizeName(plot.size))} · ${sizes[plot.size]}</span><p class="town-district-story">${esc(t(area.storyEn,area.storyDe))}</p><dl class="town-plot-facts"><div><dt>${t('Street','Straße')}</dt><dd>${esc(t(plot.streetNameEn,plot.streetNameDe))}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(plot.trafficMultiplier,2)}×</dd></div><div><dt>${t('Theft odds','Diebstahlchance')}</dt><dd>${number(plot.theftMultiplier,2)}×</dd></div><div><dt>${t('Location price','Standortpreis')}</dt><dd>${number(plot.priceMultiplier,2)}×</dd></div></dl><form class="town-purchase"><fieldset><legend>${t('What will you open?','Was möchtest du eröffnen?')}</legend><div class="town-type-grid">${data.types.map(type=>`<label class="town-type-choice${storeType===type.id?' is-selected':''}"><input type="radio" name="type" value="${type.id}" ${storeType===type.id?'checked':''}><span>${symbols[type.id]}</span>${esc(typeName(type.id))}</label>`).join('')}</div></fieldset><div class="town-buy-summary"><span>${capacity} ${t('shelf spaces','Regalplätze')}</span><strong>${justizEuro(cost)}</strong></div>${!account?`<a href="/login" class="business-edit-button" data-page>${t('Sign in to open here','Anmelden und hier eröffnen')}</a>`:`<button class="business-edit-button" type="submit" ${busy||capped||account.tokens<cost?'disabled':''}>${busy?t('Opening…','Wird eröffnet …'):capped?t('Your 3 locations are filled','Deine 3 Standorte sind belegt'):account.tokens<cost?t('Not enough J€','Nicht genug J€'):t('Open store here','Hier einen Laden eröffnen')}</button>`}<p class="account-error" role="alert"></p></form><small class="town-fixed-note">${t('One plot, one store. Size is fixed; street type changes visitor traffic.','Ein Grundstück, ein Laden. Die Größe ist fest; der Straßentyp beeinflusst die Laufkundschaft.')}</small></aside>`;
  }
  function render(){
    if(currentAccountPage!=='/town'||!data)return;
    if(data.disabled){accountContent.innerHTML=pageHeading(t('Town map is unavailable.','Stadtplan ist nicht verfügbar.'));return;}
    const previousMap=accountContent.querySelector('.town-map-scroll'),scroll=previousMap?.scrollLeft||0;
    // Keep every plot tappable even when an older save needs extra locations.
    let mapWidth=720;
    for(let n=0;n<data.plots.length;n++)for(let m=n+1;m<data.plots.length;m++){const a=data.plots[n],b=data.plots[m];mapWidth=Math.max(mapWidth,860*Math.min(50/Math.abs(a.x-b.x),52/Math.abs(a.y-b.y)));}
    const places=data.plots.filter(plot=>plot.business&&(!district||plot.districtId===district));
    accountContent.innerHTML=`<div class="town-page"><header class="town-heading"><div><p class="eyebrow">${t('WIEN, WITH A LITTLE CHAOS','WIEN, MIT EIN WENIG CHAOS')}</p><h1 tabindex="-1">${t('Town map','Stadtplan')}</h1><p>${data.total} ${t('plots across six districts. Find your corner of the city.','Grundstücke in sechs Bezirken. Finde deine Ecke der Stadt.')}</p></div><a href="/businesses" data-page class="secondary-button">${t('Your businesses','Deine Läden')} ↗</a></header><nav class="town-district-tabs" aria-label="${t('Districts','Bezirke')}"><button type="button" data-town-district="" aria-pressed="${!district}">${t('All of Vienna','Ganz Wien')}</button>${data.districts.map(entry=>`<button type="button" data-town-district="${entry.id}" aria-pressed="${district===entry.id}">${entry.number}. ${esc(entry.name)}</button>`).join('')}</nav><div class="town-layout"><section class="town-map-shell" aria-label="${t('Business plots','Ladengrundstücke')}"><div class="town-map-legend"><span><i class="is-free"></i>${data.available} ${t('available','frei')}</span><span><i class="is-occupied"></i>${data.total-data.available} ${t('occupied','belegt')}</span>${account?`<span><i class="is-own"></i>${t('Your store','Dein Laden')}</span>`:''}</div><div class="town-map-scroll" tabindex="0" aria-label="${t('Map; scroll horizontally on small screens','Karte; auf kleinen Bildschirmen seitlich scrollen')}"><div class="town-canvas" style="min-width:${Math.ceil(mapWidth)}px">${mapArtwork()}${data.plots.map(mapPin).join('')}</div></div><p class="town-map-hint">${t('Click a store to visit. Select a + plot to open a business. Swipe the map sideways on mobile.','Klicke auf einen Laden zum Besuchen. Wähle ein +-Grundstück zum Eröffnen. Auf dem Handy die Karte seitlich wischen.')}</p></section>${plotPanel()}</div><section class="town-business-list"><h2>${t('Around the neighbourhood','In der Nachbarschaft')}</h2><div>${places.length?places.map(plot=>`<a class="town-store-link" href="/stores?shop=${encodeURIComponent(plot.business.id)}" data-page><span class="town-store-symbol">${symbols[plot.business.type]}</span><div><strong>${esc(plot.business.name||typeName(plot.business.type))}</strong><small>${esc(plot.business.owner)} · ${esc(plot.districtName)} · ${esc(plot.streetName)}</small></div><span aria-hidden="true">↗</span></a>`).join(''):`<p class="collection-empty">${t('No stores here yet. Claim the first corner.','Hier gibt es noch keine Läden. Sichere dir die erste Ecke.')}</p>`}</div></section><details class="town-district-guide"><summary>${t('Meet the districts','Lerne die Bezirke kennen')}</summary><div>${data.districts.map(entry=>`<article><h3>${entry.number}. ${esc(entry.name)}</h3><p>${esc(t(entry.tagEn,entry.tagDe))}</p><small>${number(entry.priceMultiplier,2)}× ${t('price','Preis')} · ${number(entry.theftMultiplier,2)}× ${t('theft odds','Diebstahlchance')}</small></article>`).join('')}</div></details><p class="town-game-note">${t('A simplified Vienna-inspired game map. District traits are playful stereotypes, not real-world crime statistics.','Ein vereinfachter, von Wien inspirierter Spielplan. Die Bezirksmerkmale sind spielerische Klischees, keine echten Kriminalitätsstatistiken.')}</p></div>`;
    accountContent.querySelector('.town-map-scroll').scrollLeft=scroll;
    if(!previousMap)centerPlot(selected);
  }
  function centerPlot(id){const plot=data.plots.find(entry=>entry.id===id),map=accountContent.querySelector('.town-map-scroll'),canvas=accountContent.querySelector('.town-canvas');if(plot&&map&&canvas)map.scrollLeft=plot.x/860*canvas.clientWidth-map.clientWidth/2;}
  document.addEventListener('click',event=>{
    if(currentAccountPage!=='/town'||!data||busy)return;
    const plot=event.target.closest('[data-town-plot]'),area=event.target.closest('[data-town-district]');
    if(plot){selected=plot.dataset.townPlot;render();accountContent.querySelector(`[data-town-plot="${CSS.escape(selected)}"]`)?.focus({preventScroll:true});}
    if(area){district=area.dataset.townDistrict||null;if(district){const plots=data.plots.filter(entry=>entry.districtId===district);selected=(plots.find(entry=>!entry.occupied)||plots[0])?.id||null;}render();centerPlot(selected);accountContent.querySelector(`[data-town-district="${CSS.escape(district||'')}"]`)?.focus({preventScroll:true});}
  });
  document.addEventListener('change',event=>{if(currentAccountPage==='/town'&&event.target.matches('.town-purchase [name="type"]')){storeType=event.target.value;render();accountContent.querySelector(`.town-purchase [value="${storeType}"]`)?.focus({preventScroll:true});}});
  document.addEventListener('submit',async event=>{
    if(currentAccountPage!=='/town'||!event.target.matches('.town-purchase'))return;
    event.preventDefault();if(busy||!account)return;
    const plot=data.plots.find(entry=>entry.id===selected);if(!plot||plot.occupied)return;
    const visit=accountVisit,owner=account.id,type=storeType;busy=true;render();
    try{
      const result=await accountApi('businesses/buy',{plotId:plot.id,type});
      if(visit!==accountVisit||account?.id!==owner)return;
      updateAccount(result.user);await navigateAccountPage('/businesses');showToast(t('Your new address is ready.','Dein neuer Standort ist bereit.'));
    }catch(error){if(visit===accountVisit&&account?.id===owner){await refresh(visit,false).catch(()=>{});busy=false;render();accountContent.querySelector('.town-purchase .account-error')?.append(document.createTextNode(error.message));if(!accountContent.querySelector('.town-purchase'))showToast(error.message);}}
    finally{if(visit===accountVisit)busy=false;}
  });
  document.addEventListener('jg:language',()=>{if(currentAccountPage==='/town')render();});
  return {load,stop,render};
})();
