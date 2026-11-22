"use client";

import { useState } from "react";

export default function HomePage() {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handlePostNow() {
    setLoading(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/post-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus(`Fel: ${data.error ?? "okänt"}`);
      } else if (data.skipped) {
        setStatus(`Hoppade över: ${data.skipped}`);
      } else {
        const line = (label: string, r: { ok: boolean; id?: string; error?: string } | undefined) =>
          r?.ok ? `${label} OK (${r.id})` : `${label} FEL: ${r?.error ?? "okänt"}`;
        setStatus(
          [
            `Postat: "${data.postedTitle}"`,
            line("Instagram-flöde", data.instagram),
            line("Instagram-story", data.instagramStory),
            line("Facebook-flöde", data.facebook),
            line("Facebook-story", data.facebookStory),
          ].join(" — ")
        );
      }
    } catch (err) {
      setStatus(`Fel: ${err instanceof Error ? err.message : "okänt"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ fontFamily: "sans-serif", padding: 40, maxWidth: 640, margin: "0 auto" }}>
      <h1>Social poster — C it all store</h1>
      <p>
        Postar automatiskt till Instagram-flödet, Instagram-story,
        Facebook-flödet och Facebook-story - tre gånger om dagen.
      </p>
      <div style={{ marginTop: 24 }}>
        <label style={{ display: "block", marginBottom: 8 }}>
          ADMIN_SECRET:
          <input
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            style={{ display: "block", marginTop: 4, padding: 8, width: "100%" }}
          />
        </label>
        <button
          onClick={handlePostNow}
          disabled={loading || !secret}
          style={{ padding: "8px 16px" }}
        >
          {loading ? "Postar..." : "Posta nästa produkt nu"}
        </button>
        {status && <p style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>{status}</p>}
      </div>
    </main>
  );
}
