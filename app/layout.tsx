import type { ReactNode } from "react";

export const metadata = {
  title: "Social poster — C it all store",
  description:
    "Postar produkter från citall.store automatiskt till Instagram och Facebook.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="sv">
      <body>{children}</body>
    </html>
  );
}
