<template>
  <div class="wrong-page app-page">
    <PageHeader :level="1">
      <template #title>
        <div class="app-title-row">
          <span class="app-title-icon"><BookMarkedIcon /></span>
          <div class="app-title-copy">
            <h3>错题本</h3>
            <span>{{ store.openCount }} 道待巩固</span>
          </div>
        </div>
      </template>
      <template #actions>
        <button class="icon-button" type="button" @click="showFilterSheet = true"><FilterIcon /></button>
        <button class="icon-button" type="button" @click="openFlashcard"><LayersIcon /></button>
        <HeaderMoreMenu title="错题操作" subtitle="刷新、筛选和复习设置">
          <button class="menu-row" type="button" @click="store.fetch()">
            <RefreshCwIcon />
            <span>刷新错题</span>
          </button>
          <button class="menu-row" type="button" @click="toggleSelectAll">
            <CheckSquareIcon />
            <span>{{ allSelected ? '取消全选' : '全选当前' }}</span>
          </button>
          <button class="menu-row" type="button" :disabled="!selectedCount" @click="redoSelected">
            <RotateCcwIcon />
            <span>重做选中{{ selectedCount ? ` (${selectedCount})` : '' }}</span>
          </button>
          <button class="menu-row danger" type="button" :disabled="!selectedCount" @click="deleteSelected">
            <Trash2Icon />
            <span>删除选中{{ selectedCount ? ` (${selectedCount})` : '' }}</span>
          </button>
        </HeaderMoreMenu>
      </template>
    </PageHeader>

    <div v-if="store.isLoading" class="state-card app-empty-state">加载错题中...</div>
    <div v-else-if="store.error" class="state-card app-empty-state error">{{ store.error }}</div>
    <div v-else-if="!store.entries.length" class="state-card app-empty-state">
      <CheckCircleIcon />
      <strong>暂无错题</strong>
      <p>完成练习后，答错的题会自动进入这里。</p>
    </div>

    <div v-else class="wrong-list">
      <Card
        v-for="entry in store.entries"
        :key="entry.item.id"
        :class="['wrong-card', { open: isExpanded(entry.item.id) }]"
        @click="toggleExpanded(entry.item.id)"
      >
        <div class="wrong-summary">
          <label class="select-line" @click.stop>
            <input type="checkbox" :checked="selectedIds.has(entry.item.id)" @change="toggleSelected(entry.item.id)" />
            <span>{{ entry.item.module || entry.question?.module || '未分类' }}</span>
          </label>
          <button class="expand-button" type="button" @click.stop="toggleExpanded(entry.item.id)">
            <ChevronDownIcon />
          </button>
        </div>
        <div class="wrong-overview">
          <strong>{{ entry.item.reason || '未分类错因' }}</strong>
          <p>{{ questionSummary(entry) }}</p>
        </div>
        <div class="wrong-meta">
          <span>{{ entry.item.module || entry.question?.module || '未分类' }}</span>
          <span>{{ entry.item.reason || '未分类错因' }}</span>
          <span>错误 {{ entry.item.wrongCount }} 次</span>
          <span>{{ statusText(entry.item.status) }}</span>
          <span>{{ reviewDueText(entry.item.nextReviewAt) }}</span>
        </div>
        <div v-if="isExpanded(entry.item.id)" class="wrong-detail" @click.stop>
          <MarkdownContent class="wrong-stem" :content="entry.question?.stem || '题目内容暂不可用'" />
          <div v-if="entry.question?.options?.length" class="wrong-options">
            <div v-for="(option, index) in entry.question.options" :key="index">
              <b>{{ String.fromCharCode(65 + index) }}</b>
              <MarkdownContent class="wrong-option-text" :content="option" />
            </div>
          </div>
          <div class="wrong-answer">
            <strong>答案：{{ entry.question ? String.fromCharCode(65 + entry.question.answer) : '-' }}</strong>
            <MarkdownContent :content="entry.question?.explanation || '暂无解析'" />
          </div>
          <div class="wrong-controls">
            <label>
              <span>错因</span>
              <select :value="entry.item.reason || '未分类错因'" @change="handleReasonUpdate(entry.item.id, $event)">
                <option v-for="reason in reasonOptions" :key="reason" :value="reason">{{ reason }}</option>
              </select>
            </label>
            <label>
              <span>复习</span>
              <select @change="handleSchedule(entry.item.id, $event)">
                <option value="">安排下次复习</option>
                <option value="0">今天继续</option>
                <option value="1">明天复习</option>
                <option value="3">3 天后</option>
                <option value="7">7 天后</option>
              </select>
            </label>
          </div>
          <div class="wrong-actions">
            <button class="review-btn" type="button" @click="reviewQuestion(entry)">重新作答</button>
            <button class="ghost-btn" type="button" @click="store.updateStatus(entry.item.id, 'mastered')">已掌握</button>
          </div>
        </div>
      </Card>
    </div>

    <BottomSheet v-model="showFilterSheet" title="错题筛选" subtitle="筛选当前错题范围" variant="filter">
      <div class="wrong-filter-sheet">
        <label class="filter-card">
          <span>模块筛选</span>
          <select :value="store.selectedModule" @change="handleModuleChange">
            <option value="">所有模块</option>
            <option v-for="module in store.modules" :key="module" :value="module">{{ module }}</option>
          </select>
        </label>
        <label class="filter-card">
          <span>状态筛选</span>
          <select :value="store.selectedStatus" @change="handleStatusChange">
            <option value="">所有状态</option>
            <option value="open">待巩固</option>
            <option value="reviewing">复习中</option>
            <option value="mastered">已掌握</option>
          </select>
        </label>
        <label class="filter-card">
          <span>错因分类</span>
          <select :value="store.selectedReason" @change="handleReasonChange">
            <option value="">所有错因</option>
            <option v-for="reason in store.reasons" :key="reason" :value="reason">{{ reason }}</option>
          </select>
        </label>
        <label class="filter-card">
          <span>复习范围</span>
          <select :value="store.selectedScope" @change="handleScopeChange">
            <option value="all">全部错题</option>
            <option value="due">到期复习</option>
            <option value="highFrequency">高频错题</option>
          </select>
        </label>
        <label class="filter-card">
          <span>排序方式</span>
          <select :value="store.selectedSort" @change="handleSortChange">
            <option value="recent">最近更新</option>
            <option value="wrongCount">错误次数</option>
            <option value="due">复习到期</option>
          </select>
        </label>
      </div>
    </BottomSheet>

    <CenterDialog
      v-model="showFlashcardSheet"
      title="错题闪卡"
      :subtitle="flashcardEntry ? `${flashcardIndex + 1}/${store.entries.length}` : '暂无错题'"
      variant="content"
    >
      <div v-if="flashcardEntry" class="flashcard">
        <div class="flashcard-meta">
          <span>{{ flashcardEntry.item.module || flashcardEntry.question?.module || '未分类' }}</span>
          <span>{{ flashcardEntry.item.reason || '未分类错因' }}</span>
          <span>错误 {{ flashcardEntry.item.wrongCount }} 次</span>
          <span>{{ statusText(flashcardEntry.item.status) }}</span>
        </div>
        <button class="flashcard-summary" type="button" @click="flashcardDetailOpen = !flashcardDetailOpen">
          <strong>{{ flashcardEntry.item.reason || '未分类错因' }}</strong>
          <span>{{ questionSummary(flashcardEntry) }}</span>
          <ChevronDownIcon :class="{ open: flashcardDetailOpen }" />
        </button>
        <div v-if="flashcardDetailOpen" class="flashcard-detail">
          <MarkdownContent class="flashcard-stem" :content="flashcardEntry.question?.stem || '题目内容暂不可用'" />
          <div v-if="flashcardEntry.question?.options?.length" class="flashcard-options">
            <span v-for="(option, index) in flashcardEntry.question.options" :key="index">
              <b>{{ String.fromCharCode(65 + index) }}</b>
              <MarkdownContent class="flashcard-option-text" :content="option" />
            </span>
          </div>
          <button class="flashcard-toggle" type="button" @click="flashcardAnswerRevealed = !flashcardAnswerRevealed">
            {{ flashcardAnswerRevealed ? '收起答案和解析' : '查看答案和解析' }}
          </button>
          <div v-if="flashcardAnswerRevealed" class="flashcard-answer">
            <strong>答案：{{ flashcardEntry.question ? String.fromCharCode(65 + flashcardEntry.question.answer) : '-' }}</strong>
            <MarkdownContent class="flashcard-explanation" :content="flashcardEntry.question?.explanation || '暂无解析'" />
          </div>
        </div>
        <div class="flashcard-actions">
          <button type="button" :disabled="flashcardIndex === 0" @click="prevFlashcard">上一张</button>
          <button type="button" @click="reviewQuestion(flashcardEntry)">重做当前</button>
          <button type="button" :disabled="flashcardIndex >= store.entries.length - 1" @click="nextFlashcard">下一张</button>
        </div>
        <div class="flashcard-status-actions">
          <button type="button" @click="updateFlashcardStatus('reviewing')">标为复习中</button>
          <button type="button" @click="updateFlashcardStatus('mastered')">已掌握</button>
        </div>
        <div class="flashcard-review-actions">
          <button type="button" @click="scheduleFlashcard(0)">今天继续</button>
          <button type="button" @click="scheduleFlashcard(1)">明天</button>
          <button type="button" @click="scheduleFlashcard(3)">3 天后</button>
          <button type="button" @click="scheduleFlashcard(7)">7 天后</button>
        </div>
      </div>
      <div v-else class="sheet-empty">暂无错题闪卡</div>
    </CenterDialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import {
  BookMarkedIcon,
  CheckCircleIcon,
  CheckSquareIcon,
  ChevronDownIcon,
  FilterIcon,
  LayersIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  Trash2Icon
} from 'lucide-vue-next';
import Card from '@/components/Card.vue';
import PageHeader from '@/components/layout/PageHeader.vue';
import HeaderMoreMenu from '@/components/layout/HeaderMoreMenu.vue';
import BottomSheet from '@/components/layout/BottomSheet.vue';
import CenterDialog from '@/components/layout/CenterDialog.vue';
import MarkdownContent from '@/components/MarkdownContent.vue';
import type { WrongBookEntry } from '@/services/WrongBookRepository';
import type { WrongStatus } from '@/domain/wrongbook';
import { practiceFlowService } from '@/services/PracticeFlowService';
import { useTasksStore } from '@/stores/tasks';
import { useWrongBookStore } from '@/stores/wrongBook';

