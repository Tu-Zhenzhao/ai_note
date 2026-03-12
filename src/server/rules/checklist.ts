import { ChecklistItem, ChecklistItemStatus, InterviewState } from "@/lib/types";
import {
  PREVIEW_SECTION_ORDER,
  getOpenPreviewSlotsForSectionIndex,
  getSectionNameForIndex,
  isPreviewSectionComplete,
  selectNextPreviewSlot,
  syncPreviewSlots,
} from "@/server/services/preview-slots";

export const SECTION_ORDER: { name: string; modules: string[] }[] = [
  ...PREVIEW_SECTION_ORDER.map((section) => ({
    name: section.name,
    modules: section.modules,
  })),
];

const FIELD_TO_CHECKLIST: Record<string, string[]> = {
  "company_profile.company_one_liner": ["cp_what_does_company_do"],
  "company_profile.company_name": ["cp_what_does_company_do"],
  "company_profile.industry": ["cp_category"],
  "company_profile.business_model": ["cp_business_model"],
  "brand_story.founding_story": ["bs_why_exist"],
  "brand_story.origin_context": ["bs_why_exist"],
  "brand_story.mission_statement": ["bs_what_believe"],
  "brand_story.core_belief": ["bs_what_believe"],
  "brand_story.what_should_people_remember": ["bs_what_remember"],
  "product_service.primary_offering": ["ps_main_offering"],
  "product_service.core_offerings": ["ps_main_offering"],
  "product_service.problem_solved": ["ps_problem_solved"],
  "product_service.key_differentiators": ["ps_why_different"],
  "market_audience.primary_audience": ["ma_primary_audience"],
  "market_audience.audience_pain_points": ["ma_struggles"],
  "market_audience.audience_desired_outcomes": ["ma_outcomes"],
  "linkedin_content_strategy.primary_content_goal": ["lcs_what_achieve"],
  "linkedin_content_strategy.desired_content_formats": ["lcs_topics_formats"],
  "linkedin_content_strategy.topics_they_want_to_talk_about": ["lcs_topics_formats"],
  "market_audience.attraction_goal": ["ma_linkedin_attraction_goal"],
  "content_preferences.preferred_tone": ["cpref_feel"],
  "content_preferences.preferred_voice": ["cpref_feel"],
  "content_preferences.preferred_style_tags": ["cpref_tone_voice_style"],
  "content_dislikes.disliked_tone": ["cdis_avoid_style"],
  "content_dislikes.disliked_messaging_patterns": ["cdis_avoid_style"],
  "evidence_library.case_studies": ["ev_proof"],
  "evidence_library.metrics_and_proof_points": ["ev_proof"],
  "evidence_library.assets": ["ev_assets"],
  "evidence_library.milestones_and_updates": ["ev_proof"],
  "evidence_library.source_material_links": ["ev_support"],
  "constraints_and_boundaries.forbidden_topics": ["cb_not_said"],
  "constraints_and_boundaries.sensitive_topics": ["cb_sensitive"],
  "constraints_and_boundaries.claims_policy": ["cb_not_said"],
  "user_concerns.main_concerns": ["uc_worries"],
  "content_readiness.ai_suggested_first_content_topic": ["cr_first_topic"],
  "content_readiness.ai_suggested_first_content_format": ["cr_first_format"],
  "content_readiness.required_missing_inputs_for_first_content": ["cr_blockers"],
};

/**
 * Reverse map: for each checklist item, how many unique fields can feed into it.
 * Items with only 1 possible field should be "answered" after 1 fill, not stuck at "partial."
 */
const CHECKLIST_ITEM_MAX_FIELDS: Record<string, number> = {};
(function buildReverseMap() {
  const reverseMap: Record<string, Set<string>> = {};
  for (const [field, itemIds] of Object.entries(FIELD_TO_CHECKLIST)) {
    for (const id of itemIds) {
      if (!reverseMap[id]) reverseMap[id] = new Set();
      reverseMap[id].add(field);
    }
  }
  for (const [id, fields] of Object.entries(reverseMap)) {
    CHECKLIST_ITEM_MAX_FIELDS[id] = fields.size;
  }
})();

