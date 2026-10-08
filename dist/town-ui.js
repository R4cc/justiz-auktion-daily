window.townUi = (() => {
  const esc=accountEscape, typeLabels={wine:['Wine store','Weinhandlung'],toys:['Toy store','Spielwarenladen'],electronics:['Electronics store','Elektronikladen'],cars:['Car dealership','Autohaus']};
  const sizeLabels={popup:['Street pop-up','Straßenstand'],tiny:['Small shop','Kleiner Laden'],medium:['Medium shop','Mittlerer Laden'],large:['Large shop','Großer Laden']};
  const artwork=window.townArtwork, sizes={popup:'XS',tiny:'S',medium:'M',large:'L'};
  let data=null,timer=null,request=0,selected=null,district=null,storeType='wine',busy=false;
  const typeName=id=>typeLabels[id]?t(...typeLabels[id]):id, sizeName=id=>sizeLabels[id]?t(...sizeLabels[id]):id;
  function stop(){clearInterval(timer);timer=null;request++;data=null;busy=false;}
  async function refresh(visit,repaint=true){
    const current=++request,owner=account?.id,response=await fetch('/api/town',{headers:{accept:'application/json'}}),result=await response.json();
    if(!response.ok)throw Error(accountError(result.error));
    if(visit!==accountVisit||request!==current||owner!==account?.id)return;
    data=result;
    if(district&&!data.districts.some(area=>area.id===district))district=null;
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
  function mapArtwork(){return artwork.render(data,district,esc);}
  function mapPin(plot){
    const business=plot.business,point=artwork.position(plot,data.districts),position=`left:${point.x/860*100}%;top:${point.y/730*100}%`,muted=district&&plot.districtId!==district?' is-muted':'';
    const type=business?.type||'plus',state=business?'is-occupied':plot.occupied?'is-unavailable':'is-free';
    const body=`<span class="town-pin-building">${artwork.storefront()}<span class="town-shop-icon">${artwork.icon(plot.occupied&&!business?'lock':type)}</span></span>`;
    if(business)return `<a class="town-pin ${state} town-sells-${esc(business.type)}${business.own?' is-own':''}${selected===plot.id?' is-selected':''}${muted}" style="${position}" href="/stores?shop=${encodeURIComponent(business.id)}" data-page title="${esc(business.name||typeName(business.type))} · ${esc(typeName(business.type))} · @${esc(business.owner)} · ${esc(plot.streetName)}" aria-label="${esc(t('Visit','Besuchen'))}: ${esc(business.name||typeName(business.type))}, ${esc(typeName(business.type))}, ${esc(t('Owner','Besitzer'))}: ${esc(business.owner)}, ${esc(plot.districtName)}">${body}<span class="town-pin-info"><strong>${esc(business.name||typeName(business.type))}</strong><span class="town-pin-owner">${business.own?`${t('you','du')} · `:''}@${esc(business.owner)}</span></span></a>`;
    if(plot.occupied)return `<span class="town-pin ${state}${muted}" style="${position}" title="${t('Plot reserved','Grundstück reserviert')}">${body}<span class="town-pin-info"><strong>${t('Reserved','Reserviert')}</strong><small>${sizes[plot.size]}</small></span></span>`;
    return `<button class="town-pin ${state}${selected===plot.id?' is-selected':''}${muted}" style="${position}" type="button" data-town-plot="${esc(plot.id)}" title="${esc(plot.streetName)} · ${esc(sizeName(plot.size))}" aria-label="${esc(t('Available shop','Freier Laden'))}: ${esc(plot.streetName)}, ${esc(sizeName(plot.size))}, ${esc(plot.districtName)}" aria-pressed="${selected===plot.id}">${body}<span class="town-pin-info"><strong>${t('Open a shop','Laden eröffnen')}</strong><small>${sizes[plot.size]} · ${justizEuro(plot.costs[storeType])}</small></span></button>`;
  }
  function plotPanel(){
    const plot=data.plots.find(entry=>entry.id===selected),area=data.districts.find(entry=>entry.id===(plot?.districtId||district));
    if(!plot)return `<aside class="town-plot-panel"><p class="eyebrow">${t('ALL LOCATIONS TAKEN','ALLE STANDORTE BELEGT')}</p><h2>${t('The town is full.','Die Stadt ist voll.')}</h2><p>${t('All plots have owners. Visit their stores to see what is on the shelves.','Alle Grundstücke sind belegt. Besuche die Läden und entdecke ihre Waren.')}</p></aside>`;
    if(plot.occupied)return `<aside class="town-plot-panel"><p class="eyebrow">${area.number}. ${esc(area.name)}</p><h2>${esc(plot.streetName)}</h2><span class="town-size-badge">${esc(sizeName(plot.size))} · ${sizes[plot.size]}</span><p class="town-district-story">${esc(t(area.storyEn,area.storyDe))}</p>${plot.business?`<div class="town-panel-category town-sells-${esc(plot.business.type)}">${artwork.icon(plot.business.type)}${esc(typeName(plot.business.type))}</div><h3>${esc(plot.business.name||typeName(plot.business.type))}</h3><p>${t('Owner','Besitzer')}: ${esc(plot.business.owner)} · ${plot.business.stockCount} ${t('items on shelves','Waren im Regal')}</p><a href="/stores?shop=${encodeURIComponent(plot.business.id)}" data-page class="business-edit-button">${t('Visit store','Laden besuchen')} ↗</a>`:`<p>${t('This plot is reserved. Choose an available + plot to open a store.','Dieses Grundstück ist reserviert. Wähle ein freies +-Grundstück zum Eröffnen.')}</p>`}</aside>`;
    const cost=plot.costs[storeType],capacity=storeType==='cars'?plot.carCapacity:plot.capacity,capped=data.myStoreCount>=data.maxStores;
    return `<aside class="town-plot-panel"><p class="eyebrow">${area.number}. ${esc(area.name)}</p><h2>${esc(plot.streetName)}</h2><span class="town-size-badge">${esc(sizeName(plot.size))} · ${sizes[plot.size]}</span><p class="town-district-story">${esc(t(area.storyEn,area.storyDe))}</p><dl class="town-plot-facts"><div><dt>${t('Street','Straße')}</dt><dd>${esc(t(plot.streetNameEn,plot.streetNameDe))}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(plot.trafficMultiplier,2)}×</dd></div><div><dt>${t('Theft odds','Diebstahlchance')}</dt><dd>${number(plot.theftMultiplier,2)}×</dd></div><div><dt>${t('Location price','Standortpreis')}</dt><dd>${number(plot.priceMultiplier,2)}×</dd></div></dl><form class="town-purchase"><fieldset><legend>${t('What will you open?','Was möchtest du eröffnen?')}</legend><div class="town-type-grid">${data.types.map(type=>`<label class="town-type-choice${storeType===type.id?' is-selected':''}"><input type="radio" name="type" value="${type.id}" ${storeType===type.id?'checked':''}><span>${artwork.icon(type.id)}</span>${esc(typeName(type.id))}</label>`).join('')}</div></fieldset><div class="town-buy-summary"><span>${capacity} ${t('shelf spaces','Regalplätze')}</span><strong>${justizEuro(cost)}</strong></div>${!account?`<a href="/login" class="business-edit-button" data-page>${t('Sign in to open here','Anmelden und hier eröffnen')}</a>`:`<button class="business-edit-button" type="submit" ${busy||capped||account.tokens<cost?'disabled':''}>${busy?t('Opening…','Wird eröffnet …'):capped?t('Your 3 locations are filled','Deine 3 Standorte sind belegt'):account.tokens<cost?t('Not enough J€','Nicht genug J€'):t('Open store here','Hier einen Laden eröffnen')}</button>`}<p class="account-error" role="alert"></p></form><small class="town-fixed-note">${t('One plot, one store. Size is fixed; street type changes visitor traffic.','Ein Grundstück, ein Laden. Die Größe ist fest; der Straßentyp beeinflusst die Laufkundschaft.')}</small></aside>`;
  }
  function render(){
    if(currentAccountPage!=='/town'||!data)return;
    if(data.disabled){accountContent.innerHTML=pageHeading(t('Town map is unavailable.','Stadtplan ist nicht verfügbar.'));return;}
    const previousMap=accountContent.querySelector('.town-map-scroll'),scroll=previousMap?.scrollLeft||0;
    // Keep every plot tappable even when an older save needs extra locations.
    let mapWidth=1040;
    for(let n=0;n<data.plots.length;n++)for(let m=n+1;m<data.plots.length;m++){const a=artwork.position(data.plots[n],data.districts),b=artwork.position(data.plots[m],data.districts);mapWidth=Math.max(mapWidth,860*Math.min(90/Math.abs(a.x-b.x),80/Math.abs(a.y-b.y)));}
    const places=data.plots.filter(plot=>plot.business&&(!district||plot.districtId===district));
    accountContent.innerHTML=`<div class="town-page"><header class="town-heading"><div><p class="eyebrow">${t('WIEN, WITH A LITTLE CHAOS','WIEN, MIT EIN WENIG CHAOS')}</p><h1 tabindex="-1">${t('Town map','Stadtplan')}</h1><p>${data.total} ${t('plots across six districts. Find your corner of the city.','Grundstücke in sechs Bezirken. Finde deine Ecke der Stadt.')}</p></div><a href="/businesses" data-page class="secondary-button">${t('Your businesses','Deine Läden')} ↗</a></header><nav class="town-district-tabs" aria-label="${t('Districts','Bezirke')}"><button type="button" data-town-district="" aria-pressed="${!district}">${t('All of Vienna','Ganz Wien')}</button>${data.districts.map(entry=>`<button type="button" data-town-district="${entry.id}" aria-pressed="${district===entry.id}">${entry.number}. ${esc(entry.name)}</button>`).join('')}</nav><div class="town-layout"><section class="town-map-shell" aria-label="${t('Business plots','Ladengrundstücke')}"><div class="town-map-legend"><span><i class="is-free"></i>${data.available} ${t('available','frei')}</span><span><i class="is-occupied"></i>${data.total-data.available} ${t('occupied','belegt')}</span>${account?`<span><i class="is-own"></i>${t('Your store','Dein Laden')}</span>`:''}</div><div class="town-map-key"><span>${artwork.icon('wine')}${typeName('wine')}</span><span>${artwork.icon('toys')}${typeName('toys')}</span><span>${artwork.icon('electronics')}${typeName('electronics')}</span><span>${artwork.icon('cars')}${typeName('cars')}</span><span class="town-deco-key">▧ ${t('Homes & landmarks','Häuser & Sehenswürdigkeiten')}</span></div><div class="town-map-scroll" tabindex="0" aria-label="${t('Map; scroll horizontally on small screens','Karte; auf kleinen Bildschirmen seitlich scrollen')}"><div class="town-canvas" style="min-width:${Math.ceil(mapWidth)}px">${mapArtwork()}${data.plots.map(mapPin).join('')}</div></div><p class="town-map-hint">${t('Click a store to visit. Select a + plot to open a business. Swipe the map sideways on mobile.','Klicke auf einen Laden zum Besuchen. Wähle ein +-Grundstück zum Eröffnen. Auf dem Handy die Karte seitlich wischen.')}</p></section>${plotPanel()}</div><section class="town-business-list"><h2>${t('Around the neighbourhood','In der Nachbarschaft')}</h2><div>${places.length?places.map(plot=>`<a class="town-store-link" href="/stores?shop=${encodeURIComponent(plot.business.id)}" data-page><span class="town-store-symbol">${artwork.icon(plot.business.type)}</span><div><strong>${esc(plot.business.name||typeName(plot.business.type))}</strong><small>${esc(plot.business.owner)} · ${esc(plot.districtName)} · ${esc(plot.streetName)}</small></div><span aria-hidden="true">↗</span></a>`).join(''):`<p class="collection-empty">${t('No stores here yet. Claim the first corner.','Hier gibt es noch keine Läden. Sichere dir die erste Ecke.')}</p>`}</div></section><details class="town-district-guide"><summary>${t('Meet the districts','Lerne die Bezirke kennen')}</summary><div>${data.districts.map(entry=>`<article><h3>${entry.number}. ${esc(entry.name)}</h3><p>${esc(t(entry.tagEn,entry.tagDe))}</p><small>${number(entry.priceMultiplier,2)}× ${t('price','Preis')} · ${number(entry.theftMultiplier,2)}× ${t('theft odds','Diebstahlchance')}</small></article>`).join('')}</div></details><p class="town-game-note">${t('A simplified Vienna-inspired game map. District traits are playful stereotypes, not real-world crime statistics.','Ein vereinfachter, von Wien inspirierter Spielplan. Die Bezirksmerkmale sind spielerische Klischees, keine echten Kriminalitätsstatistiken.')}</p></div>`;
    accountContent.querySelector('.town-map-scroll').scrollLeft=scroll;
    if(!previousMap)centerPlot(selected);
  }
  function centerPlot(id){const plot=data.plots.find(entry=>entry.id===id),map=accountContent.querySelector('.town-map-scroll'),canvas=accountContent.querySelector('.town-canvas');if(plot&&map&&canvas)map.scrollLeft=artwork.position(plot,data.districts).x/860*canvas.clientWidth-map.clientWidth/2;}
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
