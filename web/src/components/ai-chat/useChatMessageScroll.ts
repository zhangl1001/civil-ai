import { nextTick, type Ref } from 'vue';

const FOLLOW_THRESHOLD_PX = 96;

export function useChatMessageScroll(
  messageList: Ref<HTMLElement | null>,
  loadOlder: () => Promise<number>
) {
  let isPrepending = false;
  let pinnedToLatest = true;

  function onMessagesScroll(): void {
    const list = messageList.value;
    if (list) pinnedToLatest = list.scrollHeight - list.scrollTop - list.clientHeight < FOLLOW_THRESHOLD_PX;
    void loadOlderAtTop();
  }

  /** Keeps a growing answer in view unless the reader scrolled up to read history. */
  function followLatest(): void {
    if (pinnedToLatest) scrollToLatest();
  }

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

  return { followLatest, onMessagesScroll, scrollToLatest };
}
