import { z } from "zod";
import { maintenanceActionSchema, claimTypeSchema } from "@lamplight/contracts";

export const rawProposalItemSchema = z.object({
  action: maintenanceActionSchema,
  content: z.string().min(1),
  claim_type: claimTypeSchema,
  reason: z.string().min(1),
  confidence: z.number().min(0).max(1),
  target_id: z.string().optional(),
  conflicts_with: z.array(z.string()).optional(),
  source_message_ids: z.array(z.string()).optional(),
  evidence_excerpt: z.string().optional(),
});

export type RawProposalItem = z.infer<typeof rawProposalItemSchema>;

const FIRST_PERSON_PATTERNS = [
  /(?<!自|忘|无|舍)我/,
  /\bI\b/i,
  /\bI'/i,
];

export function validateThirdPerson(content: string): {
  valid: boolean;
  matched?: string;
} {
  for (const pattern of FIRST_PERSON_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      return { valid: false, matched: match[0] };
    }
  }
  return { valid: true };
}

const SUBJECTIVE_COLLECTIVE_PATTERNS = [
  /大家都认为/,
  /大家都觉得/,
  /所有人都觉得/,
  /所有人都认为/,
  /真正担心的是/,
  /内心其实/,
  /其实是在/,
  /\beveryone thinks\b/i,
  /\bthey all feel\b/i,
  /\bwhat .+ really means\b/i,
];

export function validateDigestObjectivity(content: string): {
  valid: boolean;
  matched?: string;
} {
  const thirdPerson = validateThirdPerson(content);
  if (!thirdPerson.valid) return thirdPerson;

  for (const pattern of SUBJECTIVE_COLLECTIVE_PATTERNS) {
    const match = content.match(pattern);
    if (match) {
      return { valid: false, matched: match[0] };
    }
  }
  return { valid: true };
}

export function validateMaintenanceOutput(
  items: RawProposalItem[],
  taskType?: string,
): { accepted: RawProposalItem[]; rejected: Array<{ item: RawProposalItem; reason: string }> } {
  const accepted: RawProposalItem[] = [];
  const rejected: Array<{ item: RawProposalItem; reason: string }> = [];
  const validate = taskType === "digest" ? validateDigestObjectivity : validateThirdPerson;

  for (const item of items) {
    const check = validate(item.content);
    if (!check.valid) {
      rejected.push({
        item,
        reason: taskType === "digest"
          ? `Digest 主观内容被拒绝: "${check.matched}"`
          : `第一人称内容被拒绝: "${check.matched}"`,
      });
      continue;
    }
    accepted.push(item);
  }

  return { accepted, rejected };
}
