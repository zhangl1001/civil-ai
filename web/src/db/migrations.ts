import { database } from './database';

export async function initLocalDatabase(): Promise<void> {
  await database.init();
}
