import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";

// Editorial display serif (optical sizing + italics for accent words).
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz"],
});

// Clean body/UI sans.
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

// Monospace for eyebrows, labels, and metadata.
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jbmono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Glazy's Tools",
  description: "A workspace for building and using AI-powered tools.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0b0d",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full" suppressHydrationWarning>
        <WorkspaceShell>{children}</WorkspaceShell>
      </body>
    </html>
  );
}
