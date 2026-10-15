import { existsSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrateSavedItemCategories, CATEGORY_CLASSIFICATION_VERSION } from '../src/item-category-migration.mjs';
import { setState } from '../src/database.mjs';

// Open SQLite directly: application startup would apply the migration before
// a requested preview. Existing databases only; never create an empty one.
const args=process.argv.slice(2), apply=args.includes('--apply');
if(args.filter(arg=>arg==='--apply').length>1 || args.some(arg=>arg.startsWith('--')&&arg!=='--apply') || args.filter(arg=>arg!=='--apply').length!==1) {
  console.error('Usage: node scripts/migrate-item-categories.mjs /path/to/justizguessr.sqlite [--apply]');
  process.exit(1);
}
const filename=path.resolve(args.find(arg=>arg!=='--apply'));
if(!existsSync(filename)) {console.error(`Database does not exist: ${filename}`);process.exit(1);}
const db=new DatabaseSync(filename,{readOnly:!apply});
try {
  db.exec('PRAGMA busy_timeout=5000');
  let backup=null;
  if(apply) {
    backup=`${filename}.categories-${new Date().toISOString().replaceAll(/[:.]/g,'-')}.bak`;
    db.prepare('VACUUM main INTO ?').run(backup);
  }
  db.exec(apply?'BEGIN IMMEDIATE':'BEGIN');
  let report;
  try {
    report=migrateSavedItemCategories(db,{dryRun:!apply});
    if(apply) setState(db,CATEGORY_CLASSIFICATION_VERSION,report);
    db.exec('COMMIT');
  } catch(error) {db.exec('ROLLBACK');throw error;}
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',database:filename,backup,...report},null,2));
} finally {db.close();}