const router = useRouter();
const tasksStore = useTasksStore();
const store = useWrongBookStore();
const showFilterSheet = ref(false);
const showFlashcardSheet = ref(false);
const flashcardIndex = ref(0);
const flashcardDetailOpen = ref(false);
const flashcardAnswerRevealed = ref(false);
const selectedIds = reactive(new Set<string>());
const expandedIds = reactive(new Set<string>());
const selectedCount = computed(() => selectedIds.size);
const allSelected = computed(() => store.entries.length > 0 && store.entries.every((entry) => selectedIds.has(entry.item.id)));
const flashcardEntry = computed(() => store.entries[flashcardIndex.value]);
const reasonOptions = ['练习答错', '审题错误', '知识点不熟', '计算失误', '方法选择错误', '时间不足', '粗心漏看', '未分类错因'];

onMounted(() => {
  void store.fetch();
});

const reviewQuestion = async (entry: WrongBookEntry) => {
  await store.startReview(entry.item.id);
  await practiceFlowService.enqueueGeneration({
    module: entry.item.module || entry.question?.module || '资料分析',
    mode: 'review',
    date: new Date().toISOString().slice(0, 10),
    source: 'practice-center',
    questionCount: 10
  });
  await tasksStore.refresh();
  router.push('/vue/practice/session');
};

function handleModuleChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  showFilterSheet.value = false;
  selectedIds.clear();
  void store.setModule(target.value);
}

function handleStatusChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  showFilterSheet.value = false;
  selectedIds.clear();
  void store.setStatus(target.value);
}

function handleReasonChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  showFilterSheet.value = false;
  selectedIds.clear();
  void store.setReason(target.value);
}

function handleScopeChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  showFilterSheet.value = false;
  selectedIds.clear();
  void store.setScope(target.value as 'all' | 'due' | 'highFrequency');
}

function handleSortChange(event: Event) {
  const target = event.target as HTMLSelectElement;
  showFilterSheet.value = false;
  selectedIds.clear();
  void store.setSort(target.value as 'recent' | 'wrongCount' | 'due');
}

function toggleSelected(itemId: string) {
  if (selectedIds.has(itemId)) selectedIds.delete(itemId);
  else selectedIds.add(itemId);
}

function toggleSelectAll() {
  if (allSelected.value) {
    selectedIds.clear();
    return;
  }
  store.entries.forEach((entry) => selectedIds.add(entry.item.id));
}

async function redoSelected() {
  const first = store.entries.find((entry) => selectedIds.has(entry.item.id));
  if (!first) return;
  await reviewQuestion(first);
}

async function deleteSelected() {
  if (!selectedIds.size) return;
  await store.deleteMany([...selectedIds]);
  selectedIds.clear();
}

