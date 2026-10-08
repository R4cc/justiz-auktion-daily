// Decorative scenery is deterministic and never creates purchasable plots.
window.townArtwork = (() => {
  const paths = {
    wine:'<path d="M8 3h4v5l2 3v10H6V11l2-3V3Z"/><path d="M6 14h8M17 4h5v5a2.5 2.5 0 0 1-5 0V4ZM19.5 12v8m-2.5 0h5"/>',
    toys:'<circle cx="7" cy="5" r="3"/><circle cx="17" cy="5" r="3"/><circle cx="12" cy="10" r="6"/><path d="M8 15c-5 1-5 7-1 7l2-2m7-5c5 1 5 7 1 7l-2-2M9 16v4h6v-4"/><path d="M9 9h.01M15 9h.01m-4 3h2"/>',
    electronics:'<rect x="3" y="3" width="18" height="14" rx="2"/><path d="M1 21h22l-2-4H3l-2 4Zm8-13 3 2-3 2m5 0h3"/>',
    cars:'<path d="m4 10 2-6h12l2 6M3 11l1-1h16l1 1v8H3v-8Zm2 8v2m14-2v2M4 10h16M6 14h2m8 0h2"/>',
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
    return `<g class="town-tree" transform="translate(${x} ${y})"><g class="town-upright"><ellipse cy="6" rx="${large?10:6}" ry="3" fill="#183e3610"/><path d="M0 0v8" stroke="#827456" stroke-width="2"/><circle cy="-3" r="${large?10:6}" fill="#809e72"/><circle cx="-2" cy="-5" r="${large?6:3}" fill="#a3b88c"/></g></g>`;
  }
  function building(x,y,n,villa=false) {
    const walls=['#e5dcc8','#ddd4c1','#d4d8cb','#e8decb'],roof=['#a9917d','#8c9691','#af9981'][n%3];
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
      if(scenery.length>=20||Math.abs(point.y-streetY)<18||positions.some(p=>Math.abs(p.x-point.x)<43&&Math.abs(p.y-point.y)<45)||scenery.some(p=>Math.abs(p.x-point.x)<22&&Math.abs(p.y-point.y)<24))continue;
      scenery.push(point);
    }
    const street=local.find(plot=>plot.streetType==='main')?.streetName;
    return `<path d="M${x+18} ${y}H${x+w-22}L${x+w} ${y+22}V${y+h-20}L${x+w-20} ${y+h}H${x+15}L${x} ${y+h-15}V${y+18}Z" fill="${area.color}" fill-opacity=".10" stroke="${area.color}" stroke-opacity=".35"/>
      ${road(`M${x+11} ${streetY}H${x+w-11}`,true)}
      ${road(`M${x+10} ${y+47}V${y+h-17}M${x+w-10} ${y+47}V${y+h-17}`)}
      <g class="town-crosswalk" fill="#fffdf7">${Array.from({length:5},(_,n)=>`<rect x="${x+19+n*3}" y="${streetY-6}" width="1.5" height="12"/>`).join('')}</g>
      ${scenery.map((p,n)=>building(Math.round(p.x),Math.round(p.y),n,area.id==='hietzing'||area.id==='doebling')).join('')}
      ${tree(x+w-24,y+44)}${tree(x+23,y+h-18)}
      <text class="town-district-label" x="${x+17}" y="${y+29}" fill="${area.color}" font-family="Manrope,sans-serif" font-size="${w<200?13:16}" font-weight="800">${area.number}. ${esc(area.name)}</text>
      ${street?`<text class="town-street-label" x="${x+w/2}" y="${streetY+3}" text-anchor="middle" fill="#776e60" font-family="Manrope,sans-serif" font-size="7" font-weight="600" paint-order="stroke" stroke="#fcfaf1" stroke-width="3">${esc(street)}</text>`:''}`;
  }
  function render(data, district, esc, compact=false) {
    return `<svg viewBox="0 0 860 730" preserveAspectRatio="none" class="town-map-art" aria-hidden="true"><defs><pattern id="town-grid" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0v25" fill="none" stroke="#183e36" stroke-opacity=".025"/></pattern></defs><rect width="860" height="730" fill="#f0eddf"/><rect width="860" height="730" fill="url(#town-grid)"/>
      <path d="M20 260Q70 215 130 245V460H20Z" fill="#d7e1c7"/>
      ${road('M148 255H535V445H327V465M430 445V453M535 306H545M162 465V480M325 578H296',true)}
      <path d="M575-20C580 80 560 160 540 240S528 390 600 430 695 540 828 760" stroke="#b8d7d2" stroke-width="22" fill="none"/><path d="M575-20C580 80 560 160 540 240S528 390 600 430 695 540 828 760" stroke="#8cb7b4" stroke-width="1.5" fill="none"/>
      <path d="M535 292H551" stroke="#a79d86" stroke-width="15"/><path d="M535 292H551" stroke="#f4ecd7" stroke-width="11"/>
      ${data.districts.map(area=>`<g class="town-district-scene" opacity="${!district||area.id===district?1:.35}">${districtScene(area,data.plots,esc,compact)}</g>`).join('')}
      <g class="town-landmark" transform="translate(83 350)"><g class="town-upright"><path d="M-25 5h50v28h-50Z" fill="#e0d1aa" stroke="#a59573"/><path d="m-29 5 29-15L29 5Z" fill="#ba9977"/><path d="M-18 13h4m8 0h4m8 0h4m8 0h4M-18 23h4m8 0h4m8 0h4m8 0h4" stroke="#a49c7d" stroke-width="4"/><path d="M-4 33V19h8v14" fill="#a49c7d"/><text y="49" text-anchor="middle" font-family="Manrope,sans-serif" font-size="8" fill="#6c795e">SCHÖNBRUNN</text></g></g>
      ${[[-18,-20],[22,-17],[-25,65],[25,70],[-37,105],[28,122]].map(([x,y])=>tree(83+x,350+y,true)).join('')}
      <g class="town-landmark" transform="translate(800 175)" fill="none" stroke="#a79577"><g class="town-upright"><circle r="19" stroke-width="2"/><path d="M0-19V19m-19-19h38m-32-13 26 26m0-26-26 26M-12 32 0 0l12 32"/><circle r="3" fill="#a79577"/><text y="45" text-anchor="middle" font-family="Manrope,sans-serif" font-size="8" fill="#776e60" stroke="none">PRATER</text></g></g>
      <text x="666" y="498" fill="#527d81" font-family="DM Mono,monospace" font-size="8" transform="rotate(35 666 498)">DONAU / DONAUKANAL</text>
      <text x="439" y="449" text-anchor="middle" fill="#827a66" font-family="Manrope,sans-serif" font-size="7">RING</text>
      <path d="m817 28-7 18h14Z" fill="#183e36"/><text x="817" y="65" text-anchor="middle" font-family="DM Mono,monospace" font-size="11" fill="#183e36">N</text><text x="18" y="722" font-family="DM Mono,monospace" font-size="9" letter-spacing="2" fill="#66736b">WIEN · GAME EDITION</text></svg>`;
  }
  return {icon,storefront,position,render};
})();
