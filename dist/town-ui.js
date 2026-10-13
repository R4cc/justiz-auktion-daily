window.townUi = (() => {
  const esc=accountEscape,art=window.townArtwork;
  const types={wine:['Wine store','Weinhandlung'],toys:['Toy store','Spielwarenladen'],electronics:['Electronics store','Elektronikladen'],cars:['Car dealership','Autohaus']};
  const sizes={popup:['Street pop-up','Straßenstand'],tiny:['Small shop','Kleiner Laden'],medium:['Medium shop','Mittlerer Laden'],large:['Large shop','Großer Laden']};
  const typeName=id=>types[id]?t(...types[id]):id,sizeName=id=>sizes[id]?t(...sizes[id]):id;
  let data=null,timer=null,request=0,district=null,selected=null,view='shops',storeType='wine',busy=false,openOnLoad=false,returnFocus=null;
  const dialog=document.createElement('dialog');dialog.className='town-purchase-dialog';dialog.setAttribute('aria-labelledby','town-purchase-title');document.body.append(dialog);
  const mapLayouts=new WeakMap();
  const mapObserver=new ResizeObserver(entries=>{for(const {target} of entries)if(target.isConnected&&currentAccountPage==='/town'&&data)fitMap(target);});
  function stop(){mapObserver.disconnect();clearInterval(timer);timer=null;request++;data=null;busy=false;openOnLoad=false;dialog.close();returnFocus=null;}
  async function refresh(visit,repaint=true){
    const current=++request,owner=account?.id,response=await fetch('/api/town',{headers:{accept:'application/json'}}),result=await response.json();
    if(!response.ok)throw Error(accountError(result.error));
    if(visit!==accountVisit||current!==request||owner!==account?.id)return;
    data=result;if(district&&!data.districts.some(area=>area.id===district))district=null;
    if(selected&&!data.plots.some(plot=>plot.id===selected))selected=null;
    if(repaint)render();
  }
  async function load(visit){
    await economyReady;if(!economyFlags.businesses){data={disabled:true};return;}
    const query=new URLSearchParams(location.search);district=query.get('district');selected=query.get('plot');view='shops';storeType='wine';
    await refresh(visit,false);if(visit!==accountVisit)return;
    const plot=data.plots.find(plot=>plot.id===selected);
    if(plot){district=plot.districtId;if(!plot.occupied){view='open';openOnLoad=true;}}
    timer=setInterval(()=>{if(!document.hidden&&!busy&&!dialog.open&&!document.activeElement?.closest('.town-toolbar,.town-neighbours,.town-map-scroll'))refresh(visit).catch(()=>{});},30000);
  }
  function bounds(){const area=data.districts.find(area=>area.id===district);return area?[area.bounds[0]-22,area.bounds[1]-22,area.bounds[2]+44,area.bounds[3]+44]:[0,0,860,730];}
  function visiblePlots(){return data.plots.filter(plot=>(!district||plot.districtId===district)&&(view==='open'||plot.business&&(view!=='mine'||plot.business.own)));}
  function point(plot){const [x,y,w,h]=bounds(),p=art.position(plot,data.districts);return {x:(p.x-x)/w*100,y:(p.y-y)/h*100};}
  function fitMap(map){
    const canvas=map.querySelector('.town-canvas'),world=map.querySelector('.town-map-world');if(!canvas||!world||!map.clientWidth||!map.clientHeight)return;
    const previous=mapLayouts.get(map),viewportWidth=map.clientWidth,viewportHeight=map.clientHeight;
    if(previous?.viewportWidth===viewportWidth&&previous?.viewportHeight===viewportHeight)return;
    const center=previous?{x:(map.scrollLeft+previous.viewportWidth/2-previous.left)/previous.width,y:(map.scrollTop+previous.viewportHeight/2-previous.top)/previous.height}:null;
    const [,,width,height]=bounds(),plots=visiblePlots();
    let scale=Math.min(Math.max(180,viewportWidth-120)/width,Math.max(240,viewportHeight-120)/height);
    // One uniform projection keeps the SVG scenery and HTML shop markers in
    // the same coordinates at any aspect ratio. Expand crowded maps to retain
    // readable, unscaled owner labels and room to pan.
    for(let n=0;n<plots.length;n++)for(let m=n+1;m<plots.length;m++){
      const a=point(plots[n]),b=point(plots[m]),dx=Math.abs(a.x-b.x)/100*width,dy=Math.abs(a.y-b.y)/100*height;
      const labelWidth=((plots[n].business?146:56)+(plots[m].business?146:56))/2,labelHeight=((plots[n].business?128:56)+(plots[m].business?128:56))/2;
      const required=Math.min(dx?labelWidth/dx:Infinity,dy?labelHeight/dy:Infinity);
      if(Number.isFinite(required))scale=Math.max(scale,required);
    }
    const worldWidth=width*scale,worldHeight=height*scale,canvasWidth=Math.max(viewportWidth,Math.ceil(worldWidth+120)),canvasHeight=Math.max(viewportHeight,Math.ceil(worldHeight+120));
    const left=(canvasWidth-worldWidth)/2,top=(canvasHeight-worldHeight)/2;
    canvas.style.width=canvasWidth+'px';canvas.style.height=canvasHeight+'px';
    world.style.width=worldWidth+'px';world.style.height=worldHeight+'px';world.style.left=left+'px';world.style.top=top+'px';
    mapLayouts.set(map,{viewportWidth,viewportHeight,width:worldWidth,height:worldHeight,left,top});
    if(center){map.scrollLeft=left+center.x*worldWidth-viewportWidth/2;map.scrollTop=top+center.y*worldHeight-viewportHeight/2;}
  }
  function ownerLine(business){return `<span class="town-owner-line"><span class="town-owner-avatar" aria-hidden="true">${esc([...business.owner][0]?.toLocaleUpperCase(uiLocale())||'?')}</span><strong>@${esc(business.owner)}</strong>${business.own?`<span class="town-own-tag">${t('Your store','Dein Laden')}</span>`:''}</span>`;}
  function mapPin(plot){
    const business=plot.business,p=point(plot),style=`left:${p.x}%;top:${p.y}%`;
    if(business)return `<a class="town-pin is-shop town-sells-${esc(business.type)}${business.own?' is-own':''}${view==='open'?' is-neighbour':''}${selected===plot.id?' is-selected':''}" style="${style}" href="/stores?shop=${encodeURIComponent(business.id)}" data-page data-town-store="${esc(plot.id)}" title="${esc(business.name||typeName(business.type))} · @${esc(business.owner)}" aria-label="${esc(t('Visit','Besuchen'))}: ${esc(business.name||typeName(business.type))}, ${esc(typeName(business.type))}, ${esc(t('Owner','Besitzer'))}: ${esc(business.owner)}"><span class="town-pin-building">${art.storefront()}<span class="town-shop-icon">${art.icon(business.type)}</span>${business.own?`<span class="town-pin-own" aria-hidden="true">${t('YOURS','DEINS')}</span>`:''}</span><span class="town-pin-info"><strong>${esc(business.name||typeName(business.type))}</strong><span class="town-pin-owner">@${esc(business.owner)}</span></span></a>`;
    if(plot.occupied)return `<span class="town-pin is-reserved" style="${style}" title="${t('Reserved plot','Reserviertes Grundstück')}">${art.icon('lock')}</span>`;
    const locked=account&&(data.playerLevel??1)<plot.requiredLevel;
    return `<button type="button" class="town-pin is-free${selected===plot.id?' is-selected':''}" style="${style}" data-town-plot="${esc(plot.id)}" aria-label="${esc(t('Open a store','Laden eröffnen'))}: ${esc(plot.streetName)}, ${esc(sizeName(plot.size))}, ${esc(plot.districtName)}${locked?', '+t('Requires level','Benötigt Level')+' '+plot.requiredLevel:''}" title="${esc(plot.streetName)} · ${esc(sizeName(plot.size))}">${art.icon(locked?'lock':'plus')}</button>`;
  }
  function storeList(places){
    if(view==='open')return `<header><h2>${t('Choose a location','Standort wählen')}</h2><span>${places.filter(plot=>!plot.occupied).length}</span></header><div class="town-place-list">${places.filter(plot=>!plot.occupied).map(plot=>`<button type="button" class="town-location-row" data-town-plot="${esc(plot.id)}"><span class="town-location-icon">${art.icon('plus')}</span><span><strong>${esc(plot.streetName)}</strong><small>${esc(sizeName(plot.size))} · ${esc(plot.districtName)}</small></span><span aria-hidden="true">→</span></button>`).join('')||`<p class="town-empty">${t('No open plots here. Try another district.','Hier gibt es keine freien Grundstücke. Wähle einen anderen Bezirk.')}</p>`}</div>`;
    return `<header><h2>${view==='mine'?t('Your stores','Deine Läden'):t('Meet the neighbours','Lerne die Nachbarn kennen')}</h2><span>${places.length}</span></header><div class="town-place-list">${places.map(plot=>{const business=plot.business;return `<a class="town-store-row town-sells-${esc(business.type)}${business.own?' is-own':''}${selected===plot.id?' is-selected':''}" href="/stores?shop=${encodeURIComponent(business.id)}" data-page><span class="town-store-symbol">${art.icon(business.type)}</span><span class="town-store-copy"><small>${esc(typeName(business.type))}</small><strong class="town-store-name">${esc(business.name||typeName(business.type))}</strong>${ownerLine(business)}${window.storeReputationUi?.meter(business)||''}</span><span aria-hidden="true">↗</span></a>`;}).join('')||`<div class="town-empty"><p>${view==='mine'?t('Your first address is waiting.','Dein erster Standort wartet.'):t('No shops here yet.','Hier gibt es noch keine Läden.')}</p><button type="button" class="secondary-button" data-town-view="open">${t('Open a store','Laden eröffnen')} →</button></div>`}</div>`;
  }
  function render(){
    if(currentAccountPage!=='/town'||!data)return;
    if(data.disabled){accountContent.innerHTML=pageHeading(t('Town map is unavailable.','Stadtplan ist nicht verfügbar.'));return;}
    const oldMap=accountContent.querySelector('.town-map-scroll'),scroll=oldMap?{x:oldMap.scrollLeft,y:oldMap.scrollTop}:null;
    const places=visiblePlots();
    const title=district?data.districts.find(area=>area.id===district).name:t('Vienna','Wien');
    accountContent.innerHTML=`<div class="town-page"><header class="town-heading"><div><p class="eyebrow">${t('YOUR NEIGHBOURHOOD','DEINE NACHBARSCHAFT')}</p><h1 tabindex="-1">${t('Town map','Stadtplan')}</h1></div><a class="town-manage-link" href="/businesses" data-page>${t('Manage your stores','Deine Läden verwalten')} ↗</a></header><div class="town-toolbar"><div class="town-view-switch" role="group" aria-label="${t('Map view','Kartenansicht')}">${[['shops',t('Shops','Läden')],...(account?[['mine',t('Yours','Deine')]]:[]),['open',t('Open a store','Laden eröffnen')]].map(([id,label])=>`<button type="button" data-town-view="${id}" aria-pressed="${view===id}">${label}</button>`).join('')}</div><label class="town-district-filter"><span>${t('District','Bezirk')}</span><select data-town-district><option value="">${t('All of Vienna','Ganz Wien')}</option>${data.districts.map(area=>`<option value="${esc(area.id)}" ${district===area.id?'selected':''}>${area.number}. ${esc(area.name)}</option>`).join('')}</select></label></div><div class="town-layout"><section class="town-map-shell" aria-label="${t('Town map','Stadtplan')}"><header class="town-map-heading"><strong>${esc(title)}</strong><span>${view==='open'?t('Pick a + to choose a location','Wähle ein + für deinen Standort'):t('Pick a shop to visit','Wähle einen Laden zum Besuchen')}</span></header><div class="town-map-scroll" tabindex="0" aria-label="${t('Map; scroll to explore','Karte; zum Erkunden scrollen')}"><div class="town-canvas"><div class="town-map-world">${art.render(data,district,esc,false,bounds())}${places.map(mapPin).join('')}</div></div></div><footer class="town-map-footer"><span>${t('Scroll or swipe to explore','Scrollen oder wischen zum Erkunden')}</span>${account?`<span class="town-own-key">● ${t('Your stores','Deine Läden')}</span>`:''}</footer></section><aside class="town-neighbours" aria-label="${t('Stores and owners','Läden und Besitzer')}">${storeList(places)}</aside></div></div>`;
    const map=accountContent.querySelector('.town-map-scroll');fitMap(map);mapObserver.disconnect();mapObserver.observe(map);if(scroll){map.scrollLeft=scroll.x;map.scrollTop=scroll.y;}else centerPlot(selected||places.find(plot=>plot.business?.own)?.id||places.find(plot=>plot.business)?.id);
    if(openOnLoad){openOnLoad=false;openPurchase(selected);}
  }
  function centerPlot(id){const plot=data?.plots.find(plot=>plot.id===id),map=accountContent.querySelector('.town-map-scroll'),world=map?.querySelector('.town-map-world');if(plot&&map&&world){const p=point(plot);map.scrollLeft=world.offsetLeft+world.clientWidth*p.x/100-map.clientWidth/2;map.scrollTop=world.offsetTop+world.clientHeight*p.y/100-map.clientHeight/2;}}
  function purchaseMarkup(){
    const plot=data.plots.find(plot=>plot.id===selected);if(!plot||plot.occupied)return '';
    const cost=plot.costs[storeType],capacity=storeType==='cars'?plot.carCapacity:plot.capacity,capped=data.myStoreCount>=data.maxStores,locked=account&&(data.playerLevel??1)<plot.requiredLevel;
    return `<div class="town-purchase-content"><button type="button" class="dialog-close" data-town-close aria-label="${t('Close','Schließen')}">×</button><p class="eyebrow">${t('A NEW ADDRESS','EIN NEUER STANDORT')} · ${esc(plot.districtName)}</p><h2 id="town-purchase-title" tabindex="-1">${esc(plot.streetName)}</h2><p class="town-location-size">${esc(sizeName(plot.size))}</p><form class="town-purchase"><fieldset><legend>${t('What will you open?','Was möchtest du eröffnen?')}</legend><div class="town-type-grid">${data.types.map(type=>`<label class="town-type-choice${storeType===type.id?' is-selected':''}"><input type="radio" name="type" value="${type.id}" ${storeType===type.id?'checked':''} ${busy?'disabled':''}>${art.icon(type.id)}<span>${esc(typeName(type.id))}</span></label>`).join('')}</div></fieldset><div class="town-buy-summary"><span>${capacity} ${t('shelf spaces','Regalplätze')}</span><strong>${justizEuro(cost)}</strong></div>${account?`<p class="town-purchase-note">${capped?t('Your store limit is reached.','Dein Ladenlimit ist erreicht.'):locked?t(`Requires level ${plot.requiredLevel}.`,`Benötigt Level ${plot.requiredLevel}.`):account.tokens<cost?t(`You need ${justizEuro(cost-account.tokens)} more.`,`Dir fehlen noch ${justizEuro(cost-account.tokens)}.`):t(`Balance after purchase: ${justizEuro(account.tokens-cost)}.`,`Guthaben nach dem Kauf: ${justizEuro(account.tokens-cost)}.`)}</p><button type="submit" class="primary-button" ${busy||capped||locked||account.tokens<cost?'disabled':''}>${busy?t('Opening…','Wird eröffnet …'):t('Open store here','Hier einen Laden eröffnen')} →</button>`:`<a href="/login" data-page class="primary-button">${t('Sign in to open here','Anmelden und hier eröffnen')} →</a>`}<p class="account-error" role="alert"></p></form><details class="town-location-details"><summary>${t('Location details','Standortdetails')}</summary><dl><div><dt>${t('Required level','Benötigtes Level')}</dt><dd>${plot.requiredLevel}</dd></div><div><dt>${t('Foot traffic','Laufkundschaft')}</dt><dd>${number(plot.trafficMultiplier,2)}×</dd></div><div><dt>${t('Location price','Standortpreis')}</dt><dd>${number(plot.priceMultiplier,2)}×</dd></div><div><dt>${t('Theft fine','Diebstahlbußgeld')}</dt><dd>${number(Math.max(1,1/plot.theftMultiplier),2)}×</dd></div><div><dt>${t('Compatible inventory','Passendes Inventar')}</dt><dd>${data.compatibleStock?.[storeType]||0}</dd></div></dl><p>${t('One plot, one store. Its size stays fixed. Keep some money for stock.','Ein Grundstück, ein Laden. Die Größe bleibt fest. Behalte etwas Guthaben für Waren.')}</p></details></div>`;
  }
  function paintPurchase(){const expanded=dialog.querySelector('.town-location-details')?.open;dialog.innerHTML=purchaseMarkup();if(expanded&&dialog.querySelector('details'))dialog.querySelector('details').open=true;}
  function openPurchase(id,button=null){const plot=data.plots.find(plot=>plot.id===id);if(!plot||plot.occupied)return;selected=id;returnFocus=button;centerPlot(id);paintPurchase();if(!dialog.open)dialog.showModal();dialog.querySelector('h2')?.focus({preventScroll:true});}
  dialog.addEventListener('close',()=>{if(currentAccountPage!=='/town')return;(returnFocus?.isConnected?returnFocus:accountContent.querySelector('[data-town-view="open"]'))?.focus({preventScroll:true});returnFocus=null;});
  document.addEventListener('click',event=>{
    if(currentAccountPage!=='/town'||!data)return;
    if(event.target.closest('[data-town-close]')){dialog.close();return;}
    if(busy)return;
    const mode=event.target.closest('[data-town-view]'),plot=event.target.closest('[data-town-plot]');
    if(mode){view=mode.dataset.townView;selected=null;render();centerPlot(visiblePlots().find(plot=>view==='open'?!plot.occupied:plot.business?.own)?.id||visiblePlots()[0]?.id);accountContent.querySelector(`[data-town-view="${view}"]`)?.focus({preventScroll:true});}
    if(plot)openPurchase(plot.dataset.townPlot,plot);
  });
  document.addEventListener('change',event=>{
    if(currentAccountPage!=='/town'||!data||busy)return;
    if(event.target.matches('[data-town-district]')){district=event.target.value||null;selected=null;const query=new URLSearchParams(location.search);query.delete('plot');district?query.set('district',district):query.delete('district');history.replaceState({},'','/town'+(query.size?'?'+query:''));render();centerPlot(visiblePlots()[0]?.id);accountContent.querySelector('[data-town-district]').focus({preventScroll:true});}
    if(event.target.matches('.town-purchase [name="type"]')){storeType=event.target.value;paintPurchase();dialog.querySelector(`[value="${storeType}"]`)?.focus({preventScroll:true});}
  });
  document.addEventListener('submit',async event=>{
    if(currentAccountPage!=='/town'||!event.target.matches('.town-purchase'))return;
    event.preventDefault();if(busy||!account)return;
    const plot=data.plots.find(plot=>plot.id===selected);if(!plot||plot.occupied)return;
    const visit=accountVisit,owner=account.id,type=storeType;busy=true;paintPurchase();
    try{const result=await accountApi('businesses/buy',{plotId:plot.id,type});if(visit!==accountVisit||owner!==account?.id)return;updateAccount(result.user);await navigateAccountPage('/businesses');showToast(t('Your new address is ready.','Dein neuer Standort ist bereit.'));}
    catch(error){if(visit===accountVisit&&owner===account?.id){await refresh(visit,false).catch(()=>{});busy=false;render();if(!purchaseMarkup()){dialog.close();showToast(error.message);}else{paintPurchase();dialog.querySelector('.account-error').textContent=error.message;}}}
    finally{if(visit===accountVisit)busy=false;}
  });
  document.addEventListener('jg:language',()=>{if(currentAccountPage==='/town'){render();if(dialog.open)paintPurchase();}});
  return {load,stop,render};
})();
