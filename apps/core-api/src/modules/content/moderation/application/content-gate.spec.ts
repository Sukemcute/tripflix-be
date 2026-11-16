import { RulesContentGate } from './content-gate.js';

describe('TF91 luật giữ nhanh', () => {
  const gate = new RulesContentGate();
  it.each(['tao biết nhà mày ở đâu', 'chuyển khoản trước qua stk 0123456789 vcb nhé'])(
    'giữ lừa đảo/đe doạ: %s', (text) => expect(gate.precheck(text).shouldHold).toBe(true),
  );
  it.each(['tháng cho chắc', 'dù má có la', 'thằng chó', 'ib zalo chuyển khoản cọc giữ phòng', 'https://example.com'])(
    'để screening ngầm xét, chưa giữ nhanh: %s', (text) => expect(gate.precheck(text).shouldHold).toBe(false),
  );
});
