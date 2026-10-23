import { withDatabase } from './database.mjs';
import { AccountError } from './errors.mjs';
import { levelForXp } from './progression.mjs';

const DAY = 86400000;
export function adminStatistics(dataDir, actor, { days = 30, now = Date.now(), siteUsage } = {}) {
  days = Number(days);
  if (![7,30,90].includes(days)) throw new AccountError('invalid_period');
  return withDatabase(dataDir, db => {
    const admin = actor && db.prepare('SELECT admin,banned,npc,must_change_password FROM users WHERE id=?').get(actor.id);
    if (!admin?.admin || admin.banned || admin.npc || admin.must_change_password) throw new AccountError('forbidden',403);
    siteUsage?.flush();
    const end = Math.floor(now/DAY)*DAY, start = end-(days-1)*DAY;
    const date = at => new Date(at).toISOString().slice(0,10), from = date(start), through = date(end);
    const tables = new Set(db.prepare("SELECT name FROM sqlite_schema WHERE type='table'").all().map(row=>row.name));
    const query = (table, sql, args = []) => tables.has(table) ? db.prepare(sql).all(...args) : [];
    const single = (table, sql, args = []) => query(table,sql,args)[0] || {};
    const users = db.prepare(`SELECT COUNT(*) AS total,COALESCE(SUM(admin),0) AS admins,COALESCE(SUM(banned),0) AS banned,
      COALESCE(SUM(created_at>=? AND created_at<?),0) AS registered,COALESCE(SUM(tokens),0) AS availableBalance
      FROM users WHERE npc=0`).get(start,end+DAY);
    const sessions = single('account_sessions',`SELECT COUNT(DISTINCT s.user_id) AS accounts FROM account_sessions s
      JOIN users u ON u.id=s.user_id WHERE s.expires>? AND u.npc=0 AND u.banned=0 AND u.must_change_password=0`,[now]);
    const games = query('account_games',`SELECT g.mode,COUNT(*) AS started,SUM(g.complete) AS completed,COUNT(DISTINCT g.user_id) AS players
      FROM account_games g JOIN users u ON u.id=g.user_id WHERE u.npc=0 AND g.date BETWEEN ? AND ? GROUP BY g.mode`,[from,through]);
    const playing = single('account_games',`SELECT COUNT(DISTINCT g.user_id) AS players FROM account_games g
      JOIN users u ON u.id=g.user_id WHERE u.npc=0 AND g.date BETWEEN ? AND ?`,[from,through]);
    const guests = query('guest_game_runs',`SELECT mode,COUNT(*) AS started,SUM(COALESCE(json_extract(payload,'$.complete'),0)) AS completed
      FROM guest_game_runs WHERE date BETWEEN ? AND ? GROUP BY mode`,[from,through]);
    const inventory = single('inventory',`SELECT COUNT(*) AS items FROM inventory i JOIN users u ON u.id=i.user_id WHERE u.npc=0 AND i.sold_at IS NULL`);
    const stores = single('businesses',`SELECT COUNT(*) AS stores,COUNT(DISTINCT b.user_id) AS owners,COALESCE(SUM(b.cash_balance),0) AS cash
      FROM businesses b JOIN users u ON u.id=b.user_id WHERE u.npc=0 AND b.retired=0`);
    const auctions = single('resale_auctions',`SELECT COUNT(*) AS active FROM resale_auctions a JOIN users u ON u.id=a.seller_id
      WHERE u.npc=0 AND a.status='active' AND a.ends_at>?`,[now]);
    const rewards = single('daily_rewards',`SELECT COALESCE(SUM(r.earned),0) AS paid FROM daily_rewards r JOIN users u ON u.id=r.user_id
      WHERE u.npc=0 AND r.date BETWEEN ? AND ?`,[from,through]);
    const levels = db.prepare('SELECT xp,COUNT(*) AS players FROM users WHERE npc=0 GROUP BY xp').all();
    const levelCounts = new Map();
    for (const row of levels) { const level=levelForXp(row.xp);levelCounts.set(level,(levelCounts.get(level)||0)+row.players); }
    const series = Array.from({length:days},(_,index)=>({date:date(start+index*DAY),registrations:0,games:0,completed:0,players:0,guestGames:0,requests:0,clientErrors:0,serverErrors:0}));
    const byDate = new Map(series.map(row=>[row.date,row]));
    const merge = rows => {for(const row of rows){const day=byDate.get(row.date);if(day)Object.assign(day,row);}};
    merge(db.prepare(`SELECT strftime('%Y-%m-%d',created_at/1000,'unixepoch') AS date,COUNT(*) AS registrations FROM users
      WHERE npc=0 AND created_at>=? AND created_at<? GROUP BY date`).all(start,end+DAY));
    merge(query('account_games',`SELECT g.date,COUNT(*) AS games,SUM(g.complete) AS completed,COUNT(DISTINCT g.user_id) AS players
      FROM account_games g JOIN users u ON u.id=g.user_id WHERE u.npc=0 AND g.date BETWEEN ? AND ? GROUP BY g.date`,[from,through]));
    merge(query('guest_game_runs','SELECT date,COUNT(*) AS guestGames FROM guest_game_runs WHERE date BETWEEN ? AND ? GROUP BY date',[from,through]));
    merge(query('site_usage_daily',`SELECT date,SUM(requests) AS requests,SUM(client_errors) AS clientErrors,SUM(server_errors) AS serverErrors
      FROM site_usage_daily WHERE date BETWEEN ? AND ? GROUP BY date`,[from,through]));
    const routes = query('site_usage_daily',`SELECT route,SUM(requests) AS requests,SUM(client_errors) AS clientErrors,SUM(server_errors) AS serverErrors,
      SUM(duration_ms)/SUM(requests) AS averageMs FROM site_usage_daily WHERE date BETWEEN ? AND ? GROUP BY route ORDER BY requests DESC,route LIMIT 30`,[from,through]);
    const traffic = single('site_usage_daily',`SELECT COALESCE(SUM(requests),0) AS requests,COALESCE(SUM(CASE WHEN route LIKE '/api/%' THEN requests ELSE 0 END),0) AS apiRequests,
      COALESCE(SUM(client_errors),0) AS clientErrors,COALESCE(SUM(server_errors),0) AS serverErrors,COALESCE(SUM(duration_ms)/NULLIF(SUM(requests),0),0) AS averageMs
      FROM site_usage_daily WHERE date BETWEEN ? AND ?`,[from,through]);
    const recentUsers = db.prepare(`SELECT u.username,u.created_at AS createdAt,u.xp,u.banned,
      (SELECT COUNT(*) FROM account_games g WHERE g.user_id=u.id AND g.date BETWEEN ? AND ?) AS games
      FROM users u WHERE u.npc=0 ORDER BY u.created_at DESC,u.id LIMIT 15`).all(from,through)
      .map(({xp,...user})=>({...user,level:levelForXp(xp),banned:Boolean(user.banned)}));
    const trackingSince=single('site_usage_meta','SELECT started_at AS at FROM site_usage_meta WHERE id=1').at??null;
    for(const row of series)if(trackingSince===null||row.date<date(trackingSince))row.requests=null;
    return {generatedAt:now,days,from,through,users:{...users,signedIn:sessions.accounts||0,playing:playing.players||0},games,guests,
      economy:{items:inventory.items||0,stores:stores.stores||0,storeOwners:stores.owners||0,storeCash:stores.cash||0,activeAuctions:auctions.active||0,rewardsPaid:rewards.paid||0},
      levels:[...levelCounts].sort((a,b)=>a[0]-b[0]).map(([level,players])=>({level,players})),series,recentUsers,
      traffic:{requests:0,apiRequests:0,clientErrors:0,serverErrors:0,averageMs:0,...traffic,trackingSince,routes}};
  });
}
