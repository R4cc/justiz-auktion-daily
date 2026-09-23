import { isIP } from 'node:net';

// Only enable this behind a trusted Cloudflare Tunnel. Direct clients can
// forge headers, so all other deployments use the actual socket address.
export function clientIp(request, trustCloudflare = false) {
  const remote = request.socket.remoteAddress || 'unknown';
  if (!trustCloudflare) return remote;
  const header = request.headers['cf-connecting-ip'];
  return typeof header === 'string' && isIP(header) ? header : remote;
}
