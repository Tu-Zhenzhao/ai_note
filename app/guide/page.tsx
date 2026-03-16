"use client";

import Link from "next/link";
import { useLanguage } from "@/lib/language-context";

export default function GuidePage() {
  const { t } = useLanguage();

  const steps = [
    { title: t("guide_step_1_title"), body: t("guide_step_1_body") },
    { title: t("guide_step_2_title"), body: t("guide_step_2_body") },
    { title: t("guide_step_3_title"), body: t("guide_step_3_body") },
    { title: t("guide_step_4_title"), body: t("guide_step_4_body") },
    { title: t("guide_step_5_title"), body: t("guide_step_5_body") },
  ];

  const tips = [t("guide_tip_1"), t("guide_tip_2"), t("guide_tip_3")];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--color-bg)",
        padding: "28px 18px 36px",
      }}
    >
      <div style={{ maxWidth: 920, margin: "0 auto" }}>
        <div
          style={{
            background: "linear-gradient(140deg, #fff 0%, #f9f6ee 100%)",
            border: "1px solid var(--color-line)",
            borderRadius: "var(--radius-l)",
            boxShadow: "var(--shadow-1)",
            padding: "20px 20px 16px",
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  color: "var(--color-text)",
                  fontSize: 28,
                  letterSpacing: "-0.02em",
                }}
              >
                {t("guide_title")}
              </h1>
              <p style={{ margin: "8px 0 0 0", color: "var(--color-muted)", fontSize: 14 }}>
                {t("guide_intro")}
              </p>
            </div>
            <Link
              href="/"
              style={{
                textDecoration: "none",
                background: "var(--color-cta)",
                color: "#fff",
                borderRadius: 999,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 600,
              }}
            >
              {t("guide_back_home")}
            </Link>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: 10,
          }}
        >
          {steps.map((step, index) => (
            <section
              key={step.title}
              style={{
                background: "#fff",
                border: "1px solid var(--color-line)",
                borderRadius: "var(--radius-m)",
                padding: "14px 15px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 22,
                    height: 22,
                    borderRadius: "50%",
                    background: "var(--color-accent-soft)",
                    color: "var(--color-accent)",
                    fontSize: 12,
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {index + 1}
                </span>
                <h2 style={{ margin: 0, fontSize: 16, color: "var(--color-text)" }}>{step.title}</h2>
              </div>
              <p style={{ margin: "8px 0 0 30px", color: "var(--color-muted)", fontSize: 14, lineHeight: 1.7 }}>
                {step.body}
              </p>
            </section>
          ))}
        </div>

        <section
          style={{
            marginTop: 12,
            background: "#fff",
            border: "1px solid var(--color-line)",
            borderRadius: "var(--radius-m)",
            padding: "14px 15px",
          }}
        >
          <h3 style={{ margin: 0, fontSize: 15, color: "var(--color-text)" }}>{t("guide_tip_title")}</h3>
          <ul style={{ margin: "8px 0 0 0", paddingLeft: 18, color: "var(--color-muted)", lineHeight: 1.8 }}>
            {tips.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}

