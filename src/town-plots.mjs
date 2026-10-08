import { AccountError } from './errors.mjs';

// Six real district names, deliberately simplified game traits and geography.
export const TOWN_DISTRICTS = [
  { id:'leopoldstadt', number:2, name:'Leopoldstadt', color:'#5a8892', priceMultiplier:1, theftMultiplier:1, tagEn:'Prater crowds & riverside regulars', tagDe:'Praterpublikum & Stammgäste am Wasser', storyEn:'The Prater, picnic blankets and someone selling you a suspiciously cheap souvenir.', storyDe:'Prater, Picknickdecken und jemand mit verdächtig billigen Souvenirs.', bounds:[530,160,260,255] },
  { id:'innere-stadt', number:1, name:'Innere Stadt', color:'#b58a39', priceMultiplier:2, theftMultiplier:.8, tagEn:'Tourists, luxury & eye-watering prices', tagDe:'Touristen, Luxus & schwindelerregende Preise', storyEn:'Every second customer is a tourist. Every first landlord knows it.', storyDe:'Jeder zweite Kunde ist Tourist. Jeder erste Vermieter weiß das.', bounds:[340,260,180,180] },
  { id:'neubau', number:7, name:'Neubau', color:'#91729e', priceMultiplier:1.3, theftMultiplier:1, tagEn:'Vintage finds & expensive oat milk', tagDe:'Vintage-Funde & teure Hafermilch', storyEn:'If it is second-hand, call it curated. If it is broken, call it an installation.', storyDe:'Gebraucht heißt hier kuratiert. Kaputt heißt Kunstinstallation.', bounds:[145,275,185,190] },
  { id:'favoriten', number:10, name:'Favoriten', color:'#b97251', priceMultiplier:.85, theftMultiplier:1.8, tagEn:'Bargains, busy streets & sticky fingers', tagDe:'Schnäppchen, volle Straßen & flinke Finger', storyEn:'Fast deals and faster hands. A goose guard might be your best employee.', storyDe:'Schnelle Geschäfte, schnellere Hände. Eine Wachgans könnte dein bester Mitarbeiter sein.', bounds:[305,455,340,240] },
  { id:'hietzing', number:13, name:'Hietzing', color:'#749576', priceMultiplier:1.7, theftMultiplier:.65, tagEn:'Villa money & very quiet complaints', tagDe:'Villengeld & sehr leise Beschwerden', storyEn:'The neighbours have hedges taller than your shop. Even the dogs have accountants.', storyDe:'Die Hecken sind höher als dein Laden. Selbst die Hunde haben Buchhalter.', bounds:[15,480,280,215] },
  { id:'doebling', number:19, name:'Döbling', color:'#a09b60', priceMultiplier:1.5, theftMultiplier:.75, tagEn:'Vineyards, old money & one more spritzer', tagDe:'Weinberge, altes Geld & noch ein Spritzer', storyEn:'Old money, new wine. Business meetings end when the last spritzer does.', storyDe:'Altes Geld, neuer Wein. Geschäftstermine dauern bis zum letzten Spritzer.', bounds:[170,15,355,235] }
];
export const TOWN_STREETS = [
  {id:'side',nameEn:'Side street',nameDe:'Seitengasse',trafficMultiplier:1},
  {id:'main',nameEn:'Shopping street',nameDe:'Einkaufsstraße',trafficMultiplier:1.5},
  {id:'residential',nameEn:'Residential lane',nameDe:'Wohngasse',trafficMultiplier:.65}
];
// Street names are inspired by Vienna; these are fictional plots, not addresses.
const roads = {
  leopoldstadt:['Praterstraße','Taborstraße','Praterallee','Donauweg'],
  'innere-stadt':['Kärntner Straße','Graben','Ringstraße','Bäckerstraße'],
  neubau:['Neubaugasse','Kirchengasse','Zollergasse','Museumsweg'],
  favoriten:['Favoritenstraße','Reumannplatz','Quellenstraße','Gudrunstraße','Sonnwendgasse'],
  hietzing:['Hietzinger Hauptstraße','Lainzer Straße','Auhofstraße','Schönbrunnweg'],
  doebling:['Döblinger Hauptstraße','Grinzinger Straße','Sieveringer Straße','Heurigenweg']
};
export const TOWN_PLOTS = TOWN_DISTRICTS.flatMap(district => roads[district.id].map((streetName,n)=>{
  const [x,y,w,h]=district.bounds, five=district.id==='favoriten';
  const positions = five ? [[.22,.36],[.51,.36],[.79,.36],[.32,.76],[.67,.76]] : [[.28,.4],[.72,.4],[.28,.77],[.72,.77]];
  return {id:`${district.id}-${n+1}`,districtId:district.id,streetName,streetType:['side','main','main','residential','side'][n],size:['popup','tiny','medium','large','popup'][n],x:Math.round(x+w*positions[n][0]),y:Math.round(y+h*positions[n][1])};
}));
const districtFor = id => TOWN_DISTRICTS.find(district=>district.id===id);
export function plotLocation(db, plotId) {
  if (!plotId) return null;
  const plot=db.prepare('SELECT * FROM town_plots WHERE id=?').get(plotId); if (!plot) return null;
  const district=districtFor(plot.district_id), street=TOWN_STREETS.find(entry=>entry.id===plot.street_type);
  return {plotId:plot.id,districtId:district.id,districtName:district.name,districtNumber:district.number,size:plot.size,streetName:plot.street_name,streetType:street.id,streetNameEn:street.nameEn,streetNameDe:street.nameDe,
    trafficMultiplier:street.trafficMultiplier,theftMultiplier:district.theftMultiplier,priceMultiplier:district.priceMultiplier,x:plot.x,y:plot.y};
}
export function ensureTownSchema(db,{now=Date.now()}={}) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_plots (
    id TEXT PRIMARY KEY, district_id TEXT NOT NULL, street_name TEXT NOT NULL, street_type TEXT NOT NULL,
    size TEXT NOT NULL, x INTEGER NOT NULL, y INTEGER NOT NULL
  ) STRICT`);
  if (!db.prepare('SELECT 1 FROM town_plots LIMIT 1').get()) {
    const existingCount=db.prepare('SELECT COUNT(*) AS n FROM businesses').get().n;
    const plots=TOWN_PLOTS.map(plot=>({...plot}));
    // The first activation must fit every existing store. These extra plots
    // are grandfathered into the finite catalog; purchases never add plots.
    for (let n=25;n<existingCount;n++) {
      const district=TOWN_DISTRICTS[(n-25)%TOWN_DISTRICTS.length];
      plots.push({id:`${district.id}-legacy-${n-24}`,districtId:district.id,streetName:`Altbestand ${n-24}`,streetType:'side',size:'popup',x:0,y:0});
    }
    for (const district of TOWN_DISTRICTS) {
      const group=plots.filter(plot=>plot.districtId===district.id);
      if (group.length===roads[district.id].length) continue;
      const [x,y,w,h]=district.bounds,cols=Math.ceil(Math.sqrt(group.length)),rows=Math.ceil(group.length/cols);
      group.forEach((plot,n)=>{plot.x=Math.round(x+w*(.15+.7*(n%cols)/(cols-1)));plot.y=Math.round(y+h*(.36+.5*Math.floor(n/cols)/(rows-1)));});
    }
    const insert=db.prepare('INSERT INTO town_plots VALUES (?,?,?,?,?,?,?)');
    for (const plot of plots) insert.run(plot.id,plot.districtId,plot.streetName,plot.streetType,plot.size,plot.x,plot.y);
  }
  const columns=db.prepare('PRAGMA table_info(businesses)').all();
  if (!columns.some(column=>column.name==='plot_id')) db.exec('ALTER TABLE businesses ADD COLUMN plot_id TEXT REFERENCES town_plots(id)');
  if (!columns.some(column=>column.name==='plot_since')) db.exec('ALTER TABLE businesses ADD COLUMN plot_since INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS businesses_plot ON businesses(plot_id)');
  const existing=db.prepare('SELECT id,size FROM businesses WHERE plot_id IS NULL ORDER BY bought_at,id').all();
  const free=db.prepare('SELECT p.* FROM town_plots p WHERE NOT EXISTS (SELECT 1 FROM businesses b WHERE b.plot_id=p.id) ORDER BY p.id').all();
  if (existing.length>free.length) throw new AccountError('town_migration_capacity',409);
  for (const shop of existing) {
    let index=free.findIndex(plot=>plot.size===shop.size); if (index<0) index=0;
    const [plot]=free.splice(index,1);
    // Backfill preserves existing sizes and capacity. A fallback plot gets its
    // final size once during migration; new buyers can never resize a plot.
    if (plot.size!==shop.size) db.prepare('UPDATE town_plots SET size=? WHERE id=?').run(shop.size,plot.id);
    db.prepare('UPDATE businesses SET plot_id=?,plot_since=? WHERE id=?').run(plot.id,now,shop.id);
  }
}
export function availableTownPlot(db,size,plotId=null) {
  let plot;
  if (plotId!==null) {
    if (typeof plotId!=='string' || plotId.length>100) throw new AccountError('invalid_plot');
    plot=db.prepare('SELECT * FROM town_plots WHERE id=?').get(plotId);
    if (!plot) throw new AccountError('plot_not_found',404);
    if (db.prepare('SELECT 1 FROM businesses WHERE plot_id=?').get(plot.id)) throw new AccountError('plot_occupied',409);
    if (size && size!==plot.size) throw new AccountError('plot_size_mismatch',409);
  } else {
    // Compatibility for older clients: choose a free plot of the requested
    // size, preferring the original neutral district.
    plot=db.prepare(`SELECT p.* FROM town_plots p WHERE size=? AND NOT EXISTS (SELECT 1 FROM businesses b WHERE b.plot_id=p.id)
      ORDER BY CASE WHEN district_id='leopoldstadt' THEN 0 ELSE 1 END,p.id LIMIT 1`).get(size);
    if (!plot) throw new AccountError('no_available_plot',409);
  }
  return plot;
}