function openFlashcard() {
  flashcardIndex.value = 0;
  flashcardDetailOpen.value = false;
  flashcardAnswerRevealed.value = false;
  showFlashcardSheet.value = true;
}

function prevFlashcard() {
  flashcardIndex.value = Math.max(0, flashcardIndex.value - 1);
  flashcardDetailOpen.value = false;
  flashcardAnswerRevealed.value = false;
}

function nextFlashcard() {
  flashcardIndex.value = Math.min(store.entries.length - 1, flashcardIndex.value + 1);
  flashcardDetailOpen.value = false;
  flashcardAnswerRevealed.value = false;
}

async function updateFlashcardStatus(status: WrongStatus) {
  const entry = flashcardEntry.value;
  if (!entry) return;
  await store.updateStatus(entry.item.id, status);
  if (!store.entries.length) {
    showFlashcardSheet.value = false;
    return;
  }
  flashcardIndex.value = Math.min(flashcardIndex.value, store.entries.length - 1);
  flashcardDetailOpen.value = false;
  flashcardAnswerRevealed.value = false;
}

async function handleReasonUpdate(itemId: string, event: Event) {
  const target = event.target as HTMLSelectElement;
  await store.updateReason(itemId, target.value);
}

async function handleSchedule(itemId: string, event: Event) {
  const target = event.target as HTMLSelectElement;
  if (target.value === '') return;
  await store.scheduleReview(itemId, Number(target.value));
  target.value = '';
}

async function scheduleFlashcard(delayDays: number) {
  const entry = flashcardEntry.value;
  if (!entry) return;
  await store.scheduleReview(entry.item.id, delayDays);
  flashcardIndex.value = Math.min(flashcardIndex.value, Math.max(0, store.entries.length - 1));
  flashcardDetailOpen.value = false;
  flashcardAnswerRevealed.value = false;
}

function isExpanded(itemId: string): boolean {
  return expandedIds.has(itemId);
}

function toggleExpanded(itemId: string) {
  if (expandedIds.has(itemId)) {
    expandedIds.delete(itemId);
    return;
  }
  expandedIds.add(itemId);
}

function questionSummary(entry: WrongBookEntry): string {
  const question = entry.question;
  const source = question?.knowledgePoint || question?.stem || question?.material || '';
  const text = source
    .replace(/<svg[\s\S]*?<\/svg>/gi, '图形题')
    .replace(/<[^>]+>/g, '')
    .replace(/!\[[^\]]*]\([^)]+\)/g, '图片')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? (text.length > 48 ? `${text.slice(0, 48)}...` : text) : '题目内容暂不可用';
}

function reviewDueText(nextReviewAt?: number): string {
  if (!nextReviewAt) return '随时复习';
  const diffDays = Math.ceil((nextReviewAt - Date.now()) / 86400000);
  if (diffDays <= 0) return '已到期';
  if (diffDays === 1) return '明天复习';
  return `${diffDays} 天后复习`;
}

