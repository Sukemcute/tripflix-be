// Bảng từ vựng (lexicon-rows.ts) nạp lên RAM một lần. Thêm cách viết mới = thêm dòng, không sửa code.
import { LEXICON_ROWS, type LexiconRow } from './lexicon-rows.js';

/** Một nghĩa của cụm: (loại, nhóm, trọng số). */
export type Hit = readonly [type: string, bucket: string, weight: number];

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export class Lexicon {
  /** emoji -> ' chữ ' (chỉ cho câu tìm). */
  readonly raw = new Map<string, string>();
  /** Viết tắt/teencode một từ -> dạng chuẩn. */
  readonly norm = new Map<string, string>();
  /** norm nhiều từ: 'ca phe' -> cafe. */
  readonly normPh = new Map<string, string>();
  readonly phrase = new Map<string, Hit[]>();
  /** `${type}|${bucket}` -> các cụm thành viên. */
  readonly members = new Map<string, string[]>();
  readonly stop = new Set<string>();
  /** cụm -> (tầm, bậc). */
  readonly tier = new Map<string, readonly [string, number]>();
  /** Tên riêng nhập tay: cụm -> nơi (hoặc null). */
  readonly names = new Map<string, string | null>();
  /** Nhóm bổ nghĩa (type mod): xử lý như concept nhưng không bắt buộc khớp. */
  readonly soft = new Set<string>();
  readonly maxn: number;
  readonly normRe: RegExp | null;
  /** Từ đơn của lexicon, cho sửa lỗi gõ. */
  readonly vocab: Set<string>;

  constructor(rows: readonly LexiconRow[]) {
    for (const [type, bucket, term, w] of rows) {
      if (type === 'raw') this.raw.set(term, ` ${bucket} `);
      else if (type === 'norm') (term.includes(' ') ? this.normPh : this.norm).set(term, bucket);
      else if (type === 'tier') this.tier.set(term, [bucket, Math.trunc(w)]);
      else if (type === 'name') this.names.set(term.split(/\s+/).filter(Boolean).join(' '), bucket || null);
      else if (type === 'stop') this.stop.add(term);
      else {
        let typ = type;
        if (typ === 'mod') {
          this.soft.add(bucket);
          typ = 'concept';
        }
        const hits = this.phrase.get(term) ?? [];
        hits.push([typ, bucket, w]);
        this.phrase.set(term, hits);
        const key = `${typ}|${bucket}`;
        this.members.set(key, [...(this.members.get(key) ?? []), term]);
      }
    }
    this.maxn = Math.max(1, ...[...this.phrase.keys()].map((t) => t.split(' ').length));
    this.normRe = this.normPh.size ? new RegExp(`\\b(${[...this.normPh.keys()].map(escapeRe).join('|')})\\b`, 'g') : null;
    this.vocab = new Set([...[...this.phrase.keys()].filter((t) => !t.includes(' ')), ...this.norm.keys()]);
  }

  membersOf(type: string, bucket: string): readonly string[] {
    return this.members.get(`${type}|${bucket}`) ?? [];
  }

  /** Cắt câu thành cụm dài nhất có trong lexicon. Trả [cụm, nghĩa hoặc null]. */
  segment(tokens: readonly string[]): Array<[string, Hit[] | null]> {
    const out: Array<[string, Hit[] | null]> = [];
    let i = 0;
    while (i < tokens.length) {
      let found = false;
      for (let n = Math.min(this.maxn, tokens.length - i); n > 0; n--) {
        const ph = tokens.slice(i, i + n).join(' ');
        const hits = this.phrase.get(ph);
        if (hits) {
          out.push([ph, hits]);
          i += n;
          found = true;
          break;
        }
      }
      if (!found) out.push([tokens[i++]!, null]);
    }
    return out;
  }
}

export const LEX = new Lexicon(LEXICON_ROWS);
