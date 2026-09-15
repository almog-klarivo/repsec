export async function putSnapshot(env: Cloudflare.Env, key: string, value: string): Promise<void> {
  const bucket = (env as Cloudflare.Env & { SNAPSHOTS?: R2Bucket }).SNAPSHOTS;
  if (!bucket) return;
  await bucket.put(key, value);
}

export async function readLimited(res: Response, max = 32_000): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let out = "";
  while (out.length < max) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
    if (out.length >= max) break;
  }
  await reader.cancel();
  return out.slice(0, max);
}
