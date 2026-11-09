export interface RuleHit {
  code: string;
  category: string;
  match: string;
  weight: number;
}
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
  const profanity = /\b(?:do ngu|con cho|thang ngu|dit me|dm|dmm|vcl)\b/.exec(normalized);
  if (profanity) hits.push({ code: 'PROFANITY', category: 'HARASSMENT', match: profanity[0], weight: 45 });
  return hits;
}
