import { put, head } from "@vercel/blob";

const STATE_BLOB_PATH = "poster-state.json";

interface PosterState {
  postedProductIds: string[];
  lastPostedAt: string | null;
}

export async function loadState(): Promise<PosterState> {
  try {
    const blob = await head(STATE_BLOB_PATH);
    const res = await fetch(blob.url);
    return await res.json();
  } catch {
    // No state file yet - first run.
    return { postedProductIds: [], lastPostedAt: null };
  }
}

export async function saveState(state: PosterState): Promise<void> {
  await put(STATE_BLOB_PATH, JSON.stringify(state), {
    access: "public",
    allowOverwrite: true,
    contentType: "application/json",
  });
}

export async function markPosted(productId: string): Promise<void> {
  const state = await loadState();
  state.postedProductIds.push(productId);
  state.lastPostedAt = new Date().toISOString();
  await saveState(state);
}
