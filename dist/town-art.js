// Decorative scenery is deterministic and never creates purchasable plots.
window.townArtwork = (() => {
  const paths = {
    wine:'<path d="M8 3h4v5l2 3v10H6V11l2-3V3Z"/><path d="M6 14h8M17 4h5v5a2.5 2.5 0 0 1-5 0V4ZM19.5 12v8m-2.5 0h5"/>',
    toys:'<circle cx="7" cy="5" r="3"/><circle cx="17" cy="5" r="3"/><circle cx="12" cy="10" r="6"/><path d="M8 15c-5 1-5 7-1 7l2-2m7-5c5 1 5 7 1 7l-2-2M9 16v4h6v-4"/><path d="M9 9h.01M15 9h.01m-4 3h2"/>',
    electronics:'<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M1 21h22l-2-4H3l-2 4Zm8-13 3 2-3 2m5 0h3"/>',
    cars:'<path d="m4 10 2-6h12l2 6M3 11l1-1h16l1 1v8H3v-8Zm2 8v2m14-2v2M4 10h16M6 14h2m8 0h2"/>',
    jeweler:'<path d="m3 8 4-5h10l4 5-9 13L3 8Zm0 0h18M7 3l5 18 5-18M8 8l4-5 4 5"/>',
    hardware:'<path d="m3 21 11-11a6 6 0 0 0 7-7l-4 4-3-3 4-4a6 6 0 0 0-7 7L0 18l3 3Z"/><path d="m15 14 6 6m-3-9 4 4m-6-2 3-3"/>',
    plus:'<path d="M12 5v14M5 12h14"/>',
    lock:'<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2"/>',
    person:'<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>'
  };
  function icon(type) {
    return `<svg class="town-product-icon" data-product-icon="${paths[type]?type:'plus'}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[type]||paths.plus}</svg>`;
  }
  function storefront() {
    return '<svg class="town-store-building" viewBox="0 0 90 62" aria-hidden="true"><ellipse cx="45" cy="57" rx="36" ry="4" fill="#183e3616"/><path d="M12 15 21 5h48l9 10" fill="var(--shop-roof)" stroke="#183e3660"/><rect x="16" y="16" width="58" height="39" rx="2" fill="#faf7ec" stroke="#183e3660"/><path d="M13 15h64l4 13H9Z" fill="var(--shop-color)"/><path d="m22 15-3 13m16-13-1 13m15-13 1 13m13-13 3 13" stroke="#fffdf7" stroke-width="7"/><path d="M9 28h72" stroke="#183e3640"/><rect x="21" y="32" width="30" height="18" rx="1" fill="#cee2dd" stroke="#183e3640"/><path d="m24 45 11-10m-3 13 12-12" stroke="#fffdf780" stroke-width="2"/><rect x="57" y="31" width="12" height="24" rx="1" fill="#abc6bd" stroke="#183e3660"/><path d="M65 43v3M14 55h62" stroke="#183e3660"/></svg>';
  }
  function position(plot, districts, compact=false) {
    const area=districts.find(entry=>entry.id===plot.districtId);
    if(!area)return {x:plot.x,y:plot.y};
    const [x,y,w,h]=area.bounds;
    const firstRow=y+h*(area.id==='favoriten'?.36:.4);
    // Spread the lower row on a shorter board without crossing district edges.
    return {x:x+w/2+(plot.x-x-w/2)*(compact?1:1.15),y:compact?Math.min(y+h*.88,plot.y+Math.max(0,plot.y-firstRow)*.3):plot.y};
  }
  function road(path, main=false) {
    return `<g class="town-street${main?' is-main':''}"><path d="${path}" fill="none" stroke="#b5b3a3" stroke-width="${main?19:11}" stroke-linejoin="round" stroke-linecap="round"/><path d="${path}" fill="none" stroke="#fcfaf1" stroke-width="${main?16:8}" stroke-linejoin="round" stroke-linecap="round"/><path d="${path}" fill="none" stroke="#ded9c9" stroke-width="${main?10:4}" stroke-linejoin="round" stroke-linecap="round"/>${main?`<path d="${path}" fill="none" stroke="#fffdf7" stroke-width="1" stroke-dasharray="5 7"/>`:''}</g>`;
  }
  function tree(x,y,large=false) {
    return `<g class="town-tree" transform="translate(${x} ${y})"><g class="town-upright"><ellipse cy="6" rx="${large?10:6}" ry="3" fill="#183e3610"/><path d="M0 0v8" stroke="#827456" stroke-width="2"/><circle cy="-3" r="${large?10:6}" fill="#65a56e"/><circle cx="-2" cy="-5" r="${large?6:3}" fill="#a4cf7c"/></g></g>`;
  }
  function building(x,y,n,villa=false) {
    const walls=['#fff0bc','#e6d5f2','#bce1dc','#ffd0af'],roof=['#cf795c','#609a8c','#b28a4e'][n%3];
    return `<g class="town-deco-building" transform="translate(${x} ${y})"><g class="town-upright"><rect x="-9" y="-8" width="20" height="21" rx="1" fill="#183e3612"/><rect x="-10" y="-10" width="18" height="20" rx="1" fill="${walls[n%4]}" stroke="#928a7840"/><path d="m-12-10 11-7L10-10Z" fill="${roof}"/><path d="M-6-3h3m5 0h3m-11 5h3m5 0h3" stroke="#a6aca0" stroke-width="2"/><path d="M-2 10V5h3v5" fill="#8f9386"/>${villa?'<path d="M-15 12h29" stroke="#829970" stroke-width="3"/>':''}</g></g>`;
  }
  function districtScene(area, plots, esc, compact) {
    const [x,y,w,h]=area.bounds, streetY=Math.round(y+h*.57), local=plots.filter(plot=>plot.districtId===area.id);
    const positions=local.map(plot=>position(plot,[area],compact));
    const candidates=[];
    // Infill houses between storefronts, then smaller apartment blocks around them.
    const sorted=[...positions].sort((a,b)=>a.y-b.y||a.x-b.x);
    for(let n=0;n<sorted.length;n++)for(let m=n+1;m<sorted.length;m++)if(Math.abs(sorted[n].y-sorted[m].y)<12)candidates.push({x:(sorted[n].x+sorted[m].x)/2,y:(sorted[n].y+sorted[m].y)/2});
    for(let cy=y+54;cy<y+h-12;cy+=27)for(let cx=x+25;cx<x+w-20;cx+=24)candidates.push({x:cx,y:cy});
    const scenery=[];
    for(const point of candidates) {
      if(scenery.length>=7||Math.abs(point.y-streetY)<18||positions.some(p=>Math.abs(p.x-point.x)<43&&Math.abs(p.y-point.y)<45)||scenery.some(p=>Math.abs(p.x-point.x)<22&&Math.abs(p.y-point.y)<24))continue;
      scenery.push(point);
    }
    const street=local.find(plot=>plot.streetType==='main')?.streetName;
    return `<path d="M${x+18} ${y}H${x+w-22}L${x+w} ${y+22}V${y+h-20}L${x+w-20} ${y+h}H${x+15}L${x} ${y+h-15}V${y+18}Z" fill="${area.color}" fill-opacity=".25" stroke="${area.color}" stroke-width="2"/>
      ${road(`M${x+11} ${streetY}H${x+w-11}`,true)}
      ${road(`M${x+10} ${y+47}V${y+h-17}M${x+w-10} ${y+47}V${y+h-17}`)}
      <g class="town-crosswalk" fill="#fffdf7">${Array.from({length:5},(_,n)=>`<rect x="${x+19+n*3}" y="${streetY-6}" width="1.5" height="12"/>`).join('')}</g>
      ${scenery.map((p,n)=>building(Math.round(p.x),Math.round(p.y),n,area.id==='hietzing'||area.id==='doebling')).join('')}
      ${tree(x+w-24,y+44)}${tree(x+23,y+h-18)}
      <text class="town-district-label" x="${x+17}" y="${y+29}" fill="${area.color}" font-family="Manrope,sans-serif" font-size="${w<200?13:16}" font-weight="800">${area.number}. ${esc(area.name)}</text>
      ${street?`<text class="town-street-label" x="${x+w/2}" y="${streetY+3}" text-anchor="middle" fill="#776e60" font-family="Manrope,sans-serif" font-size="7" font-weight="600" paint-order="stroke" stroke="#fcfaf1" stroke-width="3">${esc(street)}</text>`:''}`;
  }
  const overviewPoints = {doebling:[230,120],leopoldstadt:[640,120],neubau:[230,350],'innere-stadt':[640,350],hietzing:[230,580],favoriten:[640,580]};
  const overviewPosition = id => overviewPoints[id] || [430,365];
  function overview(data, esc) {
    const colors = ['#f3da88','#b9e3da','#dfc4ed','#ffdf9b','#c5e2a8','#f4c1a1'];
    return `<svg viewBox="0 0 860 730" class="town-map-art town-overview-art" aria-hidden="true"><defs><pattern id="town-meadow" width="36" height="36" patternUnits="userSpaceOnUse"><path d="m8 12 3-4 2 5m13 15 3-4 2 5" fill="none" stroke="#88b984" stroke-width="1.5" opacity=".25"/></pattern></defs><rect width="860" height="730" rx="24" fill="#d7ebbf"/><rect width="860" height="730" fill="url(#town-meadow)"/>
      <path d="M437-30C355 90 507 215 425 335S373 530 446 770" fill="none" stroke="#3a786b" stroke-width="42"/><path d="M437-30C355 90 507 215 425 335S373 530 446 770" fill="none" stroke="#9bd9dd" stroke-width="34"/><path d="M434-20C364 90 500 215 421 330S379 530 442 760" fill="none" stroke="#d9f6ed" stroke-width="3" stroke-dasharray="12 22" stroke-linecap="round"/>
      ${[120,350,580].map(y => `<path d="M217 ${y+53}H649" stroke="#517256" stroke-width="20" stroke-linecap="round"/><path d="M217 ${y+53}H649" stroke="#fff1ca" stroke-width="15" stroke-linecap="round"/><path d="M225 ${y+53}H640" stroke="#d3b88c" stroke-width="2" stroke-dasharray="7 9"/>`).join('')}
      ${data.districts.map(a => {const [x,y] = overviewPosition(a.id),n = Object.keys(overviewPoints).indexOf(a.id); return `<g class="town-overview-district"><rect x="${x-169}" y="${y-79}" width="338" height="164" rx="53" fill="#659c6e" opacity=".18" transform="translate(0 7)"/><rect x="${x-169}" y="${y-79}" width="338" height="164" rx="53" fill="${colors[n]}" stroke="#61805d" stroke-width="2.5"/>${tree(x-143,y-52,true)}${tree(x+143,y+55,true)}${building(x-124,y+54,n,true)}${building(x+123,y-47,n+1)}</g>`;}).join('')}
      <g transform="translate(64 20)" fill="#fffdf0" stroke="#b5ceb0" stroke-width="2"><path d="M0 8c0-15 21-18 27-8 9-7 23 0 21 10H0Z"/></g><g transform="translate(758 687)"><circle r="13" fill="#fff0aa" stroke="#6b8c68" stroke-width="2"/><path d="m-4 5 4-13 4 13-4-3Z" fill="#326448"/></g></svg>`;
  }
  function render(data, district, esc, compact=false, bounds=[0,0,860,730]) {
    if (!district) return overview(data,esc);
    const area = data.districts.find(a => a.id === district), [x,y,w,h] = bounds;
    return `<svg viewBox="${bounds.join(' ')}" class="town-map-art" aria-hidden="true"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="#d7ebbf"/>${area ? districtScene(area,data.plots,esc,compact) : ''}</svg>`;
  }
  return {icon,storefront,position,render,overview,overviewPosition};
})();
