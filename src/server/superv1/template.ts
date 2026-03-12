import { randomUUID } from "crypto";
import { createDefaultChecklist, SECTION_ORDER } from "@/server/rules/checklist";
import { SuperV1FieldType, SuperV1TemplateQuestion } from "@/server/superv1/types";

export const SUPERV1_TEMPLATE_ID = "superv1_default_6_section";

const FIELD_TYPE_BY_QUESTION_ID: Record<string, SuperV1FieldType> = {
  cp_business_model: "select",
  cp_category: "multi_select",
};

function inferFieldType(questionId: string): SuperV1FieldType {
  return FIELD_TYPE_BY_QUESTION_ID[questionId] ?? "text";
}

function normalizeSectionId(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function buildModuleToSectionId(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const section of SECTION_ORDER) {
    const sectionId = normalizeSectionId(section.name);
    for (const module of section.modules) {
      map[module] = sectionId;
    }
  }
  return map;
}

export function buildDefaultSuperV1Template(templateId = SUPERV1_TEMPLATE_ID): SuperV1TemplateQuestion[] {
  const moduleSectionMap = buildModuleToSectionId();
  const checklist = createDefaultChecklist();

  return checklist.map((item, idx) => ({
    id: randomUUID(),
    template_id: templateId,
    section_id: moduleSectionMap[item.module] ?? "unknown_section",
    question_id: item.id,
    question_text: item.question_label,
    question_description: item.question_intent || null,
    field_type: inferFieldType(item.id),
    is_required: item.priority === "critical" || item.priority === "high",
    display_order: idx + 1,
  }));
}

