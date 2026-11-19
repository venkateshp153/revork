export type ProofStampHandler = (
  uri: string,
  lines: string[]
) => Promise<string>;

let handler: ProofStampHandler | null = null;

/** Registered by ProofWatermarkHost, which is mounted near the app root. */
export function registerProofStampHandler(
  next: ProofStampHandler
): () => void {
  handler = next;
  return () => {
    if (handler === next) handler = null;
  };
}

/**
 * Returns a new local URI with the delivery metadata burned in. If the host is
 * not mounted or native capture fails, the original URI is returned so proof
 * capture never blocks.
 */
export async function stampProofPhoto(
  uri: string,
  lines: string[]
): Promise<string> {
  if (!handler) return uri;
  try {
    // A safety timeout keeps photo capture moving even if the native
    // compositor cannot load the image.
    return await Promise.race([
      handler(uri, lines),
      new Promise<string>((resolve) => setTimeout(() => resolve(uri), 7000)),
    ]);
  } catch {
    return uri;
  }
}
