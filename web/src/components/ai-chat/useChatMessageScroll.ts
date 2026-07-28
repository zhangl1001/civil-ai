import { nextTick, type Ref } from 'vue';

export function useChatMessageScroll(
  messageList: Ref<HTMLElement | null>,
  loadOlder: () => Promise<number>
) {
  let isPrepending = false;

  function scrollToLatest(): void {
    if (isPrepending) return;
    const list = messageList.value;
    if (list) requestAnimationFrame(() => requestAnimationFrame(() => list.scrollTo({ top: list.scrollHeight, behavior: 'auto' })));
  }

  async function loadOlderAtTop(): Promise<void> {
    const list = messageList.value;
    if (!list || list.scrollTop > 40 || isPrepending) return;
    const previousHeight = list.scrollHeight;
    const previousTop = list.scrollTop;
    isPrepending = true;
    try {
      if (!await loadOlder()) return;
      await nextTick();
      list.scrollTop = list.scrollHeight - previousHeight + previousTop;
    } finally {
      isPrepending = false;
    }
  }

  return { loadOlderAtTop, scrollToLatest };
}
