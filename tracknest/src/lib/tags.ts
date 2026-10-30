/** A scanned value may be a full label URL (…/a/TN-000001) or a bare tag. */
export function tagFrom(raw: string) {
  const m = raw.match(/\/a\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : raw.trim();
}
