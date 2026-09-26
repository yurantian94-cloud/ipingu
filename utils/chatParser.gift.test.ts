import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatParser } from './chatParser';
import { DB } from './db';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.removeItem('os_api_config');
});

describe('GIVE_GIFT', () => {
  it('送礼时生成独立藏品预览，但不写入纪念馆', async () => {
    // 未配置统一生图 API 时，送礼会保留待处理状态，但不会伪造预览图。
    localStorage.setItem('os_api_config', JSON.stringify({ imageApi: { enabled: false } }));
    const saveMessage = vi.spyOn(DB, 'saveMessage').mockResolvedValue(1 as any);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const result = await ChatParser.parseAndExecuteActions(
      '这是给你的。\n[[GIVE_GIFT: {"title":"星空水晶兔","collection_description":"a translucent crystal rabbit under starlight, no person, no text","message":"我们的第一份纪念。"}]]',
      `gift-${Date.now()}`,
      '测试角色',
      () => {},
    );

    const giftSave = saveMessage.mock.calls.map(call => call[0]).find(message => message.metadata?.starlightGift);
    expect(result).toBe('这是给你的。');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(giftSave?.metadata).toMatchObject({
      status: 'pending',
      collectionDescription: 'a translucent crystal rabbit under starlight, no person, no text',
      coreItem: 'a translucent crystal rabbit under starlight, no person, no text',
      previewImageRef: '',
      previewError: '礼物预览生成失败，请稍后重新让角色送一次。',
    });
  });
});
