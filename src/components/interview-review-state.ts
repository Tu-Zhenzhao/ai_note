export type ReviewSectionId =
  | "company_understanding"
  | "audience_understanding"
  | "linkedin_content_strategy"
  | "evidence_and_proof_assets"
  | "generation_plan";

export const ACTIVE_PREVIEW_SECTION_MAP: Record<string, ReviewSectionId> = {
  "Company Understanding": "company_understanding",
  "Audience Understanding": "audience_understanding",
  "LinkedIn Content Strategy": "linkedin_content_strategy",
  "Evidence & Proof Assets": "evidence_and_proof_assets",
  "Generation Plan": "generation_plan",
};

export const SECTION_NAME_BY_ID: Record<ReviewSectionId, string> = {
  company_understanding: "Company Understanding",
  audience_understanding: "Audience Understanding",
  linkedin_content_strategy: "LinkedIn Content Strategy",
  evidence_and_proof_assets: "Evidence & Proof Assets",
  generation_plan: "Generation Plan",
};

export const REVIEW_SECTION_BY_INDEX: Record<number, ReviewSectionId> = {
  0: "company_understanding",
  1: "audience_understanding",
  2: "linkedin_content_strategy",
  3: "evidence_and_proof_assets",
  5: "generation_plan",
};

export function getPreviewFocusKey(
  currentSectionName: string,
  confirmingSectionId: ReviewSectionId | null,
): ReviewSectionId | "" {
  if (confirmingSectionId) return confirmingSectionId;
  return ACTIVE_PREVIEW_SECTION_MAP[currentSectionName] ?? "";
}

export function getSectionVisualState(
  configKey: string,
  currentSectionName: string,
  confirmingSectionId: ReviewSectionId | null,
  isStructuredHelpSelection = false,
) {
  const focusKey = getPreviewFocusKey(currentSectionName, confirmingSectionId);
  return {
    isConfirming: confirmingSectionId === configKey,
    isActive: !confirmingSectionId && !isStructuredHelpSelection && focusKey === configKey,
  };
}
