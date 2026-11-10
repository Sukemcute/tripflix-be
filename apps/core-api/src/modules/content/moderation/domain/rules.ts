export interface RuleHit {
  code: string;
  category: string;
  match: string;
  weight: number;
}
// Chạy trên chuỗi đã bỏ dấu, nên "óc chó" thành "oc cho". Chỉ nhận cụm đủ rõ nghĩa:
// không đưa từ đơn dễ trùng nghĩa vô hại khi bỏ dấu ("deo" = đeo, "ngu" = ngủ, "lon" = lon bia).
const PROFANITY_PATTERN = new RegExp(
  '\\b(?:' +
    [
      'do ngu',
      'con cho',
      'thang ngu',
      'thang cho',
      'ngu dot',
      'ngu nhu (?:bo|cho|lon|heo|trau|con)',
      '(?:may|mi) ngu',
      'oc cho',
      'dit me',
      'dit con me',
      'dit bo',
      'mat (?:nhu )?lon',
      'du ma',
      'dm|dmm|dcm|dkm|cmm|vcl|vkl|vcc|clgt',
    ].join('|') +
    ')\\b',
);
// Đe doạ trực tiếp một người. Câu chê gay gắt về giá/dịch vụ ("giá cắt cổ", "chém khách") không khớp.
const THREAT_PATTERN = new RegExp(
  '\\b(?:' +
    [
      'biet nha (?:may|mi|ma|em|con kia|thang kia) o dau',
      'cho (?:may|mi|ma|no|chung may|con kia|thang kia) biet tay',
      'tim ra (?:may|mi|ma)',
      '(?:danh|dap|chem|giet) (?:cho )?(?:(?:may|mi|no|con kia|thang kia) )?(?:nhap vien|bam dap|gay (?:tay|chan)|chet)',
      '(?:giet|chem|dap) (?:may|mi|chung may|ca nha may)',
    ].join('|') +
    ')\\b',
);

export function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Luật chỉ tạo tín hiệu; SĐT/link đơn lẻ không đủ để tự ẩn. */
export function evaluateRules(text: string, allowedDomains: string[] = []): RuleHit[] {
  const normalized = normalizeText(text);
  const hits: RuleHit[] = [];
  const words: Record<string, string> = {
    khong: '0',
    mot: '1',
    hai: '2',
    ba: '3',
    bon: '4',
    nam: '5',
    sau: '6',
    bay: '7',
    tam: '8',
    chin: '9',
  };
  const numeric = normalized.replace(
    /\b(?:khong|mot|hai|ba|bon|nam|sau|bay|tam|chin)(?:[ .-]+(?:khong|mot|hai|ba|bon|nam|sau|bay|tam|chin|\d)){5,}\b/g,
    (value) => value.replace(/\b[a-z]+\b/g, (word) => words[word] ?? word),
  );
  for (const match of numeric.matchAll(
    /(?<![\da-z])(?:\+?84|0)[ .-]*[35789](?:[ .-]*[\dol]){8}(?![\da-z])/g,
  )) {
    hits.push({ code: 'PHONE_VN', category: 'SPAM_OR_COMMERCIAL', match: match[0], weight: 30 });
  }
  const links = normalized.replace(/\s+cham\s+/g, '.').replace(/\s*\.\s*/g, '.');
  for (const match of links.matchAll(
    /(?:https?:\/\/|www\.)?\b[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.(?:com|vn|net|org|me|ly|io|co)(?:\.[a-z]{2})?(?:\/[^\s]*)?(?![a-z])/g,
  )) {
    const host = new URL(match[0].startsWith('http') ? match[0] : `https://${match[0]}`).hostname;
    if (
      !allowedDomains.some(
        (domain) => host === domain.toLowerCase() || host.endsWith(`.${domain.toLowerCase()}`),
      )
    ) {
      hits.push({ code: 'LINK', category: 'SPAM_OR_COMMERCIAL', match: match[0], weight: 30 });
    }
  }
  const bank =
    /\b(?:stk|so tai khoan|vcb|vietcombank|techcombank|mbbank|bidv|vietinbank)\b.{0,25}?(?<!\d)(?:\d[ .-]*){8,16}(?!\d)/.exec(
      normalized,
    );
  if (bank) hits.push({ code: 'BANK_ACCOUNT', category: 'SCAM', match: bank[0], weight: 45 });
  const invite =
    /\b(?:chuyen (?:khoan|tien|coc)|dat coc|coc truoc|ib zalo|inbox zalo|nhan dat tour|ket ban zalo|gia si)\b/.exec(
      normalized,
    );
  if (invite)
    hits.push({ code: 'CONTACT_INVITE', category: 'SPAM_OR_COMMERCIAL', match: invite[0], weight: 20 });
  if (bank && /\b(?:chuyen (?:khoan|tien|coc)|dat coc|coc truoc)\b/.test(normalized)) {
    hits.push({ code: 'SCAM_PATTERN', category: 'SCAM', match: bank[0], weight: 95 });
  }
  const profanity = PROFANITY_PATTERN.exec(normalized);
  if (profanity) hits.push({ code: 'PROFANITY', category: 'HARASSMENT', match: profanity[0], weight: 45 });
  const threat = THREAT_PATTERN.exec(normalized);
  if (threat) hits.push({ code: 'THREAT', category: 'VIOLENCE', match: threat[0], weight: 70 });
  return hits;
}
