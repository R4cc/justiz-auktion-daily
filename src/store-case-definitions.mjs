// Category and tier identity is shared by quoting, stock and saved cases.
export const STORE_CATEGORIES = Object.freeze([
  {id:'electronics',name:'Electronics',nameDe:'Elektronik',badge:'ELEC'},
  {id:'cars',name:'Cars',nameDe:'Autos',badge:'CAR'},
  {id:'wine',name:'Wine',nameDe:'Wein',badge:'VIN'},
  {id:'tools',name:'Tools',nameDe:'Werkzeuge',badge:'TOOL'},
  {id:'jewellery',name:'Jewellery',nameDe:'Schmuck',badge:'GEM'},
  {id:'collectibles',name:'Collectibles',nameDe:'Sammlerstücke',badge:'RARE'}
]);
export const STORE_TIERS = Object.freeze([
  {id:'standard',name:'Standard',nameDe:'Standard',badge:'I',design:'lost-property',stock:20,weights:[7500,2000,450,49,1]},
  {id:'premium',name:'Premium',nameDe:'Premium',badge:'II',design:'seizure',stock:12,weights:[3500,3200,2500,700,100]},
  {id:'elite',name:'Elite',nameDe:'Elite',badge:'III',design:'collectors-cache',stock:6,weights:[800,1700,3500,3000,1000]}
]);
export const STORE_CASES = Object.freeze(STORE_CATEGORIES.flatMap(category=>STORE_TIERS.map(tier=>Object.freeze({
  id:`${category.id}-${tier.id}`,category:category.id,tier:tier.id,
  name:`${({cars:'Car',tools:'Tool',collectibles:'Collector'})[category.id]||category.name} Case · ${tier.name}`,nameDe:`${({cars:'Auto',tools:'Werkzeug',collectibles:'Sammler'})[category.id]||category.nameDe}-Kiste · ${tier.nameDe}`,
  badge:`${category.badge} ${tier.badge}`,design:tier.design,weights:tier.weights,stock:tier.stock
}))));
// Retired products remain readable for saved receipts and first-open upgrades.
export const LEGACY_STORE_CASES = Object.freeze([
  {id:'lost-property',weights:[7500,2000,450,49,1]},
  {id:'evidence-locker',weights:[5500,3000,1200,280,20]},
  {id:'seizure',weights:[3500,3200,2500,700,100]},
  {id:'vault',weights:[1800,2700,3500,1700,300]},
  {id:'collectors-cache',weights:[800,1700,3500,3000,1000]}
]);
