import type { Metadata } from "next";
import { Toaster } from "sonner";
// Self-hosted fonts (no build-time request to Google Fonts).
import "@fontsource-variable/bricolage-grotesque/index.css";
import "@fontsource-variable/figtree/index.css";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "CrossPlatform", template: "%s · CrossPlatform" },
  description: "Write once, publish to every connected social account.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <Toaster position="bottom-right" richColors closeButton />
      </body>
    </html>
  );
}
