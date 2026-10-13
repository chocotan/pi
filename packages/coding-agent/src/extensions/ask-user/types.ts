// Adapted from rpiv-ask-user-question, Copyright (c) 2026 juicesharp (MIT).
// See docs/third-party/rpiv-ask-user-question-LICENSE.
import { type Static, Type } from "typebox";

export const MAX_QUESTIONS = 4;
export const MIN_OPTIONS = 2;
export const MAX_OPTIONS = 4;
export const RESERVED_LABELS = ["Other", "Type something.", "Next"] as const;
export const QuestionParamsSchema = Type.Object({
	questions: Type.Array(
		Type.Object({
			question: Type.String({ minLength: 1, maxLength: 8192 }),
			header: Type.String({ minLength: 1, maxLength: 16 }),
			options: Type.Array(
				Type.Object({
					label: Type.String({ minLength: 1, maxLength: 60 }),
					description: Type.String({ maxLength: 8192 }),
					preview: Type.Optional(Type.String({ maxLength: 65536 })),
				}),
				{ minItems: MIN_OPTIONS, maxItems: MAX_OPTIONS },
			),
			multiSelect: Type.Optional(Type.Boolean({ default: false })),
		}),
		{ minItems: 1, maxItems: MAX_QUESTIONS },
	),
});
export type QuestionParams = Static<typeof QuestionParamsSchema>;
export type QuestionData = QuestionParams["questions"][number];
export interface QuestionAnswer {
	questionIndex: number;
	question: string;
	kind: "option" | "custom" | "multi";
	answer: string | null;
	selected?: string[];
	preview?: string;
	notes?: string;
}
export type QuestionnaireError =
	| "no_ui"
	| "no_custom_ui"
	| "no_questions"
	| "empty_options"
	| "too_many_questions"
	| "duplicate_question"
	| "duplicate_option_label"
	| "reserved_label";
export interface QuestionnaireResult {
	answers: QuestionAnswer[];
	cancelled: boolean;
	globalNote?: string;
	unanswered?: number[];
	error?: QuestionnaireError;
}
