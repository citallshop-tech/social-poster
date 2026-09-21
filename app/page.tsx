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
        const igLine = data.instagram?.ok
          ? `Instagram OK (${data.instagram.id})`
          : `Instagram FEL: ${data.instagram?.error ?? "okänt"}`;
        const fbLine = data.facebook?.ok
          ? `Facebook OK (${data.facebook.id})`
          : `Facebook FEL: ${data.facebook?.error ?? "okänt"}`;
        setStatus(`Postat: "${data.postedTitle}" — ${igLine} — ${fbLine}`);
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
        Postar automatiskt en produkt om dagen till både Instagram och
        Facebook (kl 10:00 UTC, ≈ 11–12 svensk tid).
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
        {status && <p style={{ marginTop: 16 }}>{status}</p>}
      </div>
    </main>
  );
}
