/**
 * 未设置或空白时返回 true，本地开发继续允许任意来源。
 * 有值时按逗号拆成允许列表，供生产环境只放行指定网页来源。
 */
export function parseCorsOrigin(raw: string | undefined): true | string[] {
  if (raw == null) return true;
  const origins = raw
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  if (origins.length === 0) return true;
  return origins;
}
