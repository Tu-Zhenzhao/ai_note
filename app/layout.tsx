import "./globals.css";
import { ReactNode } from "react";
import { LanguageProvider } from "@/lib/language-context";

export const metadata = {
  title: "AskMore | 多问AI",
  description: "AskMore (多问AI): AI strategist for structured interview intake and planning",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
