"use client";

import { useState } from "react";

export default function HomePage() {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [adStatus, setAdStatus] = useState<string | null>(null);
  const [adLoading, setAdLoading] = useState(false);
  const [cleanupStatus, setCleanupStatus] = useState<string | null>(null);
  const [cleanupLoading, setCleanupLoading] = useState(false);

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

  async function handlePostCampaignAdNow() {
    setAdLoading(true);
    setAdStatus(null);
    try {
      const res = await fetch("/api/admin/post-campaign-ad-now", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAdStatus(`Fel: ${data.error ?? "okänt"}`);
      } else if (data.skipped) {
        setAdStatus(`Hoppade över: ${data.skipped}`);
      } else {
        const line = (label: string, r: { ok: boolean; id?: string; error?: string } | undefined) =>
          r?.ok ? `${label} OK (${r.id})` : `${label} FEL: ${r?.error ?? "okänt"}`;
        setAdStatus(
          (data.posted as Array<{
            campaign: string;
            instagram: { ok: boolean; id?: string; error?: string };
            instagramStory: { ok: boolean; id?: string; error?: string };
            facebook: { ok: boolean; id?: string; error?: string };
            facebookStory: { ok: boolean; id?: string; error?: string };
          }>)
            .map((p) =>
              [
                `Kampanj: "${p.campaign}"`,
                line("Instagram-flöde", p.instagram),
                line("Instagram-story", p.instagramStory),
                line("Facebook-flöde", p.facebook),
                line("Facebook-story", p.facebookStory),
              ].join(" — ")
            )
            .join("\n")
        );
      }
    } catch (err) {
      setAdStatus(`Fel: ${err instanceof Error ? err.message : "okänt"}`);
    } finally {
      setAdLoading(false);
    }
  }

  async function handleCleanupSpamPosts() {
    setCleanupLoading(true);
    setCleanupStatus(null);
    try {
      const res = await fetch("/api/admin/cleanup-posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCleanupStatus(`Fel: ${data.error ?? "okänt"}`);
      } else {
        const fb = data.facebook;
        const ig = data.instagram;
        const lines = [
          `Facebook: ${fb.ok} av ${fb.totalAttempted} borttagna.`,
          fb.failed.length > 0
            ? `Misslyckades (${fb.failed.length}): ${fb.failed.map((f: { id: string; detail: string }) => f.id).join(", ")}`
            : "Alla Facebook-inlägg/stories togs bort.",
          ig.skipped
            ? `Instagram: ${ig.skipped}`
            : `Instagram: ${ig.ok} av ${ig.totalAttempted} borttagna.`,
        ];
        setCleanupStatus(lines.join("\n"));
      }
    } catch (err) {
      setCleanupStatus(`Fel: ${err instanceof Error ? err.message : "okänt"}`);
    } finally {
      setCleanupLoading(false);
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

      <div style={{ marginTop: 40, borderTop: "1px solid #ddd", paddingTop: 24 }}>
        <h2 style={{ fontSize: 18 }}>Kampanj-annons (var 3:e dag under en rabattkampanj)</h2>
        <p>
          Postar automatiskt en extra annons om en aktiv rabattkampanj har en
          &quot;annonsdag&quot; idag (var 3:e dag sedan kampanjen startade). Den här
          knappen testar det NU, oavsett vilken dag det är.
        </p>
        <button
          onClick={handlePostCampaignAdNow}
          disabled={adLoading || !secret}
          style={{ padding: "8px 16px" }}
        >
          {adLoading ? "Postar..." : "Testa kampanj-annons nu"}
        </button>
        {adStatus && <p style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>{adStatus}</p>}
      </div>

      <div style={{ marginTop: 40, borderTop: "1px solid #ddd", paddingTop: 24 }}>
        <h2 style={{ fontSize: 18 }}>Engångsstädning (2026-11-22-incidenten)</h2>
        <p>
          Tar bort de ~24 felaktiga spam-inläggen (+ stories) som skapades av
          buggen i kampanj-annonsen. Säkert att trycka flera gånger. Ta bort
          den här sektionen när städningen är klar och koden pushats igen.
        </p>
        <button
          onClick={handleCleanupSpamPosts}
          disabled={cleanupLoading || !secret}
          style={{ padding: "8px 16px" }}
        >
          {cleanupLoading ? "Städar..." : "Städa bort spam-inläggen nu"}
        </button>
        {cleanupStatus && <p style={{ marginTop: 16, whiteSpace: "pre-wrap" }}>{cleanupStatus}</p>}
      </div>
    </main>
  );
}
