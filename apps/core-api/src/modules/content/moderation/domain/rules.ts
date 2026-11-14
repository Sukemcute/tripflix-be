export interface RuleHit {
  code: string;
  category: string;
  match: string;
  weight: number;
}
// Tìm ứng viên trên chuỗi đã bỏ dấu, nên "óc chó" thành "oc cho". Chỉ nhận cụm đủ rõ nghĩa:
// không đưa từ đơn dễ trùng nghĩa vô hại khi bỏ dấu ("deo" = đeo, "ngu" = ngủ, "lon" = lon bia).
// vcl/vkl/vcc/clgt cũng dùng để cảm thán; chỉ bắt công kích qua các cụm rõ nghĩa còn lại.
// Luật này tự ẩn (TF88), nên "con chó"/"óc chó" chỉ bắt khi nhắm vào người, không bắt
// con vật hay món ăn ("nhà có con chó", "hạt óc chó").
const PROFANITY_PATTERN = new RegExp(
  '\\b(?:' +
  [
    'do ngu',
    'thang ngu',
    '(?:may|mi) (?:la )?(?:con|thang|do) cho',
    'do (?:con|thang) cho',
    'thang cho',
    'ngu dot',
    'ngu nhu (?:bo|cho|lon|heo|trau|con)',
    '(?:may|mi) ngu',
    '(?<!(?:hat|sua|banh|qua|nhan|keo|dau) )oc cho',
    'dit me',
    'dit con me',
    'dit bo',
    'dit cu',
    'duma',
    'deo me',
    'mat (?:nhu )?lon',
    'du ma',
    'du me',
    'me kiep (?:may|mi|nha may)',
    'dm|dmm|dcm|dkm|cmm',
  ].join('|') +
  ')\\b',
);
// Dạng có dấu của từng cụm trên (TF93). Bỏ dấu làm câu bình thường trùng cụm chửi tục
// ("tháng cho" = "thằng chó", "dù mà" = "đụ má", "mất lớn" = "mặt lồn"), nên đoạn khớp mà
// người viết gõ có dấu phải khớp đúng dạng có dấu; đoạn gõ không dấu thì giữ cách so cũ.
const ACCENTED_PROFANITY_PATTERN = new RegExp(
  '^(?:' +
  [
    'đồ ngu',
    'thằng ngu',
    '(?:mày|mi) (?:là )?(?:con|thằng|đồ) chó',
    'đồ (?:con|thằng) chó',
    'thằng chó',
    'ngu dốt',
    'ngu như (?:bò|chó|lợn|heo|trâu|con)',
    '(?:mày|mi) ngu',
    'óc chó',
    'địt mẹ',
    'địt con mẹ',
    'địt bố',
    'địt cụ',
    'đéo mẹ',
    'mặt (?:như )?lồn',
    'đ[ụù] má',
    'đ[ụù] mẹ',
    'mẹ kiếp (?:mày|mi|nhà mày)',
    'đm|đmm|đcm|đkm|dm|dmm|dcm|dkm|cmm',
  ].join('|') +
  ')$',
);
// Nội dung chống phá nhà nước, ly khai, xuyên tạc chủ quyền. Chỉ bắt cụm kêu gọi hoặc
// xúc phạm rõ nghĩa; câu nhắc tới địa danh, lãnh tụ, lịch sử một cách bình thường không khớp.
const EXTREMISM_PATTERN = new RegExp(
  '\\b(?:' +
  [
    'lat do (?:chinh quyen|che do|dang|nha nuoc|chinh phu|cong san)',
    'da dao (?:dang|cong san|chinh quyen|che do|nha nuoc|chinh phu|viet cong)',
    'giai the dang cong san',
    '(?:ung ho|tham gia|gia nhap|theo) viet tan',
    'nha nuoc de ?ga',
    '(?:doi )?doc lap (?:tay nguyen|tay bac|nam bo)',
    '(?:hoang sa|truong sa)(?: va (?:hoang sa|truong sa))? (?:la cua|thuoc ve|thuoc) trung quoc',
    '(?:chinh quyen|che do|nha nuoc|dang) (?:cong san )?(?:an cuop|cuop ngay|doc tai|thoi nat|khon nan|chet tiet)',
    '(?:cong san|viet cong) (?:khon nan|chet tiet|mat day|ac on|sat nhan)',
    'ho tac',
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

function foldChar(char: string): string {
  const folded = char.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');
  return folded.length === 1 ? folded : char;
}

/** Tìm chửi tục mà vẫn xét dấu: chỉ số của bản bỏ dấu khớp từng ký tự với bản gốc. */
function findProfanity(text: string): string | null {
  const original = text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
  const folded = Array.from(original.split(''), foldChar).join('');
  for (const match of folded.matchAll(new RegExp(PROFANITY_PATTERN.source, 'g'))) {
    const typed = original.slice(match.index, match.index + match[0].length);
    if (typed === match[0] || ACCENTED_PROFANITY_PATTERN.test(typed)) return match[0];
  }
  return null;
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

/** Luật tạo tín hiệu; luật nào đủ để tự ẩn do severity.ts quyết định. */
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
  const profanity = findProfanity(text);
  if (profanity) hits.push({ code: 'PROFANITY', category: 'HARASSMENT', match: profanity, weight: 45 });
  const threat = THREAT_PATTERN.exec(normalized);
  if (threat) hits.push({ code: 'THREAT', category: 'VIOLENCE', match: threat[0], weight: 70 });
  const extremism = EXTREMISM_PATTERN.exec(normalized);
  if (extremism)
    hits.push({ code: 'EXTREMISM', category: 'EXTREMISM', match: extremism[0], weight: 80 });
  return hits;
}
