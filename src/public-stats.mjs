function timestamp(value) {
  const parsed = Date.parse(value || '');
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : 'never';
}

export function formatPublicStats({ archive = {}, queue = {}, daily = {}, fetchState = {}, now = Date.now() } = {}) {
  const auctions = Array.isArray(archive.auctions) ? archive.auctions : [];
  const tasks = Array.isArray(queue.tasks) ? queue.tasks : [];
  const active = auctions.filter(auction => auction.endAt && Date.parse(auction.endAt) > now).length;
  const completed = auctions.filter(auction => auction.endAt && Date.parse(auction.endAt) <= now).length;
  const due = tasks.filter(task => Number(task.notBefore || 0) <= now).length;
  const allowedStatuses = new Set(['starting', 'running', 'ok', 'error', 'idle', 'waiting']);
  const status = allowedStatuses.has(fetchState.status) ? fetchState.status : 'unknown';
  const countTasks = kind => tasks.filter(task => task.kind === kind).length;

  return [
    'JUSTIZGUESSR collector stats',
    '',
    `auctions_fetched: ${auctions.length}`,
    `auctions_active: ${active}`,
    `auctions_completed: ${completed}`,
    `auctions_with_final_price: ${auctions.filter(auction => Number.isFinite(auction.finalPrice)).length}`,
    `auctions_with_image: ${auctions.filter(auction => Boolean(auction.image)).length}`,
    `daily_games_saved: ${Object.keys(daily.games || {}).length}`,
    '',
    `queue_pending: ${tasks.length}`,
    `queue_due: ${due}`,
    `queue_retries: ${tasks.filter(task => Number(task.attempts || 0) > 0).length}`,
    `queue_listing: ${countTasks('listing')}`,
    `queue_detail: ${countTasks('detail')}`,
    `queue_start_date: ${countTasks('start')}`,
    `queue_image: ${countTasks('image')}`,
    '',
    `fetch_status: ${status}`,
    `last_request_at: ${timestamp(queue.lastRequestAt)}`,
    `archive_updated_at: ${timestamp(archive.updatedAt)}`,
    ''
  ].join('\n');
}
