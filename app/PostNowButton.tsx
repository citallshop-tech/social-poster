"use client";

import { useState } from "react";

export function PostNowButton() {
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function postNow() {
    setLoading(true);
    setResult(null);
    const res = await fetch("/api/post-now", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret }),
    });
    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      setResult(data.error ?? "Något gick fel.");
      return;
    }
    setResult(
      data.posted
        ? `Postade: ${data.productTitle}`
        : data.reason ?? "Inget att posta just nu."
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        type="password"
        value={secret}
        onChange={(e) => setSecret(e.target.value)}
        placeholder="Lösenord (ADMIN_SECRET)"
        className="bg-white border border-stone-300 px-3 py-2 focus:outline-none focus:border-stone-600"
      />
      <button
        onClick={postNow}
        disabled={loading || !secret}
        className="bg-[#4A5D45] text-white py-2.5 hover:bg-[#3d4d39] disabled:opacity-50 transition-colors"
      >
        {loading ? "Postar..." : "Posta nästa produkt nu"}
      </button>
      {result && <p className="text-sm text-stone-700">{result}</p>}
    </div>
  );
}