export function createDefaultChecklist(): ChecklistItem[] {
  return [
    item("cp_what_does_company_do", "company_profile", "What does the company do?", "Get a clear one-liner description of the company", "critical"),
    item("cp_category", "company_profile", "What category does it belong to?", "Identify industry/vertical", "high"),
    item("cp_business_model", "company_profile", "What business model fits best?", "Software, service, hybrid, marketplace, etc.", "high"),

    item("bs_why_exist", "brand_story", "Why does the company exist?", "Founding motivation and origin story", "high"),
    item("bs_what_believe", "brand_story", "What does it believe?", "Core belief or mission", "medium"),
    item("bs_what_remember", "brand_story", "What should people remember?", "Key memorable takeaway", "medium"),

    item("ps_main_offering", "product_service", "What is the main offering?", "Primary product or service", "critical"),
    item("ps_problem_solved", "product_service", "What problem does it solve?", "Customer pain that the product addresses", "critical"),
    item("ps_why_different", "product_service", "Why is it different?", "Key differentiator vs alternatives", "high"),

    item("ma_primary_audience", "market_audience", "Who is the primary audience?", "ICP definition with roles and industries", "critical"),
    item("ma_struggles", "market_audience", "What do they struggle with?", "Pain points and challenges", "high"),
    item("ma_outcomes", "market_audience", "What outcomes do they want?", "Desired results and aspirations", "high"),
    item(
      "ma_linkedin_attraction_goal",
      "market_audience",
      "Who should be attracted on LinkedIn?",
      "The specific audience segment to attract through LinkedIn content",
      "high",
    ),

    item("lcs_what_achieve", "linkedin_content_strategy", "What should content achieve?", "Primary content goal on LinkedIn", "critical"),
    item("lcs_topics_formats", "linkedin_content_strategy", "What topics and formats make sense?", "Content directions and format preferences", "high"),

    item("cpref_feel", "content_preferences", "What should the output feel like?", "Desired emotional and tonal effect", "medium"),
    item("cpref_tone_voice_style", "content_preferences", "What tone, voice, and style are preferred?", "Specific style preferences", "medium"),

    item("cdis_avoid_style", "content_dislikes", "What should content avoid stylistically?", "Disliked tones, patterns, and messaging", "low"),

    item("ev_proof", "evidence_library", "What proof exists?", "Case studies, metrics, milestones", "critical"),
    item("ev_assets", "evidence_library", "What assets exist?", "Reusable content assets", "medium"),
    item("ev_support", "evidence_library", "What support material can be used?", "Links, documents, source material", "low"),

    item("cb_not_said", "constraints_and_boundaries", "What should not be said?", "Forbidden topics and claims", "high"),
    item("cb_sensitive", "constraints_and_boundaries", "What is sensitive or non-public?", "Confidential information boundaries", "medium"),

    item("uc_worries", "user_concerns", "What worries the user about AI-generated content?", "Concerns about quality, accuracy, positioning", "low"),

    item("cr_first_topic", "content_readiness", "What is the first plausible topic?", "Best initial content topic", "high"),
    item("cr_first_format", "content_readiness", "What is the first plausible format?", "Best initial content format", "medium"),
    item("cr_blockers", "content_readiness", "What still blocks first content generation?", "Missing inputs preventing generation", "medium"),
  ];
}

function item(
  id: string,
  module: string,
  questionLabel: string,
  questionIntent: string,
  priority: ChecklistItem["priority"],
): ChecklistItem {
  return {
    id,
    module,
    question_label: questionLabel,
    question_intent: questionIntent,
    status: "unanswered",
    answer_summary: "",
    evidence_for_answer: [],
    evidence_confidence: 0,
    supporting_turn_ids: [],
    filled_from_fields: [],
    priority,
    last_touched_turn_id: null,
    verification_needed: priority === "critical",
  };
}

/**
 * Maps a checklist item's module to its section index in SECTION_ORDER.
 * Items in the current section can reach "answered"; future-section items cap at "partial".
 */
function getSectionIndexForModule(module: string): number {
  for (let i = 0; i < SECTION_ORDER.length; i++) {
    if (SECTION_ORDER[i].modules.includes(module)) return i;
  }
  return SECTION_ORDER.length;
}

/**
 * Section-aware checklist advancement.
 * - Items in the CURRENT section: can reach "answered"
 * - Items in FUTURE sections: capped at "partial" (data saved, doesn't trigger section completion)
 */
