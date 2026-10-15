// Shared by disposal and metadata migrations; settled transfers release locks.
export const RESALE_LOCK_SQL = `(status = 'active' OR (status = 'ended' AND winner_id IS NOT NULL AND settled_at IS NULL))`;
