import { describe, expect, it, vi } from 'vitest';
import { AccessFacade } from './access.facade.js';
import { MemoryAccessStore } from './auth/infra/memory/memory-access.store.js';

describe('AccessFacade.getDisplayNames', () => {
  it('TF99: chỉ đọc id và tên hiển thị, không gọi findByIds (kéo cả hash mật khẩu); bỏ id sai dạng, trùng, không tồn tại', async () => {
    const store = new MemoryAccessStore();
    const user = await store.users.insert({ email: 'a@example.com', passwordHash: 'secret-hash', displayName: 'Tên A', role: 'member' });
    const findByIds = vi.spyOn(store.users, 'findByIds');
    const findNames = vi.spyOn(store.users, 'findDisplayNamesByIds');

    const names = await new AccessFacade(store).getDisplayNames([user!.id, user!.id, 'not-a-uuid', '00000000-0000-4000-8000-000000000000']);

    expect([...names]).toEqual([[user!.id, 'Tên A']]);
    expect(findNames).toHaveBeenCalledWith([user!.id, '00000000-0000-4000-8000-000000000000']);
    expect(await findNames.mock.results[0]!.value).toEqual([{ id: user!.id, displayName: 'Tên A' }]);
    expect(findByIds).not.toHaveBeenCalled();
  });
});
