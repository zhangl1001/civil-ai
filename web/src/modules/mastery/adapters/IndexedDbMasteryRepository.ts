import type { IndexedDbTransactionScope } from '@/capabilities/database/adapters/indexeddb/IndexedDbUnitOfWork';
import { TutorIndexedDb, TutorIndexedDbStore } from '@/capabilities/database/adapters/indexeddb/TutorIndexedDb';
import type { TransactionContext } from '@/capabilities/database/public';
import type { CapabilityNodeId, ExamCycleId, InstantMs, ReviewQueueItemId } from '@/kernel/public';
import type { MasteryRepository, MasterySnapshot, MasteryTrack, ReviewQueueItem } from '../contracts/MasteryRepository';

interface StoredTrack extends MasteryTrack { readonly key: string; }

export class IndexedDbMasteryRepository implements MasteryRepository {
  constructor(private readonly database: TutorIndexedDb, private readonly scope: IndexedDbTransactionScope) {}

  async findTrack(examCycleId: ExamCycleId, capabilityNodeId: CapabilityNodeId): Promise<MasteryTrack | undefined> {
    const tracks = await this.database.getAll<StoredTrack>(TutorIndexedDbStore.MasteryTracks);
    return tracks.find((track) => track.examCycleId === examCycleId && track.capabilityNodeId === capabilityNodeId);
  }

  async upsertTrack(track: MasteryTrack, expectedVersion: number | undefined, context: TransactionContext): Promise<void> {
    const existing = await this.database.get<StoredTrack>(TutorIndexedDbStore.MasteryTracks, track.id);
    if (existing?.version !== expectedVersion) throw new Error(`Mastery track version conflict: ${track.id}`);
    this.scope.stage(context, { type: existing ? 'put' : 'add', store: TutorIndexedDbStore.MasteryTracks, value: { ...track, key: track.id } });
  }

  async appendSnapshot(snapshot: MasterySnapshot, context: TransactionContext): Promise<void> {
    this.scope.stage(context, { type: 'add', store: TutorIndexedDbStore.MasterySnapshots, value: snapshot });
  }

  async scheduleReview(item: ReviewQueueItem, context: TransactionContext): Promise<void> {
    const reviews = await this.database.getAll<ReviewQueueItem>(TutorIndexedDbStore.ReviewQueue);
    const exists = reviews.some((review) => review.examCycleId === item.examCycleId
      && review.capabilityNodeId === item.capabilityNodeId && review.reviewType === item.reviewType
      && (review.status === 'scheduled' || review.status === 'in_progress'));
    if (!exists) this.scope.stage(context, { type: 'add', store: TutorIndexedDbStore.ReviewQueue, value: item });
  }

  async findReview(reviewQueueItemId: ReviewQueueItemId): Promise<ReviewQueueItem | undefined> {
    return this.database.get<ReviewQueueItem>(TutorIndexedDbStore.ReviewQueue, reviewQueueItemId);
  }

  async replaceReview(item: ReviewQueueItem, expectedVersion: number, context: TransactionContext): Promise<void> {
    const existing = await this.database.get<ReviewQueueItem>(TutorIndexedDbStore.ReviewQueue, item.id);
    if (!existing || existing.version !== expectedVersion || item.version !== expectedVersion + 1) {
      throw new Error(`Review queue version conflict: ${item.id}`);
    }
    this.scope.stage(context, { type: 'put', store: TutorIndexedDbStore.ReviewQueue, value: item });
  }

  async listDueReviews(examCycleId: ExamCycleId, now: InstantMs, limit: number): Promise<readonly ReviewQueueItem[]> {
    assertLimit(limit, 'Review');
    const reviews = await this.database.getAll<ReviewQueueItem>(TutorIndexedDbStore.ReviewQueue);
    return reviews.filter((review) => review.examCycleId === examCycleId && review.status === 'scheduled' && review.dueAt <= now)
      .sort((left, right) => right.priority - left.priority || left.dueAt - right.dueAt).slice(0, limit);
  }

  async listPriorityTracks(examCycleId: ExamCycleId, limit: number): Promise<readonly MasteryTrack[]> {
    assertLimit(limit, 'Track');
    const rank: Record<MasteryTrack['state'], number> = { regressed: 0, learning: 1, practicing: 2, consolidating: 3, diagnosed: 4, unassessed: 5, mastered: 6, maintaining: 7 };
    const tracks = await this.database.getAll<StoredTrack>(TutorIndexedDbStore.MasteryTracks);
    return tracks.filter((track) => track.examCycleId === examCycleId)
      .sort((left, right) => rank[left.state] - rank[right.state] || left.stability - right.stability || left.confidence - right.confidence || left.updatedAt - right.updatedAt)
      .slice(0, limit);
  }
}

function assertLimit(limit: number, label: string): void {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RangeError(`${label} limit must be 1 to 100`);
}
