import { readFileSync } from 'node:fs';
import { auctionSelectionCategory } from '../src/auction-selection.mjs';
const args=process.argv.slice(2);
if(args.length!==1) {console.error('Usage: node scripts/audit-item-categories.mjs /path/to/auction-archive.json');process.exit(1);}
const archive=JSON.parse(readFileSync(args[0],'utf8'));
if(!Array.isArray(archive.auctions))throw new Error('Expected an auction archive with an auctions array');
const before={},after={},changes=[],other=[];
for(const item of archive.auctions) {
  const previous=item.category||'Sonstiges',category=auctionSelectionCategory(item);
  before[previous]=(before[previous]||0)+1;after[category]=(after[category]||0)+1;
  if(previous!==category)changes.push({id:item.id,title:item.title,from:previous,to:category});
  if(category==='Sonstiges')other.push({id:item.id,title:item.title});
}
console.log(JSON.stringify({items:archive.auctions.length,before,after,changed:changes.length,other,changes},null,2));
