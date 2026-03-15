import { describe, expect, test } from "vitest";
import {
  detectExplicitHelpAbandon,
  detectHelpAction,
  detectHelpSelection,
  detectLikelyOtherDiscussion,
  detectPlausibleAnswer,
} from "@/server/superv1/services/help-mode-detector";
import { SuperV1HelpContext } from "@/server/superv1/types";

function sampleHelpContext(): SuperV1HelpContext {
  return {
    question_id: "cp_what_does_company_do",
    question_text: "What does your company do?",
    help_menu_version: 2,
    last_help_options: [
      "I can explain what this question is really asking",
      "I can give 2-3 concrete example answers",
      "I can simplify and rephrase the question",
    ],
    last_selected_option: null,
    opened_at_turn_id: "turn-1",
  };
}

describe("superv1 help mode detector", () => {
  test("detects numeric selection in help mode", () => {
    const detected = detectHelpSelection({
      message: "2",
      helpContext: sampleHelpContext(),
    });

    expect(detected?.detected).toBe(true);
    expect(detected?.selection_type).toBe("numeric");
    expect(detected?.selected_option_index).toBe(1);
  });

  test("detects option phrase and chinese ordinal selection", () => {
    const byPhrase = detectHelpSelection({
      message: "option 2",
      helpContext: sampleHelpContext(),
    });
    const byZhOrdinal = detectHelpSelection({
      message: "第二个",
      helpContext: sampleHelpContext(),
    });

    expect(byPhrase?.detected).toBe(true);
    expect(byZhOrdinal?.detected).toBe(true);
    expect(byZhOrdinal?.selected_option_index).toBe(1);
  });

  test("detects near-match option label selection", () => {
    const detected = detectHelpSelection({
      message: "give concrete examples",
      helpContext: sampleHelpContext(),
    });

    expect(detected?.detected).toBe(true);
    expect(detected?.selection_type).toBe("near_match");
  });

  test("detects help action and explicit abandon phrases", () => {
    expect(detectHelpAction("can you explain more?")).toBe(true);
    expect(detectHelpAction("请解释一下")).toBe(true);
    expect(detectExplicitHelpAbandon("skip this question")).toBe(true);
    expect(detectExplicitHelpAbandon("先跳过")).toBe(true);
  });

  test("distinguishes plausible answer from other discussion", () => {
    expect(detectPlausibleAnswer("I think we mainly serve enterprise search teams.")).toBe(true);
    expect(detectPlausibleAnswer("I don't understand this question")).toBe(false);
    expect(detectPlausibleAnswer("有点不懂你这个问题的意思，什么叫我们公司成立初衷？")).toBe(false);
    expect(detectHelpAction("有点不懂你这个问题的意思，什么叫我们公司成立初衷？")).toBe(true);
    expect(detectLikelyOtherDiscussion("By the way, summarize what we have so far")).toBe(true);
    expect(detectLikelyOtherDiscussion("Thanks")).toBe(true);
  });
});
