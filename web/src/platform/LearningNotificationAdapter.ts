import { capacitorRuntime } from './capacitor';

export interface LearningReminderSettings {
  enabled: boolean;
  morningTime: string;
  eveningTime: string;
}

export interface LearningNotificationStatus {
  native: boolean;
  authorization: string;
  pending: number;
}

const SETTINGS_KEY = 'learning-reminder-settings';
const DEFAULT_SETTINGS: LearningReminderSettings = {
  enabled: false,
  morningTime: '08:30',
  eveningTime: '21:30'
};

function plugin() {
  return capacitorRuntime()?.Plugins?.LearningNotifications;
}

function nextDateForTime(time: string, dayOffset = 0): Date {
  const [hourRaw, minuteRaw] = time.split(':');
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(Number(hourRaw) || 0, Number(minuteRaw) || 0, 0, 0);
  if (dayOffset === 0 && date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function readSettings(): LearningReminderSettings {
  if (typeof localStorage === 'undefined') return DEFAULT_SETTINGS;
  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function writeSettings(settings: LearningReminderSettings): void {
  if (typeof localStorage === 'undefined') return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export class LearningNotificationAdapter {
  isNative(): boolean {
    return Boolean(plugin());
  }

  loadSettings(): LearningReminderSettings {
    return readSettings();
  }

  async status(): Promise<LearningNotificationStatus> {
    const native = plugin();
    if (!native) {
      return { native: false, authorization: 'web-fallback', pending: 0 };
    }
    return native.getStatus();
  }

  async save(settings: LearningReminderSettings): Promise<LearningNotificationStatus> {
    writeSettings(settings);
    const native = plugin();
    if (!native) {
      return { native: false, authorization: 'web-fallback', pending: 0 };
    }

    if (!settings.enabled) {
      await native.clearAll();
      return native.getStatus();
    }

    const permission = await native.requestPermission();
    if (!permission.granted) {
      return native.getStatus();
    }

    const items = Array.from({ length: 7 }).flatMap((_, index) => {
      const date = nextDateForTime(settings.morningTime, index);
      const reviewDate = nextDateForTime(settings.eveningTime, index);
      return [
        {
          id: `learning-morning-${index}`,
          title: '今日学习计划',
          body: '打开公考辅导，先完成今日任务和专项练习。',
          at: date.toISOString(),
          route: '/vue/plan'
        },
        {
          id: `learning-evening-${index}`,
          title: '错题与积累复盘',
          body: '复习错题，整理每日积累，保持训练节奏。',
          at: reviewDate.toISOString(),
          route: '/vue/wrongbook'
        }
      ];
    });

    await native.schedule({ items });
    return native.getStatus();
  }

  async clear(): Promise<LearningNotificationStatus> {
    writeSettings({ ...readSettings(), enabled: false });
    const native = plugin();
    if (!native) return { native: false, authorization: 'web-fallback', pending: 0 };
    await native.clearAll();
    return native.getStatus();
  }
}

export const learningNotificationAdapter = new LearningNotificationAdapter();
