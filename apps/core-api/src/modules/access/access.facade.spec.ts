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

describe('AccessFacade.getUserContacts', () => {
  it('trả tên, email, ngày đăng ký; bỏ id trùng, sai dạng và không tồn tại; không đọc hash mật khẩu', async () => {
    const store = new MemoryAccessStore();
    const user = await store.users.insert({ email: 'b@example.com', passwordHash: 'secret-hash', displayName: 'Tên B', role: 'member' });
    const findByIds = vi.spyOn(store.users, 'findByIds');
    const findContacts = vi.spyOn(store.users, 'findContactsByIds');

    const contacts = await new AccessFacade(store).getUserContacts([
      user!.id,
      user!.id,
      'not-a-uuid',
      '00000000-0000-4000-8000-000000000000',
    ]);

    expect([...contacts.keys()]).toEqual([user!.id]);
    expect(contacts.get(user!.id)).toEqual({ displayName: 'Tên B', email: 'b@example.com', createdAt: user!.createdAt });
    expect(findContacts).toHaveBeenCalledWith([user!.id, '00000000-0000-4000-8000-000000000000']);
    expect(findByIds).not.toHaveBeenCalled();
  });

  it('danh sách rỗng thì không gọi store', async () => {
    const store = new MemoryAccessStore();
    const findContacts = vi.spyOn(store.users, 'findContactsByIds');

    expect((await new AccessFacade(store).getUserContacts([])).size).toBe(0);
    expect(findContacts).not.toHaveBeenCalled();
  });

  it('quá 100 id thì từ chối', async () => {
    const store = new MemoryAccessStore();
    const ids = Array.from({ length: 101 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`);

    await expect(new AccessFacade(store).getUserContacts(ids)).rejects.toThrow(RangeError);
  });
});