function statusText(status: WrongStatus): string {
  const map: Record<WrongStatus, string> = {
    open: '待巩固',
    reviewing: '复习中',
    mastered: '已掌握'
  };
  return map[status];
}
</script>

<style scoped>
.wrong-filter-sheet {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.wrong-filter-sheet label {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.wrong-filter-sheet label span {
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.wrong-filter-sheet select {
  width: 100%;
  height: 42px;
  padding: 0 12px;
  border-radius: 12px;
  border: 1px solid rgba(var(--color-ink-rgb), .08);
  background: rgba(255, 255, 255, .82);
  color: var(--text-color);
  font-family: inherit;
  font-weight: var(--type-weight-semibold);
}
.wrong-card {
  cursor: pointer;
}
.wrong-card.open {
  background: rgba(255, 255, 255, .72);
}
.wrong-summary {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}
.select-line {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.select-line input {
  width: 16px;
  height: 16px;
  accent-color: var(--primary-color);
}
.wrong-list { display: flex; flex-direction: column; gap: 12px; padding: 0 var(--page-x) 20px; }
.expand-button {
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .05);
  color: var(--text-secondary-color);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.expand-button svg {
  width: 16px;
  height: 16px;
  transition: transform .18s ease;
}
.wrong-card.open .expand-button svg {
  transform: rotate(180deg);
}
.wrong-overview {
  display: flex;
  flex-direction: column;
  gap: 5px;
}
.wrong-overview strong {
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
}
.wrong-overview p {
  margin: 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  line-height: 1.55;
}
.wrong-detail {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(var(--color-ink-rgb), .06);
}
.wrong-stem {
  margin: 0;
  font-size: var(--type-size-body);
  font-weight: var(--type-weight-semibold);
  line-height: 1.6;
}
.wrong-stem :deep(p),
.wrong-option-text :deep(p),
.flashcard-stem :deep(p),
.flashcard-option-text :deep(p),
.flashcard-explanation :deep(p) {
  margin: 0;
}
.wrong-stem :deep(svg),
.wrong-stem :deep(img),
.wrong-option-text :deep(svg),
.wrong-option-text :deep(img),
.flashcard-stem :deep(svg),
.flashcard-stem :deep(img) {
  display: block;
  width: 100%;
  max-width: 360px;
  max-height: 180px;
  margin: 8px auto;
  object-fit: contain;
}
.wrong-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 10px;
}
.wrong-options > div {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 9px 10px;
  border-radius: 12px;
  background: rgba(245, 246, 250, .66);
}
.wrong-options b {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(var(--color-brand-rgb), .09);
  color: var(--primary-color);
  font-size: var(--type-size-caption);
}
.wrong-option-text {
  min-width: 0;
  flex: 1;
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}
.wrong-option-text :deep(svg),
.wrong-option-text :deep(img) {
  max-width: 120px;
  max-height: 90px;
  margin: 0;
}
.wrong-answer {
  margin-top: 10px;
  padding: 11px;
  border-radius: 13px;
  background: rgba(52, 168, 83, .08);
}
.wrong-answer strong {
  color: var(--green-color);
  font-size: var(--type-size-secondary);
}
.wrong-answer :deep(.markdown-content) {
  margin-top: 6px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.65;
}
.wrong-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 10px 0;
}
.wrong-meta span {
  padding: 3px 8px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.wrong-controls {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin: 10px 0 9px;
}
.wrong-controls label {
  min-width: 0;
}
.wrong-controls label span {
  display: block;
  margin-bottom: 5px;
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.wrong-controls select {
  width: 100%;
  height: 34px;
  padding: 0 9px;
  border-radius: 10px;
  border: 1px solid rgba(var(--color-ink-rgb), .07);
  background: rgba(255, 255, 255, .72);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.wrong-actions {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 92px;
  gap: 8px;
}
.review-btn {
  width: 100%;
  height: 36px;
  border: none;
  border-radius: 11px;
  background-color: var(--primary-color);
  color: white;
  font-weight: var(--type-weight-semibold);
}
.ghost-btn {
  height: 36px;
  border: none;
  border-radius: 11px;
  background: rgba(52, 168, 83, .1);
  color: var(--green-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.state-card {
  min-height: 360px;
}
.state-card p {
  margin: 0;
}
.state-card.error { color: var(--red-color); }
.flashcard {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.flashcard-summary {
  width: 100%;
  border: none;
  border-radius: 15px;
  padding: 12px;
  background: rgba(245, 246, 250, .72);
  color: var(--text-color);
  display: grid;
  grid-template-columns: minmax(0, 1fr) 22px;
  gap: 5px 8px;
  text-align: left;
  font-family: inherit;
}
.flashcard-summary strong {
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
}
.flashcard-summary span {
  grid-column: 1 / 2;
  color: var(--text-secondary-color);
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
  line-height: 1.55;
}
.flashcard-summary svg {
  grid-column: 2;
  grid-row: 1 / 3;
  align-self: center;
  width: 18px;
  height: 18px;
  color: var(--text-secondary-color);
  transition: transform .18s ease;
}
.flashcard-summary svg.open {
  transform: rotate(180deg);
}
.flashcard-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.flashcard-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.flashcard-meta span {
  padding: 4px 9px;
  border-radius: 999px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-secondary-color);
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
.flashcard-stem {
  margin: 0;
  color: var(--text-color);
  font-size: var(--type-size-body-large);
  font-weight: var(--type-weight-semibold);
  line-height: 1.7;
}
.flashcard-options {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.flashcard-options span {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 11px;
  border-radius: 12px;
  background: rgba(245, 246, 250, .78);
  color: var(--text-color);
  font-size: var(--type-size-secondary);
  line-height: 1.55;
}
.flashcard-option-text {
  min-width: 0;
  flex: 1;
}
.flashcard-option-text :deep(svg),
.flashcard-option-text :deep(img) {
  display: block;
  width: 100%;
  max-width: 120px;
  max-height: 90px;
  margin: 0;
  object-fit: contain;
}
.flashcard-options b {
  width: 22px;
  height: 22px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
  font-size: var(--type-size-caption);
}
.flashcard-toggle {
  height: 38px;
  border: none;
  border-radius: 12px;
  background: rgba(var(--color-brand-rgb), .1);
  color: var(--primary-color);
  font-family: inherit;
  font-size: var(--type-size-secondary);
  font-weight: var(--type-weight-semibold);
}
.flashcard-answer {
  padding: 12px;
  border-radius: 13px;
  background: rgba(52, 168, 83, .09);
  color: var(--text-color);
}
.flashcard-answer strong {
  color: var(--green-color);
  font-size: var(--type-size-secondary);
}
.flashcard-explanation {
  margin: 7px 0 0;
  color: var(--text-secondary-color);
  font-size: var(--type-size-secondary);
  line-height: 1.65;
}
.flashcard-actions {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.flashcard-actions button,
.flashcard-status-actions button {
  height: 38px;
  border: none;
  border-radius: 12px;
  background: rgba(var(--color-ink-rgb), .06);
  color: var(--text-color);
  font-family: inherit;
  font-size: var(--type-size-caption);
  font-weight: var(--type-weight-semibold);
}
.flashcard-actions button:nth-child(2) {
  color: #fff;
  background: var(--primary-color);
}
.flashcard-actions button:disabled {
  opacity: .42;
}
.flashcard-status-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.flashcard-status-actions button:first-child {
  color: #ef6c00;
  background: rgba(239, 108, 0, .1);
}
.flashcard-status-actions button:last-child {
  color: var(--green-color);
  background: rgba(52, 168, 83, .11);
}
.flashcard-review-actions {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 7px;
}
.flashcard-review-actions button {
  height: 34px;
  border: none;
  border-radius: 11px;
  background: rgba(var(--color-ink-rgb), .055);
  color: var(--text-secondary-color);
  font-family: inherit;
  font-size: var(--type-size-micro);
  font-weight: var(--type-weight-semibold);
}
@media (max-width: 360px) {
  .wrong-controls,
  .wrong-actions {
    grid-template-columns: 1fr;
  }
  .flashcard-review-actions {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