export function advanceChecklistItems(
  state: InterviewState,
  capturedFields: string[],
  turnId: string,
  currentSectionIndex: number,
): string[] {
  const advanced: string[] = [];

  for (const field of capturedFields) {
    const itemIds = FIELD_TO_CHECKLIST[field];
    if (!itemIds) continue;

    for (const itemId of itemIds) {
      const entry = state.checklist.find((c) => c.id === itemId);
      if (!entry || entry.status === "verified" || entry.status === "not_applicable") continue;

      if (!entry.filled_from_fields.includes(field)) {
        entry.filled_from_fields.push(field);
      }
      if (!entry.supporting_turn_ids.includes(turnId)) {
        entry.supporting_turn_ids.push(turnId);
      }
      entry.last_touched_turn_id = turnId;

      const itemSectionIndex = getSectionIndexForModule(entry.module);
      const isCurrentOrPastSection = itemSectionIndex <= currentSectionIndex;

      const prevStatus = entry.status;
      const maxFields = CHECKLIST_ITEM_MAX_FIELDS[entry.id] ?? 1;
      const filled = entry.filled_from_fields.length;
      const sourceFieldStatus = readFieldStatus(state, field);
      const sourceFieldStrong =
        sourceFieldStatus === "strong" || sourceFieldStatus === "verified";

      if (isCurrentOrPastSection) {
        if (sourceFieldStrong && filled >= maxFields) {
          entry.status = "answered";
          entry.evidence_confidence = Math.min(0.9, 0.5 + filled * 0.2);
        } else if (sourceFieldStrong && filled >= Math.ceil(maxFields / 2)) {
          entry.status = "answered";
          entry.evidence_confidence = Math.min(0.8, 0.4 + filled * 0.2);
        } else {
          entry.status = "partial";
          entry.evidence_confidence = Math.min(0.6, 0.2 + filled * 0.2);
        }
      } else {
        entry.status = "partial";
        entry.evidence_confidence = Math.min(0.5, 0.2 + filled * 0.1);
        console.log(`[checklist] Cross-section capture: ${entry.id} (section ${itemSectionIndex}) marked partial — current section is ${currentSectionIndex}`);
      }

      if (entry.status !== prevStatus) {
        advanced.push(entry.id);
      }
    }
  }

  return advanced;
}

function readFieldStatus(state: InterviewState, path: string): string {
  const segments = path.split(".");
  let current: unknown = state;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || !(segment in current)) {
      return "missing";
    }
    current = (current as Record<string, unknown>)[segment];
  }
  if (current && typeof current === "object" && "status" in current) {
    return String((current as { status: string }).status);
  }
  return "missing";
}

export function getOpenChecklistItems(state: InterviewState): ChecklistItem[] {
  return state.checklist.filter(
    (item) => item.status === "unanswered" || item.status === "partial",
  );
}

export function getCriticalOpenItems(state: InterviewState): ChecklistItem[] {
  return getOpenChecklistItems(state).filter((item) => item.priority === "critical");
}

export function getHighPriorityOpenItems(state: InterviewState): ChecklistItem[] {
  return getOpenChecklistItems(state).filter(
    (item) => item.priority === "critical" || item.priority === "high",
  );
}

export function computeChecklistCompletionMap(
  state: InterviewState,
): Record<string, { total: number; answered: number; verified: number }> {
  const map: Record<string, { total: number; answered: number; verified: number }> = {};

  for (const entry of state.checklist) {
    if (!map[entry.module]) {
      map[entry.module] = { total: 0, answered: 0, verified: 0 };
    }
    map[entry.module].total += 1;
    if (entry.status === "answered" || entry.status === "verified") {
      map[entry.module].answered += 1;
    }
    if (entry.status === "verified") {
      map[entry.module].verified += 1;
    }
  }

  return map;
}

export function markChecklistItemVerified(state: InterviewState, itemId: string, turnId: string): boolean {
  const entry = state.checklist.find((c) => c.id === itemId);
  if (!entry || entry.status === "not_applicable") return false;
  entry.status = "verified";
  entry.verification_needed = false;
  entry.evidence_confidence = 1;
  entry.last_touched_turn_id = turnId;
  return true;
}

// ── Section-Sequential Logic (v4) ──────────────────────────────────

