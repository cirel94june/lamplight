const FIRST_PERSON_PATTERNS = [
  /(?<!自|忘|无|舍)我(?!们)/,
  /\bI\b/,
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

export interface RawProposalItem {
  action: string;
  content: string;
  claim_type: string;
  reason: string;
  confidence: number;
  target_id?: string;
  conflicts_with?: string[];
  source_message_ids?: string[];
  evidence_excerpt?: string;
}

export function validateMaintenanceOutput(
  items: RawProposalItem[],
): { accepted: RawProposalItem[]; rejected: Array<{ item: RawProposalItem; reason: string }> } {
  const accepted: RawProposalItem[] = [];
  const rejected: Array<{ item: RawProposalItem; reason: string }> = [];

  for (const item of items) {
    const check = validateThirdPerson(item.content);
    if (!check.valid) {
      rejected.push({
        item,
        reason: `第一人称内容被拒绝: "${check.matched}"`,
      });
      continue;
    }
    accepted.push(item);
  }

  return { accepted, rejected };
}
