const PRIVATE_IPV4 = [
  /^10\./,
  /^127\./,
  /^169\.254\./,
  /^192\.168\./,
  /^172\.(?:1[6-9]|2\d|3[01])\./,
  /^0\./
];

export function requirePublicWebUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('网页地址格式不正确。');
  }
  if (url.protocol !== 'https:') {
    throw new Error('只允许读取 HTTPS 网页。');
  }
  if (url.username || url.password) throw new Error('网页地址不能包含账号信息。');
  if (url.port) throw new Error('网页地址不能使用非标准端口。');
  const hostname = url.hostname.toLocaleLowerCase().replace(/\.$/, '').replace(/^\[|\]$/g, '');
  if (
    !hostname
    || hostname === 'localhost'
    || hostname.endsWith('.localhost')
    || hostname === '::1'
    || hostname === '::'
    || hostname.endsWith('.local')
    || hostname.endsWith('.internal')
    || PRIVATE_IPV4.some((pattern) => pattern.test(hostname))
    || isPrivateIpv6(hostname)
  ) {
    throw new Error('不能读取本机或内网地址。');
  }
  url.hash = '';
  return url;
}

function isPrivateIpv6(hostname: string): boolean {
  if (!hostname.includes(':')) return false;
  const normalized = hostname.toLowerCase();
  if (/^(?:fc|fd)[0-9a-f]{2}:/.test(normalized) || /^fe[89ab][0-9a-f]:/.test(normalized)) return true;
  if (normalized.startsWith('::ffff:')) return true;
  return false;
}