function getItemsForSection(state: InterviewState, sectionIndex: number): ChecklistItem[] {
  if (sectionIndex < 0 || sectionIndex >= SECTION_ORDER.length) return [];
  const modules = SECTION_ORDER[sectionIndex].modules;
  return state.checklist.filter((item) => modules.includes(item.module));
}

function getOpenItemsForSection(state: InterviewState, sectionIndex: number): ChecklistItem[] {
  return getItemsForSection(state, sectionIndex).filter(
    (item) => item.status === "unanswered" || item.status === "partial",
  );
}

/**
 * A section is complete when:
 * - ALL critical items are "answered" or better
 * - ALL high items are "answered" or better
 * - Medium/low items only need to not be "unanswered" (partial is fine)
 */
export function isSectionComplete(state: InterviewState, sectionIndex: number): boolean {
  syncPreviewSlots(state);
  return isPreviewSectionComplete(state, sectionIndex);
}

/**
 * Promote "partial" items in a section to "answered" — called when we advance
 * INTO a new section so that cross-section data captured earlier now counts.
 */
function promotePartialsInSection(state: InterviewState, sectionIndex: number): string[] {
  const items = getItemsForSection(state, sectionIndex);
  const promoted: string[] = [];
  for (const item of items) {
    if (item.status === "partial" && item.filled_from_fields.length > 0) {
      const allFieldsStrong = item.filled_from_fields.every((field) => {
        const status = readFieldStatus(state, field);
        return status === "strong" || status === "verified";
      });
      if (allFieldsStrong) {
        item.status = "answered";
        item.evidence_confidence = Math.min(0.8, 0.4 + item.filled_from_fields.length * 0.2);
        promoted.push(item.id);
      }
    }
  }
  if (promoted.length > 0) {
    console.log(`[checklist] Promoted ${promoted.length} partial items to answered in section ${sectionIndex}: [${promoted.join(", ")}]`);
  }
  return promoted;
}

export function advanceSectionIfComplete(state: InterviewState): { advanced: boolean; newIndex: number; sectionName: string } {
  let idx = state.conversation_meta.current_section_index;
  const startIdx = idx;
  state.conversation_meta.current_section_turn_count += 1;
  syncPreviewSlots(state);

  if (isSectionComplete(state, idx) && idx < SECTION_ORDER.length - 1) {
    console.log(`[checklist] Section ${idx} "${SECTION_ORDER[idx].name}" complete — advancing`);
    idx += 1;
    promotePartialsInSection(state, idx);
  }

  if (idx >= SECTION_ORDER.length) {
    idx = SECTION_ORDER.length - 1;
  }

  if (idx !== startIdx) {
    state.conversation_meta.current_section_turn_count = 0;
  }

  state.conversation_meta.current_section_index = idx;

  const section = SECTION_ORDER[idx];
  state.conversation_meta.current_focus_modules = section.modules;

  return {
    advanced: idx > startIdx,
    newIndex: idx,
    sectionName: section.name,
  };
}

export function getCurrentSectionName(state: InterviewState): string {
  const idx = state.conversation_meta.current_section_index;
  return getSectionNameForIndex(idx);
}

export function getCurrentSectionOpenItems(state: InterviewState): ChecklistItem[] {
  return getOpenItemsForSection(state, state.conversation_meta.current_section_index);
}

export function getAnsweredItemsForSection(state: InterviewState, sectionIndex: number): ChecklistItem[] {
  return getItemsForSection(state, sectionIndex).filter(
    (item) => item.status === "answered" || item.status === "verified",
  );
}

/**
 * v4: Section-sequential target selection.
 * Only picks from the current section's unanswered/partial items.
 * Within the section, prioritizes critical > high > medium > low, then unanswered > partial.
 */
export function selectBestChecklistTarget(state: InterviewState): ChecklistItem | null {
  const previewTarget = selectNextPreviewSlot(state);
  if (previewTarget) {
    for (const checklistId of previewTarget.checklist_item_ids) {
      const match = state.checklist.find((item) => item.id === checklistId);
      if (match) return match;
    }
  }

  const openCurrentSlots = getOpenPreviewSlotsForSectionIndex(
    state,
    state.conversation_meta.current_section_index,
  );
  if (openCurrentSlots.length === 0) {
    return null;
  }

  const firstOpen = openCurrentSlots[0];
  return state.checklist.find((item) =>
    firstOpen.checklist_item_ids.includes(item.id),
  ) ?? null;
}
