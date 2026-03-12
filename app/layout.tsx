import "./globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "AI Content Strategist Interviewer",
  description: "Structured interview-to-generation engine for LinkedIn content",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
