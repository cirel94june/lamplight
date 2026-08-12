const FIRST_PERSON_PATTERNS = [
  /我[^\s,，。！？、：；"""''（）\[\]]{0,1}[觉认感想发注意希望需要喜欢讨厌害怕担心相信怀疑猜测推断建议觉得认为感到认识了解知道看到听到经历记得忘记明白理解爱恨难过高兴开心伤心生气着急紧张期待盼望决定打算准备尝试努力坚持选择同意反对支持赞成拒绝接受承认否认怀念渴望]/,
  /我的(?:感受|看法|观点|意见|判断|理解|印象|猜测|建议|想法)/,
  /\bI\s+(?:think|feel|believe|find|notice|want|need|like|love|hate|hope|wish|know|see|am|was|have|had|do|did|would|could|should|might|must|can)\b/i,
  /\bIn my (?:opinion|view|experience)\b/i,
  /\bI'm\b/i,
  /\bI've\b/i,
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
