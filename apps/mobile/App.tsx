import { requireOptionalNativeModule } from "expo";
import type {
  ExpoSpeechRecognitionErrorEvent,
  ExpoSpeechRecognitionNativeEventMap,
  ExpoSpeechRecognitionOptions,
  ExpoSpeechRecognitionResultEvent,
} from "expo-speech-recognition";
import { StatusBar } from "expo-status-bar";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { GestureHandlerRootView, Swipeable } from "react-native-gesture-handler";

type PrimaryTab = "inbox" | "assistant" | "today" | "plan";
type SecondaryTab = "list" | "settings";
type Tab = PrimaryTab | SecondaryTab;
type Category = "work" | "shopping" | "relationships" | "life" | "travel" | "triage";
type CertaintyTier = "confirmed" | "direct" | "suggestion";
type VoiceComposerTarget = "capture" | "ask";
type VoiceInputTarget = "query" | "composer";
type AssistantMessageTone = "default" | "memory" | "plan" | "status";
type ComposerCategoryChoice = "list" | Category;
type ComposerPriority = "normal" | "important" | "urgent";
type ComposerReminder = "off" | "tonight" | "tomorrowMorning";

type CaptureRecord = {
  id: string;
  transcript: string;
  createdAt: string;
};

type TodoItem = {
  id: string;
  title: string;
  category: Category;
  certainty: CertaintyTier;
  dueDateKey?: string;
  sourceCaptureId: string;
  sourceSnippet: string;
  reasoning: string;
  createdAt: string;
};

type AssistantTaskEntry = {
  category: Category;
  title: string;
  sourceSnippet: string;
  timeLabel?: string;
  priorityLabel?: string;
  reminderLabel?: string;
};

type AssistantMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  tone: AssistantMessageTone;
  taskListTitle?: string;
  tasks?: AssistantTaskEntry[];
};

type AssistantIntent = "create_tasks" | "search_tasks" | "plan" | "prioritize" | "chat";

type AssistantApiTask = {
  title?: string;
  reasoning?: string;
  category?: string;
  confidenceScore?: number;
  dueDateISO8601?: string | null;
  timeHint?: string;
  priorityHint?: string;
  reminderDateISO8601?: string | null;
  reminderHint?: string;
  sourceSnippet?: string;
};

type AssistantApiResponse = {
  reply?: string;
  intent?: AssistantIntent;
  tasks?: AssistantApiTask[];
  error?: string;
  detail?: string;
};

type VoiceComposerState =
  | "idle"
  | "listening"
  | "processing"
  | "error";

type SpeechRecognitionModule = {
  addListener<K extends keyof ExpoSpeechRecognitionNativeEventMap>(
    eventName: K,
    listener: (event: ExpoSpeechRecognitionNativeEventMap[K]) => void,
  ): {
    remove: () => void;
  };
  start: (options: ExpoSpeechRecognitionOptions) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  requestMicrophonePermissionsAsync: () => Promise<{ granted: boolean; canAskAgain: boolean }>;
  supportsOnDeviceRecognition: () => boolean;
  isRecognitionAvailable: () => boolean;
};

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";
const speechRecognitionModule =
  requireOptionalNativeModule<SpeechRecognitionModule>("ExpoSpeechRecognition");

const palette = {
  appBg: "#D8CEBE",
  ink: "#3A2B21",
  inkMuted: "#725F50",
  inkSoft: "#92806F",
  inputBg: "#E0D7C8",
  panelWork: "#B39670",
  panelShopping: "#C7BCAB",
  panelRelationships: "#DDD6CB",
  panelTriage: "#E8DED2",
  panelLife: "#747758",
  panelLifeInk: "#ECE6DA",
  panelTravel: "#8A8765",
  panelTravelInk: "#F0EBD9",
  rowBgLight: "rgba(245, 241, 233, 0.9)",
  rowBgDark: "rgba(231, 224, 210, 0.22)",
  navBg: "rgba(222, 214, 200, 0.95)",
  border: "rgba(53, 47, 39, 0.14)",
  accent: "#C44A00",
  accentPressed: "#A83F00",
} as const;

const seedCaptures: CaptureRecord[] = [
  {
    id: "capture-1",
    transcript: "最近吃蔬菜很少，番茄也没了。",
    createdAt: "2026-03-10T09:10:00.000Z",
  },
  {
    id: "capture-2",
    transcript: "女朋友下个月生日了，要记得提前准备。",
    createdAt: "2026-03-10T11:20:00.000Z",
  },
];

const seedItems: TodoItem[] = [
  {
    id: "item-1",
    title: "买番茄",
    category: "shopping",
    certainty: "direct",
    dueDateKey: "2026-03-11",
    sourceCaptureId: "capture-1",
    sourceSnippet: "番茄也没了",
    reasoning: "从原话直接提炼出的补货事项。",
    createdAt: "2026-03-10T09:11:00.000Z",
  },
  {
    id: "item-2",
    title: "买蔬菜",
    category: "shopping",
    certainty: "suggestion",
    dueDateKey: "2026-03-11",
    sourceCaptureId: "capture-1",
    sourceSnippet: "最近吃蔬菜很少",
    reasoning: "根据饮食习惯做出的弱建议。",
    createdAt: "2026-03-10T09:11:30.000Z",
  },
  {
    id: "item-3",
    title: "购物 买生日礼物",
    category: "relationships",
    certainty: "direct",
    dueDateKey: "2026-03-15",
    sourceCaptureId: "capture-2",
    sourceSnippet: "女朋友下个月生日了",
    reasoning: "生日相关事项，需要提前准备。",
    createdAt: "2026-03-10T11:21:00.000Z",
  },
];

const CAPTURES_STORAGE_KEY = "plusdo.captures.v1";
const ITEMS_STORAGE_KEY = "plusdo.items.v1";

const clusterOrder: Array<{
  key: Category;
  title: string;
  panelColor: string;
  inkColor: string;
  mutedInkColor: string;
  rowColor: string;
  rowInkColor: string;
}> = [
  {
    key: "shopping",
    title: "购物",
    panelColor: palette.panelWork,
    inkColor: palette.ink,
    mutedInkColor: "rgba(47,45,41,0.76)",
    rowColor: palette.rowBgLight,
    rowInkColor: palette.ink,
  },
  {
    key: "work",
    title: "工作",
    panelColor: palette.panelShopping,
    inkColor: palette.ink,
    mutedInkColor: "rgba(47,45,41,0.72)",
    rowColor: palette.rowBgLight,
    rowInkColor: palette.ink,
  },
  {
    key: "relationships",
    title: "关系",
    panelColor: palette.panelRelationships,
    inkColor: palette.ink,
    mutedInkColor: "rgba(47,45,41,0.66)",
    rowColor: "rgba(247,243,236,0.95)",
    rowInkColor: palette.ink,
  },
  {
    key: "life",
    title: "生活",
    panelColor: palette.panelLife,
    inkColor: palette.panelLifeInk,
    mutedInkColor: "rgba(236,230,218,0.82)",
    rowColor: palette.rowBgDark,
    rowInkColor: palette.panelLifeInk,
  },
  {
    key: "travel",
    title: "旅行",
    panelColor: palette.panelTravel,
    inkColor: palette.panelTravelInk,
    mutedInkColor: "rgba(240,235,217,0.84)",
    rowColor: palette.rowBgDark,
    rowInkColor: palette.panelTravelInk,
  },
  {
    key: "triage",
    title: "待整理",
    panelColor: palette.panelTriage,
    inkColor: palette.ink,
    mutedInkColor: "rgba(47,45,41,0.62)",
    rowColor: palette.rowBgLight,
    rowInkColor: palette.ink,
  },
];

const tabLabel: Record<Tab, string> = {
  inbox: "首页",
  assistant: "助理",
  list: "所有",
  today: "今天",
  plan: "日历",
  settings: "设置",
};

const navTabs: Tab[] = ["inbox", "assistant", "today", "plan", "list", "settings"];
const listScreenDescription = "这里保留你的原话，以及 AI 从原话里整理出的事项，方便回溯。";

const calendarWeekdayLabels = ["一", "二", "三", "四", "五", "六", "日"] as const;
const fullWeekdayLabels = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"] as const;

function isCaptureRecord(value: unknown): value is CaptureRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<CaptureRecord>;
  return (
    typeof record.id === "string" &&
    typeof record.transcript === "string" &&
    typeof record.createdAt === "string"
  );
}

function isTodoItem(value: unknown): value is TodoItem {
  if (!value || typeof value !== "object") {
    return false;
  }
  const item = value as Partial<TodoItem>;
  return (
    typeof item.id === "string" &&
    typeof item.title === "string" &&
    (item.category === "work" ||
      item.category === "shopping" ||
      item.category === "relationships" ||
      item.category === "life" ||
      item.category === "travel" ||
      item.category === "triage") &&
    (item.certainty === "confirmed" ||
      item.certainty === "direct" ||
      item.certainty === "suggestion") &&
    (typeof item.dueDateKey === "undefined" || typeof item.dueDateKey === "string") &&
    typeof item.sourceCaptureId === "string" &&
    typeof item.sourceSnippet === "string" &&
    typeof item.reasoning === "string" &&
    typeof item.createdAt === "string"
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <MainScreen />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function certaintyWeight(certainty: CertaintyTier): number {
  switch (certainty) {
    case "confirmed":
      return 3;
    case "direct":
      return 2;
    case "suggestion":
      return 1;
  }
}

function itemOpacity(certainty: CertaintyTier): number {
  switch (certainty) {
    case "confirmed":
      return 1;
    case "direct":
      return 0.7;
    case "suggestion":
      return 0.4;
  }
}

function categoryTitle(category: Category): string {
  switch (category) {
    case "work":
      return "工作";
    case "shopping":
      return "购物";
    case "relationships":
      return "关系";
    case "life":
      return "生活";
    case "travel":
      return "旅行";
    case "triage":
      return "待整理";
  }
}

function composerCategoryTitle(choice: ComposerCategoryChoice): string {
  if (choice === "list") return "清单";
  return categoryTitle(choice);
}

function nextComposerCategoryChoice(choice: ComposerCategoryChoice): ComposerCategoryChoice {
  const order: ComposerCategoryChoice[] = [
    "list",
    "shopping",
    "work",
    "relationships",
    "life",
    "travel",
    "triage",
  ];
  const currentIndex = order.indexOf(choice);
  return order[(currentIndex + 1) % order.length] ?? "list";
}

function nextCategory(category: Category): Category {
  switch (category) {
    case "work":
      return "shopping";
    case "shopping":
      return "relationships";
    case "relationships":
      return "life";
    case "life":
      return "travel";
    case "travel":
      return "triage";
    case "triage":
      return "work";
  }
}

const composerPriorityLabel: Record<ComposerPriority, string> = {
  normal: "普通",
  important: "重要",
  urgent: "紧急",
};

function nextComposerPriority(priority: ComposerPriority): ComposerPriority {
  switch (priority) {
    case "normal":
      return "important";
    case "important":
      return "urgent";
    case "urgent":
      return "normal";
  }
}

const composerReminderLabel: Record<ComposerReminder, string> = {
  off: "关闭",
  tonight: "今晚",
  tomorrowMorning: "明早",
};

function nextComposerReminder(reminder: ComposerReminder): ComposerReminder {
  switch (reminder) {
    case "off":
      return "tonight";
    case "tonight":
      return "tomorrowMorning";
    case "tomorrowMorning":
      return "off";
  }
}

function categoryChipAppearance(category: Category): {
  backgroundColor: string;
  textColor: string;
} {
  switch (category) {
    case "work":
      return {
        backgroundColor: palette.panelWork,
        textColor: palette.ink,
      };
    case "shopping":
      return {
        backgroundColor: palette.panelShopping,
        textColor: palette.ink,
      };
    case "relationships":
      return {
        backgroundColor: palette.panelRelationships,
        textColor: palette.ink,
      };
    case "life":
      return {
        backgroundColor: palette.panelLife,
        textColor: palette.panelLifeInk,
      };
    case "travel":
      return {
        backgroundColor: palette.panelTravel,
        textColor: palette.panelTravelInk,
      };
    case "triage":
      return {
        backgroundColor: palette.panelTriage,
        textColor: palette.ink,
      };
  }
}

function defaultVoiceHint(target: VoiceComposerTarget): string {
  return target === "ask"
    ? "点录音键开始，说完再点一次暂停。"
    : "点录音键开始；你可以多次暂停继续。";
}

function listeningVoiceHint(target: VoiceComposerTarget): string {
  return target === "ask" ? "正在听你的问题。" : "正在听，请直接说话。";
}

function pausedVoiceHint(target: VoiceComposerTarget): string {
  return target === "ask"
    ? "已暂停，可继续录音或点✓确认提问。"
    : "已暂停，可继续录音或点✓确认保存。";
}

function processingVoiceHint(target: VoiceComposerTarget): string {
  return target === "ask" ? "正在把问题转成文字…" : "正在把录音转成文字…";
}

function voiceComposerPlaceholder(target: VoiceComposerTarget): string {
  return target === "ask"
    ? "比如：我是不是忘了买什么？"
    : "例如，明天下午3点换灯泡";
}

function voiceComposerSubmitLabel(target: VoiceComposerTarget): string {
  return target === "ask" ? "✓" : "✓";
}

function mergeRecognizedText(base: string, transcript: string, target: VoiceInputTarget): string {
  const normalizedBase = base.trim();
  const normalizedTranscript = transcript.trim();

  if (!normalizedTranscript) return normalizedBase;
  if (!normalizedBase) return normalizedTranscript;

  return target === "composer"
    ? `${normalizedBase}\n${normalizedTranscript}`
    : `${normalizedBase} ${normalizedTranscript}`;
}

function nativeSpeechUnavailableMessage(): string {
  if (Platform.OS === "ios") {
    return "当前不是 iOS 开发版，苹果原生听写还不能用。";
  }

  return "当前设备不支持原生语音转录。";
}

function isSameDay(lhs: Date, rhs: Date): boolean {
  return (
    lhs.getFullYear() === rhs.getFullYear() &&
    lhs.getMonth() === rhs.getMonth() &&
    lhs.getDate() === rhs.getDate()
  );
}

function startOfDay(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function nextComposerDueDate(date: Date): Date {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  if (isSameDay(date, today)) return tomorrow;
  if (isSameDay(date, tomorrow)) return dayAfterTomorrow;
  return today;
}

function formatComposerDueDateLabel(date: Date): string {
  const today = startOfDay(new Date());
  const tomorrow = addDays(today, 1);
  const dayAfterTomorrow = addDays(today, 2);

  if (isSameDay(date, today)) return "今天";
  if (isSameDay(date, tomorrow)) return "明天";
  if (isSameDay(date, dayAfterTomorrow)) return "后天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function dueDateKeyFromDate(date: Date): string {
  const normalized = startOfDay(date);
  return [
    normalized.getFullYear(),
    String(normalized.getMonth() + 1).padStart(2, "0"),
    String(normalized.getDate()).padStart(2, "0"),
  ].join("-");
}

function dateFromDueDateKey(dueDateKey: string): Date {
  const [year, month, day] = dueDateKey.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

function formatMonthLabel(date: Date): string {
  return `${date.getFullYear()}年${date.getMonth() + 1}月`;
}

function formatCompactDateCode(date: Date): string {
  const year = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

function buildComposerMetaSummary(
  priority: ComposerPriority,
  reminder: ComposerReminder,
): string | null {
  const parts: string[] = [];

  if (priority !== "normal") {
    parts.push(`优先级${composerPriorityLabel[priority]}`);
  }

  if (reminder !== "off") {
    parts.push(`提醒${composerReminderLabel[reminder]}`);
  }

  return parts.length > 0 ? parts.join("，") : null;
}

function buildCalendarDays(month: Date): Array<Date | null> {
  const monthStart = new Date(month.getFullYear(), month.getMonth(), 1);
  const monthEnd = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const leadingEmpty = (monthStart.getDay() + 6) % 7;
  const trailingEmpty = (7 - ((leadingEmpty + monthEnd.getDate()) % 7)) % 7;
  const days: Array<Date | null> = [];

  for (let index = 0; index < leadingEmpty; index += 1) {
    days.push(null);
  }

  for (let day = 1; day <= monthEnd.getDate(); day += 1) {
    days.push(new Date(month.getFullYear(), month.getMonth(), day));
  }

  for (let index = 0; index < trailingEmpty; index += 1) {
    days.push(null);
  }

  return days;
}

function formatCaptureTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatAssistantTimeLabelFromDueDateKey(dueDateKey?: string): string {
  if (!dueDateKey) {
    return "待定";
  }

  const date = dateFromDueDateKey(dueDateKey);
  return formatComposerDueDateLabel(date);
}

function formatAssistantOptionalTimeLabelFromDueDateKey(dueDateKey?: string): string | undefined {
  if (!dueDateKey) {
    return undefined;
  }

  return formatAssistantTimeLabelFromDueDateKey(dueDateKey);
}

function formatAssistantReminderLabelFromISO8601(value: string | null | undefined): string | undefined {
  const dueDateKey = dueDateKeyFromISO8601(value);
  if (!dueDateKey) {
    return undefined;
  }

  return `${formatAssistantTimeLabelFromDueDateKey(dueDateKey)}提醒`;
}

function compactAssistantField(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function formatAssistantTaskLine(task: Pick<
  AssistantTaskEntry,
  "category" | "title" | "timeLabel" | "priorityLabel" | "reminderLabel"
>): string {
  return [
    categoryTitle(task.category),
    task.title,
    compactAssistantField(task.timeLabel),
    compactAssistantField(task.priorityLabel),
    compactAssistantField(task.reminderLabel),
  ]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

function formatAssistantTasksFromItems(items: TodoItem[]): string {
  return items
    .map((item) =>
      formatAssistantTaskLine(
        buildAssistantTaskEntryFromItem(item),
      ),
    )
    .join("\n");
}

function buildAssistantTaskEntriesFromItems(items: TodoItem[]): AssistantTaskEntry[] {
  return items.map((item) => buildAssistantTaskEntryFromItem(item));
}

function buildAssistantTaskEntryFromItem(item: TodoItem): AssistantTaskEntry {
  return {
    category: item.category,
    title: item.title,
    sourceSnippet: item.sourceSnippet,
    timeLabel: formatAssistantTimeLabelFromDueDateKey(resolvedDueDateKey(item)),
  };
}

function buildAssistantTaskEntryFromApi(
  task: AssistantApiTask,
  fallbackSourceSnippet?: string,
): AssistantTaskEntry {
  const category = normalizeCategory(task.category);
  const title =
    typeof task.title === "string" && task.title.trim().length > 0
      ? task.title.trim()
      : "待整理事项";
  const timeLabel =
    compactAssistantField(task.timeHint) ??
    compactAssistantField(
      formatAssistantOptionalTimeLabelFromDueDateKey(dueDateKeyFromISO8601(task.dueDateISO8601)),
    );
  const priorityLabel = compactAssistantField(task.priorityHint);
  const reminderLabel =
    compactAssistantField(task.reminderHint) ??
    compactAssistantField(formatAssistantReminderLabelFromISO8601(task.reminderDateISO8601));

  return {
    category,
    title,
    sourceSnippet:
      compactAssistantField(task.sourceSnippet) ??
      compactAssistantField(fallbackSourceSnippet) ??
      "未记录原话",
    ...(timeLabel ? { timeLabel } : {}),
    ...(priorityLabel ? { priorityLabel } : {}),
    ...(reminderLabel ? { reminderLabel } : {}),
  };
}

function buildRecallAnswer(
  input: string,
  items: TodoItem[],
  capturesById: Record<string, CaptureRecord>,
): string {
  const normalized = input.trim();
  if (!normalized) {
    return "你可以直接问我最近缺什么、忘了什么，或者今天最重要的是什么。";
  }

  const matches = items.filter((item) => {
    const capture = capturesById[item.sourceCaptureId];
    return (
      item.title.includes(normalized) ||
      item.sourceSnippet.includes(normalized) ||
      capture?.transcript.includes(normalized)
    );
  });

  if (matches.length > 0) {
    return formatAssistantTasksFromItems(matches.slice(0, 3));
  }

  const shoppingItems = items.filter((item) => item.category === "shopping");
  if (normalized.includes("买") || normalized.includes("忘") || normalized.includes("缺")) {
    return shoppingItems.length > 0
      ? formatAssistantTasksFromItems(shoppingItems.slice(0, 3))
      : "待整理 购物事项";
  }

  return "待整理 原话记录";
}

function buildTodayAnswer(todayItems: TodoItem[]): string {
  if (todayItems.length === 0) {
    return "待整理 今天事项";
  }

  return formatAssistantTasksFromItems(todayItems.slice(0, 3));
}

function buildImportantAnswer(listItems: TodoItem[]): string {
  const focusItems = listItems.filter((item) => item.certainty !== "suggestion").slice(0, 3);
  if (focusItems.length === 0) {
    return "待整理 重要事项";
  }

  return formatAssistantTasksFromItems(focusItems);
}

function buildPlanAnswer(input: string): string {
  const cleaned = input
    .replace(/帮我拆一下|帮我拆解一下|帮我拆解|帮我分解|怎么做|如何做|如何|步骤/gu, "")
    .replace(/[？?]/gu, "")
    .trim();
  const subject = cleaned.length > 0 ? cleaned : "这件事";

  return [
    `我会先把“${subject}”拆成三步：`,
    "1. 先明确目标、截止时间和你真正想完成的结果。",
    "2. 把它拆成 2 到 3 个最小动作，先做最容易开始的那一步。",
    "3. 给最后一步留一个检查点，确认是否还需要补资料、沟通或提醒。",
  ].join("\n");
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function dueDateKeyFromISO8601(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized.length >= 10 ? normalized.slice(0, 10) : undefined;
}

function resolvedDueDateKey(item: Pick<TodoItem, "dueDateKey" | "createdAt">): string {
  return item.dueDateKey ?? dueDateKeyFromDate(new Date(item.createdAt));
}

function formatItemDueDateLabel(item: Pick<TodoItem, "dueDateKey" | "createdAt">): string {
  const date = dateFromDueDateKey(resolvedDueDateKey(item));
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function normalizeTaskTitle(
  rawTitle: string | undefined,
  category: Category,
  transcript: string,
): string {
  const title = typeof rawTitle === "string" && rawTitle.trim().length > 0 ? rawTitle.trim() : "待确认事项";
  const combined = `${title} ${transcript}`;

  if (combined.includes("面包")) {
    return "买面包";
  }

  if (combined.includes("猫砂")) {
    return "买猫砂";
  }

  if (combined.includes("番茄")) {
    return "买番茄";
  }

  if (combined.includes("蔬菜")) {
    return "买蔬菜";
  }

  if (combined.includes("生日") && combined.includes("礼物")) {
    return category === "relationships" ? "购物 买生日礼物" : "买生日礼物";
  }

  return title;
}

function normalizeTaskFromAI(
  task: {
    title?: string;
    category?: string;
    confidenceScore?: number;
    dueDateISO8601?: string | null;
    sourceSnippet?: string;
    reasoning?: string;
  },
  context: {
    captureId: string;
    createdAt: string;
    transcript: string;
    fallbackDueDateKey?: string;
  },
): TodoItem {
  const dueDateKey =
    dueDateKeyFromISO8601(task.dueDateISO8601) ??
    context.fallbackDueDateKey ??
    dueDateKeyFromDate(new Date(context.createdAt));
  const category = normalizeCategory(task.category);

  return {
    id: makeId("item"),
    title: normalizeTaskTitle(task.title, category, context.transcript),
    category,
    certainty: normalizeCertainty(task.confidenceScore),
    ...(dueDateKey ? { dueDateKey } : {}),
    sourceCaptureId: context.captureId,
    sourceSnippet:
      typeof task.sourceSnippet === "string" && task.sourceSnippet.trim().length > 0
        ? task.sourceSnippet.trim()
        : context.transcript,
    reasoning:
      typeof task.reasoning === "string" && task.reasoning.trim().length > 0
        ? task.reasoning.trim()
        : "AI 从原话中整理出的事项。",
    createdAt: context.createdAt,
  };
}

function normalizeCategory(rawCategory: string | undefined): Category {
  switch (rawCategory) {
    case "work":
    case "shopping":
    case "relationships":
    case "life":
    case "travel":
    case "triage":
      return rawCategory;
    case "trip":
    case "traveling":
      return "travel";
    case "home":
    case "living":
      return "life";
    default:
      return "triage";
  }
}

function normalizeCertainty(rawScore: number | undefined): CertaintyTier {
  if (typeof rawScore === "number" && rawScore >= 0.75) {
    return "direct";
  }
  return "suggestion";
}

function toneForAssistantIntent(intent: AssistantIntent | undefined): AssistantMessageTone {
  switch (intent) {
    case "search_tasks":
      return "memory";
    case "plan":
      return "plan";
    case "prioritize":
      return "status";
    default:
      return "default";
  }
}

function assistantTaskListTitle(intent: AssistantIntent | undefined): string {
  switch (intent) {
    case "search_tasks":
      return "查找到事项";
    case "create_tasks":
      return "发布任务";
    default:
      return "助理事项";
  }
}

function shouldCreateTasksLocally(input: string): boolean {
  const normalized = input.trim();

  if (normalized.length === 0) {
    return false;
  }

  if (
    /[?？]/u.test(normalized) ||
    /我是不是|有没有|还有什么|忘了|怎么做|如何|步骤|拆一下|拆解|分解|最重要|优先|谢谢|你好|hello|hi/iu.test(
      normalized,
    )
  ) {
    return false;
  }

  return true;
}

function matchAssistantTasksToExistingItems(
  tasks: AssistantApiTask[],
  items: TodoItem[],
): TodoItem[] {
  const remaining = [...items];
  const matches: TodoItem[] = [];

  tasks.forEach((task) => {
    const category = normalizeCategory(task.category);
    const title = normalizeTaskTitle(task.title, category, task.sourceSnippet ?? task.title ?? "");
    const dueDateKey = dueDateKeyFromISO8601(task.dueDateISO8601);
    const matchIndex = remaining.findIndex((item) => {
      if (item.category !== category) return false;
      if (item.title !== title) return false;
      return dueDateKey ? resolvedDueDateKey(item) === dueDateKey : true;
    });

    if (matchIndex >= 0) {
      const [matchedItem] = remaining.splice(matchIndex, 1);
      if (matchedItem) {
        matches.push(matchedItem);
      }
    }
  });

  return matches;
}

function inferLocalTasks(
  transcript: string,
  captureId: string,
  createdAt: string,
  dueDateKey: string,
): TodoItem[] {
  const lowered = transcript.replaceAll("，", ",").replaceAll("。", ",");
  const tasks: TodoItem[] = [];

  if (lowered.includes("番茄")) {
    tasks.push({
      id: makeId("item"),
      title: "买番茄",
      category: "shopping",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: "番茄没了",
      reasoning: "从原话直接提炼出的补货事项。",
      createdAt,
    });
  }

  if (lowered.includes("蔬菜")) {
    tasks.push({
      id: makeId("item"),
      title: "买蔬菜",
      category: "shopping",
      certainty: lowered.includes("买") ? "direct" : "suggestion",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: "最近吃蔬菜很少",
      reasoning: "根据饮食和补货语义生成的事项。",
      createdAt: new Date(Date.parse(createdAt) + 1000).toISOString(),
    });
  }

  if (lowered.includes("生日")) {
    tasks.push({
      id: makeId("item"),
      title: "购物 买生日礼物",
      category: "relationships",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: "下个月生日",
      reasoning: "生日事件通常需要提前准备礼物或安排。",
      createdAt: new Date(Date.parse(createdAt) + 2000).toISOString(),
    });
  }

  if (lowered.includes("面包")) {
    tasks.push({
      id: makeId("item"),
      title: "买面包",
      category: "shopping",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "从原话中识别出明确的购买需求。",
      createdAt: new Date(Date.parse(createdAt) + 2500).toISOString(),
    });
  }

  if (lowered.includes("猫砂")) {
    tasks.push({
      id: makeId("item"),
      title: "买猫砂",
      category: "shopping",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "从补货语义中识别出猫砂采购事项。",
      createdAt: new Date(Date.parse(createdAt) + 2600).toISOString(),
    });
  }

  if (lowered.includes("报价") || lowered.includes("客户") || lowered.includes("会议")) {
    tasks.push({
      id: makeId("item"),
      title: "跟进工作事项",
      category: "work",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "从工作关键词中识别出的直接待办。",
      createdAt: new Date(Date.parse(createdAt) + 3000).toISOString(),
    });
  }

  if (
    lowered.includes("旅行") ||
    lowered.includes("旅游") ||
    lowered.includes("出行") ||
    lowered.includes("机票") ||
    lowered.includes("航班") ||
    lowered.includes("酒店") ||
    lowered.includes("高铁")
  ) {
    tasks.push({
      id: makeId("item"),
      title: "处理旅行安排",
      category: "travel",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "从旅行和出行关键词中识别出的事项。",
      createdAt: new Date(Date.parse(createdAt) + 4000).toISOString(),
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      id: makeId("item"),
      title: transcript.length > 16 ? `${transcript.slice(0, 16)}…` : transcript,
      category: "life",
      certainty: "direct",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "未命中特定规则，先保留为通用事项。",
      createdAt,
    });
  }

  return tasks.slice(0, 4);
}

function MainScreen() {
  const insets = useSafeAreaInsets();
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [query, setQuery] = useState("");
  const [captures, setCaptures] = useState<CaptureRecord[]>(seedCaptures);
  const [items, setItems] = useState<TodoItem[]>(seedItems);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [activeVoiceInputTarget, setActiveVoiceInputTarget] = useState<VoiceInputTarget | null>(null);
  const [isVoiceComposerOpen, setIsVoiceComposerOpen] = useState(true);
  const [voiceComposerTarget, setVoiceComposerTarget] =
    useState<VoiceComposerTarget>("capture");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [hasComposerTranscription, setHasComposerTranscription] = useState(false);
  const [composerCategoryChoice, setComposerCategoryChoice] = useState<ComposerCategoryChoice>("list");
  const [selectedDueDate, setSelectedDueDate] = useState<Date>(() => startOfDay(new Date()));
  const [composerPriority, setComposerPriority] = useState<ComposerPriority>("normal");
  const [composerReminder, setComposerReminder] = useState<ComposerReminder>("off");
  const [isManualComposerOptionsVisible, setIsManualComposerOptionsVisible] = useState(false);
  const [isManualComposerAdvancedOpen, setIsManualComposerAdvancedOpen] = useState(false);
  const [voiceComposerState, setVoiceComposerState] = useState<VoiceComposerState>("idle");
  const [voiceHint, setVoiceHint] = useState(defaultVoiceHint("capture"));
  const [askResult, setAskResult] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [isAssistantResponding, setIsAssistantResponding] = useState(false);
  const [planSelectedDate, setPlanSelectedDate] = useState<Date>(() => startOfDay(new Date()));
  const [planCalendarMonth, setPlanCalendarMonth] = useState<Date>(() => startOfDay(new Date()));
  const [isPlanQuickAddOpen, setIsPlanQuickAddOpen] = useState(false);
  const [planQuickAddTitle, setPlanQuickAddTitle] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingGridItemId, setEditingGridItemId] = useState<string | null>(null);
  const [editingGridTitle, setEditingGridTitle] = useState("");
  const [openCategoryMenuItemId, setOpenCategoryMenuItemId] = useState<string | null>(null);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>([]);
  const voiceDraftRef = useRef("");
  const activeVoiceInputTargetRef = useRef<VoiceInputTarget | null>(null);
  const recognitionBaseRef = useRef("");
  const recognitionTranscriptRef = useRef("");
  const voiceComposerTargetRef = useRef<VoiceComposerTarget>("capture");
  const isAssistantTab = activeTab === "assistant";
  const isAssistantInputLocked = isAssistantTab && isAssistantResponding;

  useEffect(() => {
    let cancelled = false;

    const hydrateFromStorage = async () => {
      try {
        const [storedCaptures, storedItems] = await Promise.all([
          AsyncStorage.getItem(CAPTURES_STORAGE_KEY),
          AsyncStorage.getItem(ITEMS_STORAGE_KEY),
        ]);
        if (cancelled) return;

        if (storedCaptures) {
          const parsed = JSON.parse(storedCaptures) as unknown;
          if (Array.isArray(parsed) && parsed.every(isCaptureRecord)) {
            setCaptures(parsed);
          }
        }

        if (storedItems) {
          const parsed = JSON.parse(storedItems) as unknown;
          if (Array.isArray(parsed) && parsed.every(isTodoItem)) {
            setItems(parsed);
          }
        }
      } catch {
        // Ignore malformed cache and keep in-memory defaults.
      } finally {
        if (!cancelled) {
          setHasHydratedStorage(true);
        }
      }
    };

    void hydrateFromStorage();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasHydratedStorage) return;
    void AsyncStorage.setItem(CAPTURES_STORAGE_KEY, JSON.stringify(captures));
  }, [captures, hasHydratedStorage]);

  useEffect(() => {
    if (!hasHydratedStorage) return;
    void AsyncStorage.setItem(ITEMS_STORAGE_KEY, JSON.stringify(items));
  }, [hasHydratedStorage, items]);

  useEffect(() => {
    voiceComposerTargetRef.current = voiceComposerTarget;
  }, [voiceComposerTarget]);

  useEffect(() => {
    const nextTarget: VoiceComposerTarget = isAssistantTab ? "ask" : "capture";
    setVoiceComposerTarget(nextTarget);

    if (isAssistantTab) {
      setIsManualComposerOptionsVisible(false);
      setIsManualComposerAdvancedOpen(false);
    }

    if (!isRecording && !isVoiceProcessing) {
      setVoiceHint(defaultVoiceHint(nextTarget));
    }
  }, [isAssistantTab, isRecording, isVoiceProcessing]);

  const grouped = useMemo(() => {
    const ordered = [...items].sort((lhs, rhs) => rhs.createdAt.localeCompare(lhs.createdAt));

    return {
      work: ordered.filter((it) => it.category === "work"),
      shopping: ordered.filter((it) => it.category === "shopping"),
      relationships: ordered.filter((it) => it.category === "relationships"),
      life: ordered.filter((it) => it.category === "life"),
      travel: ordered.filter((it) => it.category === "travel"),
      triage: ordered.filter((it) => it.category === "triage"),
    };
  }, [items]);

  const capturesById = useMemo(() => {
    return Object.fromEntries(captures.map((capture) => [capture.id, capture])) as Record<
      string,
      CaptureRecord
    >;
  }, [captures]);

  const listItems = useMemo(() => {
    return [...items].sort((lhs, rhs) => {
      if (lhs.createdAt === rhs.createdAt) {
        return certaintyWeight(rhs.certainty) - certaintyWeight(lhs.certainty);
      }
      return rhs.createdAt.localeCompare(lhs.createdAt);
    });
  }, [items]);

  const todayItems = useMemo(() => {
    const todayKey = dueDateKeyFromDate(new Date());
    return listItems.filter(
      (item) => item.certainty !== "suggestion" && resolvedDueDateKey(item) === todayKey,
    );
  }, [listItems]);

  const importantItems = useMemo(() => {
    return listItems.filter((item) => item.certainty !== "suggestion").slice(0, 3);
  }, [listItems]);

  const planCalendarDays = useMemo(() => buildCalendarDays(planCalendarMonth), [planCalendarMonth]);
  const scheduledItemsByDateKey = useMemo(() => {
    const datedItems = [...items].sort((lhs, rhs) => {
      const lhsDueDateKey = resolvedDueDateKey(lhs);
      const rhsDueDateKey = resolvedDueDateKey(rhs);

      if (lhsDueDateKey === rhsDueDateKey) {
          const certaintyDelta = certaintyWeight(rhs.certainty) - certaintyWeight(lhs.certainty);
          if (certaintyDelta !== 0) return certaintyDelta;
          return lhs.createdAt.localeCompare(rhs.createdAt);
      }

      return lhsDueDateKey.localeCompare(rhsDueDateKey);
    });

    return datedItems.reduce<Record<string, TodoItem[]>>((accumulator, item) => {
      const dueDateKey = resolvedDueDateKey(item);

      if (!accumulator[dueDateKey]) {
        accumulator[dueDateKey] = [];
      }

      accumulator[dueDateKey].push(item);
      return accumulator;
    }, {});
  }, [items]);
  const planSelectedDateKey = useMemo(() => dueDateKeyFromDate(planSelectedDate), [planSelectedDate]);
  const planSelectedItems = useMemo(
    () => scheduledItemsByDateKey[planSelectedDateKey] ?? [],
    [planSelectedDateKey, scheduledItemsByDateKey],
  );

  const isComposerRecording = isRecording && activeVoiceInputTarget === "composer";
  const isComposerVoiceProcessing = isVoiceProcessing && activeVoiceInputTarget === "composer";

  const shiftPlanCalendarMonth = (offset: number) => {
    const nextMonth = new Date(
      planCalendarMonth.getFullYear(),
      planCalendarMonth.getMonth() + offset,
      1,
    );
    const nextMonthLastDay = new Date(
      nextMonth.getFullYear(),
      nextMonth.getMonth() + 1,
      0,
    ).getDate();
    const nextSelectedDate = startOfDay(
      new Date(
        nextMonth.getFullYear(),
        nextMonth.getMonth(),
        Math.min(planSelectedDate.getDate(), nextMonthLastDay),
      ),
    );

    setPlanCalendarMonth(nextMonth);
    setPlanSelectedDate(nextSelectedDate);
    setIsPlanQuickAddOpen(false);
    setPlanQuickAddTitle("");
  };

  const selectPlanDate = (date: Date) => {
    const normalized = startOfDay(date);
    setPlanSelectedDate(normalized);
    setPlanCalendarMonth(new Date(normalized.getFullYear(), normalized.getMonth(), 1));
    setIsPlanQuickAddOpen(false);
    setPlanQuickAddTitle("");
  };

  const answerAssistantPrompt = (input: string): AssistantMessage => {
    const normalized = input.trim();

    if (/怎么做|如何|步骤|拆一下|拆解|分解/gu.test(normalized)) {
      return {
        id: makeId("assistant"),
        role: "assistant",
        text: buildPlanAnswer(normalized),
        tone: "plan",
      };
    }

    if (/今天|今晚/gu.test(normalized)) {
      return {
        id: makeId("assistant"),
        role: "assistant",
        text: buildTodayAnswer(todayItems),
        tone: "status",
      };
    }

    if (/最重要|重要|优先/gu.test(normalized)) {
      return {
        id: makeId("assistant"),
        role: "assistant",
        text: buildImportantAnswer(listItems),
        tone: "status",
      };
    }

    return {
      id: makeId("assistant"),
      role: "assistant",
      text: buildRecallAnswer(normalized, items, capturesById),
      tone: "memory",
    };
  };

  const resetRecognitionSession = useEffectEvent(() => {
    activeVoiceInputTargetRef.current = null;
    recognitionBaseRef.current = "";
    recognitionTranscriptRef.current = "";
    setActiveVoiceInputTarget(null);
    setIsRecording(false);
    setIsVoiceProcessing(false);
  });

  const applyRecognitionTranscript = useEffectEvent(
    (target: VoiceInputTarget, transcript: string) => {
      const merged = mergeRecognizedText(recognitionBaseRef.current, transcript, target);

      if (target === "query") {
        setAskResult("");
        setQuery(merged);
        return;
      }

      voiceDraftRef.current = merged;
      setVoiceDraft(merged);
      if (transcript.trim().length > 0) {
        setHasComposerTranscription(true);
      }
    },
  );

  const finishRecognitionSession = useEffectEvent(
    (target: VoiceInputTarget, transcript: string) => {
      const normalized = transcript.trim();

      if (target === "query") {
        if (normalized.length === 0) {
          setAskResult("没有听到内容，可以再试一次。");
        }
      } else {
        setVoiceComposerState("idle");
        setVoiceHint(
          normalized.length > 0
            ? pausedVoiceHint(voiceComposerTargetRef.current)
            : "没有听到内容，可以再试一次。",
        );
      }

      resetRecognitionSession();
    },
  );

  const failRecognitionSession = useEffectEvent(
    (target: VoiceInputTarget, message: string, restoreBase: boolean) => {
      if (restoreBase) {
        const base = recognitionBaseRef.current.trim();
        if (target === "query") {
          setQuery(base);
        } else {
          voiceDraftRef.current = base;
          setVoiceDraft(base);
        }
      }

      if (target === "query") {
        setAskResult(message);
      } else {
        setVoiceComposerState("error");
        setVoiceHint(message);
      }

      resetRecognitionSession();
    },
  );

  useEffect(() => {
    if (!speechRecognitionModule) return;

    const resultSubscription = speechRecognitionModule.addListener(
      "result",
      (event: ExpoSpeechRecognitionResultEvent) => {
        const target = activeVoiceInputTargetRef.current;
        if (!target) return;

        const transcript = event.results[0]?.transcript?.trim() ?? "";
        recognitionTranscriptRef.current = transcript;
        applyRecognitionTranscript(target, transcript);

        if (event.isFinal) {
          finishRecognitionSession(target, transcript);
        }
      },
    );

    const endSubscription = speechRecognitionModule.addListener("end", () => {
      const target = activeVoiceInputTargetRef.current;
      if (!target) return;

      finishRecognitionSession(target, recognitionTranscriptRef.current);
    });

    const errorSubscription = speechRecognitionModule.addListener(
      "error",
      (event: ExpoSpeechRecognitionErrorEvent) => {
        const target = activeVoiceInputTargetRef.current;
        if (!target) return;

        if (event.error === "aborted") {
          resetRecognitionSession();
          return;
        }

        const message =
          event.error === "no-speech" || event.error === "speech-timeout"
            ? "没有听到内容，可以再试一次。"
            : `语音转录失败: ${event.message || event.error}`;
        failRecognitionSession(target, message, true);
      },
    );

    const nomatchSubscription = speechRecognitionModule.addListener("nomatch", () => {
      recognitionTranscriptRef.current = "";
    });

    return () => {
      resultSubscription.remove();
      endSubscription.remove();
      errorSubscription.remove();
      nomatchSubscription.remove();
    };
  }, [
    applyRecognitionTranscript,
    failRecognitionSession,
    finishRecognitionSession,
    resetRecognitionSession,
  ]);

  const organizeTranscript = async (
    input: string,
    options: {
      forcedCategory?: Category | null;
      dueDate?: Date;
      metadataNote?: string | null;
    } = {},
  ) => {
    const normalized = input.trim();
    if (!normalized) return;

    const forcedCategory = options.forcedCategory ?? null;
    const dueDate = options.dueDate ?? new Date();
    const requestTranscript = options.metadataNote
      ? `${normalized}（${options.metadataNote}）`
      : normalized;
    const captureId = makeId("capture");
    const createdAt = new Date().toISOString();
    const dueDateKey = dueDateKeyFromDate(dueDate);
    const capture: CaptureRecord = {
      id: captureId,
      transcript: normalized,
      createdAt,
    };

    setCaptures((current) => [capture, ...current]);
    setIsAsking(true);
    setAskResult("");

    try {
      const response = await fetch(`${API_BASE_URL}/api/organize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transcript: requestTranscript,
          nowISO8601: createdAt,
        }),
      });
      const payload = (await response.json()) as
        | {
            tasks?: Array<{
              title?: string;
              category?: string;
              confidenceScore?: number;
              dueDateISO8601?: string | null;
              sourceSnippet?: string;
              reasoning?: string;
            }>;
            error?: string;
          }
        | undefined;

      if (!response.ok || payload?.error || !payload?.tasks) {
        const fallbackItemsRaw = inferLocalTasks(normalized, captureId, createdAt, dueDateKey);
        const fallbackItems = forcedCategory
          ? fallbackItemsRaw.map((item) => ({ ...item, category: forcedCategory }))
          : fallbackItemsRaw;
        setItems((current) => [...fallbackItems, ...current]);
        setAskResult(
          payload?.error
            ? `后端暂不可用，已本地整理 ${fallbackItems.length} 条事项。`
            : `已本地整理 ${fallbackItems.length} 条事项。`,
        );
        setActiveTab("list");
        return;
      }

      const nextItemsRaw = payload.tasks.map((task, index) =>
        normalizeTaskFromAI(task, {
          captureId,
          createdAt: new Date(Date.now() + index * 1000).toISOString(),
          transcript: normalized,
          fallbackDueDateKey: dueDateKey,
        }),
      );
      const nextItems = forcedCategory
        ? nextItemsRaw.map((item) => ({ ...item, category: forcedCategory }))
        : nextItemsRaw;

      setItems((current) => [...nextItems, ...current]);
      setAskResult(
        nextItems.length > 0 ? `AI 已整理 ${nextItems.length} 条事项。` : "AI 暂时没有拆出事项。",
      );
      setActiveTab("list");
    } catch (_error) {
      const fallbackItemsRaw = inferLocalTasks(normalized, captureId, createdAt, dueDateKey);
      const fallbackItems = forcedCategory
        ? fallbackItemsRaw.map((item) => ({ ...item, category: forcedCategory }))
        : fallbackItemsRaw;
      setItems((current) => [...fallbackItems, ...current]);
      setAskResult(`网络失败，已本地整理 ${fallbackItems.length} 条事项。`);
      setActiveTab("list");
    } finally {
      setIsAsking(false);
    }
  };

  const createConfirmedItemFromInput = (
    input: string,
    options: {
      forcedCategory?: Category | null;
      dueDate?: Date;
      nextTab?: Tab | null;
      metaSummary?: string | null;
    } = {},
  ) => {
    const normalized = input.trim();
    if (!normalized) return;

    const forcedCategory = options.forcedCategory ?? null;
    const dueDate = options.dueDate ?? new Date();
    const nextTab = options.nextTab === undefined ? "list" : options.nextTab;
    const createdAt = new Date().toISOString();
    const captureId = makeId("capture");
    const itemId = makeId("item");
    const dueDateKey = dueDateKeyFromDate(dueDate);
    const capture: CaptureRecord = {
      id: captureId,
      transcript: normalized,
      createdAt,
    };
    const item: TodoItem = {
      id: itemId,
      title: normalized,
      category: forcedCategory ?? "life",
      certainty: "confirmed",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: normalized,
      reasoning: [
        forcedCategory
          ? `用户手动输入并指定到${categoryTitle(forcedCategory)}类。`
          : "用户手动输入并直接确认的事项。",
        options.metaSummary ? `附加设置：${options.metaSummary}。` : null,
      ]
        .filter(Boolean)
        .join(" "),
      createdAt,
    };

    setCaptures((current) => [capture, ...current]);
    setItems((current) => [item, ...current]);
    setAskResult("已保存 1 条确认事项。");
    if (nextTab) {
      setActiveTab(nextTab);
    }
  };

  const submitPlanQuickAdd = () => {
    const normalized = planQuickAddTitle.trim();
    if (!normalized) return;

    createConfirmedItemFromInput(normalized, {
      dueDate: planSelectedDate,
      nextTab: null,
    });
    setPlanQuickAddTitle("");
    setIsPlanQuickAddOpen(false);
  };

  const addItemFromInboxCard = (category: Category) => {
    const createdAt = new Date().toISOString();
    const captureId = makeId("capture");
    const itemId = makeId("item");
    const dueDateKey = dueDateKeyFromDate(new Date());
    const capture: CaptureRecord = {
      id: captureId,
      transcript: `手动新增：${categoryTitle(category)}`,
      createdAt,
    };
    const item: TodoItem = {
      id: itemId,
      title: "新事项",
      category,
      certainty: "confirmed",
      dueDateKey,
      sourceCaptureId: captureId,
      sourceSnippet: "手动新增",
      reasoning: "用户在首页卡片中手动创建。",
      createdAt,
    };

    setCaptures((current) => [capture, ...current]);
    setItems((current) => [item, ...current]);
    setEditingGridItemId(itemId);
    setEditingGridTitle(item.title);
  };

  const confirmItem = (itemId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              certainty: "confirmed",
            }
          : item,
        ),
    );
  };

  const cycleItemCategory = (itemId: string) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              category: nextCategory(item.category),
            }
          : item,
      ),
    );
  };

  const setItemCategory = (itemId: string, category: Category) => {
    setItems((current) =>
      current.map((item) =>
        item.id === itemId
          ? {
              ...item,
              category,
            }
          : item,
      ),
    );
    setOpenCategoryMenuItemId(null);
  };

  const deleteItem = (itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
    if (editingItemId === itemId) setEditingItemId(null);
    if (editingGridItemId === itemId) setEditingGridItemId(null);
    if (openCategoryMenuItemId === itemId) setOpenCategoryMenuItemId(null);
  };

  const beginEditItem = (item: TodoItem) => {
    if (editingItemId && editingItemId !== item.id) {
      const normalizedCurrent = editingTitle.trim();
      if (normalizedCurrent) {
        setItems((current) =>
          current.map((currentItem) =>
            currentItem.id === editingItemId
              ? {
                  ...currentItem,
                  title: normalizedCurrent,
                }
              : currentItem,
          ),
        );
      }
    }
    setEditingItemId(item.id);
    setEditingTitle(item.title);
    setOpenCategoryMenuItemId(null);
  };

  const finishListEditing = () => {
    if (!editingItemId) return;

    const normalized = editingTitle.trim();
    if (normalized) {
      setItems((current) =>
        current.map((item) =>
          item.id === editingItemId
            ? {
                ...item,
                title: normalized,
              }
            : item,
        ),
      );
    }

    setEditingItemId(null);
    setEditingTitle("");
    setOpenCategoryMenuItemId(null);
  };

  const saveEditItem = (itemId: string) => {
    const normalized = editingTitle.trim();
    if (!normalized) return;

    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, title: normalized } : item)),
    );
    setEditingItemId(null);
    setEditingTitle("");
  };

  const beginGridEditItem = (item: TodoItem) => {
    setEditingGridItemId(item.id);
    setEditingGridTitle(item.title);
  };

  const saveGridEditItem = (itemId: string) => {
    const normalized = editingGridTitle.trim();
    if (!normalized) {
      setEditingGridItemId(null);
      setEditingGridTitle("");
      return;
    }

    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, title: normalized } : item)),
    );
    setEditingGridItemId(null);
    setEditingGridTitle("");
  };

  const stopNativeRecording = (shouldTranscribe: boolean) => {
    const target = activeVoiceInputTargetRef.current;

    if (!speechRecognitionModule || !target) {
      resetRecognitionSession();
      return;
    }

    if (!shouldTranscribe) {
      try {
        speechRecognitionModule.abort();
      } catch {
        resetRecognitionSession();
      }
      return;
    }

    setIsRecording(false);
    setIsVoiceProcessing(true);
    if (target === "composer") {
      setVoiceComposerState("processing");
      setVoiceHint(processingVoiceHint(voiceComposerTargetRef.current));
    }

    try {
      speechRecognitionModule.stop();
    } catch (error) {
      const message = error instanceof Error ? error.message : "无法停止语音识别";
      failRecognitionSession(target, `语音转录失败: ${message}`, true);
    }
  };

  const startNativeRecording = async (target: VoiceInputTarget) => {
    if (!speechRecognitionModule) {
      const message = nativeSpeechUnavailableMessage();
      if (target === "query") {
        setAskResult(message);
      } else {
        setVoiceComposerState("error");
        setVoiceHint(message);
      }
      return;
    }

    if (!speechRecognitionModule.isRecognitionAvailable()) {
      const message = "当前设备暂时不能使用系统语音识别。";
      if (target === "query") {
        setAskResult(message);
      } else {
        setVoiceComposerState("error");
        setVoiceHint(message);
      }
      return;
    }

    const prefersOnDeviceRecognition =
      Platform.OS === "ios" && speechRecognitionModule.supportsOnDeviceRecognition();

    try {
      const permission = prefersOnDeviceRecognition
        ? await speechRecognitionModule.requestMicrophonePermissionsAsync()
        : await speechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        const message = "没有语音权限，请先在系统设置里允许麦克风和语音识别。";
        if (target === "query") {
          setAskResult(message);
        } else {
          setVoiceComposerState("error");
          setVoiceHint(message);
        }
        return;
      }

      recognitionBaseRef.current = target === "query" ? query : voiceDraftRef.current;
      recognitionTranscriptRef.current = "";
      activeVoiceInputTargetRef.current = target;
      setActiveVoiceInputTarget(target);
      setIsVoiceProcessing(false);
      setIsRecording(true);

      if (target === "query") {
        setAskResult("");
      } else {
        setVoiceComposerState("listening");
        setVoiceHint(listeningVoiceHint(voiceComposerTargetRef.current));
      }

      speechRecognitionModule.start({
        lang: "zh-CN",
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        addsPunctuation: true,
        requiresOnDeviceRecognition: prefersOnDeviceRecognition,
        iosTaskHint: target === "query" ? "search" : "dictation",
        contextualStrings: ["清单", "购物", "工作", "关系", "生活", "旅行", "待整理", "提醒", "今天"],
      });
    } catch (error) {
      activeVoiceInputTargetRef.current = null;
      setActiveVoiceInputTarget(null);
      setIsRecording(false);
      setIsVoiceProcessing(false);
      const message = error instanceof Error ? error.message : "无法开始系统语音识别";
      if (target === "query") {
        setAskResult(`语音录音失败: ${message}`);
      } else {
        setVoiceComposerState("error");
        setVoiceHint(`语音录音失败: ${message}`);
      }
    }
  };

  const toggleComposerRecording = () => {
    if (isVoiceProcessing) return;

    if (isComposerRecording) {
      stopNativeRecording(true);
      return;
    }

    void startNativeRecording("composer");
  };

  const resetDockComposer = () => {
    voiceDraftRef.current = "";
    setVoiceDraft("");
    setHasComposerTranscription(false);
    setComposerCategoryChoice("list");
    setSelectedDueDate(startOfDay(new Date()));
    setComposerPriority("normal");
    setComposerReminder("off");
    setIsManualComposerOptionsVisible(false);
    setIsManualComposerAdvancedOpen(false);
    setVoiceComposerState("idle");
    setVoiceHint(defaultVoiceHint("capture"));
    setIsVoiceComposerOpen(true);
  };

  const submitVoiceDraft = () => {
    const normalized = voiceDraft.trim();
    if (!normalized) return;

    const forcedCategory = composerCategoryChoice === "list" ? null : composerCategoryChoice;
    const metaSummary = buildComposerMetaSummary(composerPriority, composerReminder);

    if (!hasComposerTranscription) {
      createConfirmedItemFromInput(normalized, {
        forcedCategory,
        dueDate: selectedDueDate,
        metaSummary,
      });
      resetDockComposer();
      return;
    }

    void organizeTranscript(normalized, {
      forcedCategory,
      dueDate: selectedDueDate,
      metadataNote: metaSummary,
    });
    resetDockComposer();
  };

  const createAssistantCapture = (transcript: string): CaptureRecord => {
    return {
      id: makeId("capture"),
      transcript,
      createdAt: new Date().toISOString(),
    };
  };

  const submitAssistantPrompt = async (input: string = voiceDraft) => {
    const normalized = input.trim();
    if (
      !normalized ||
      isComposerVoiceProcessing ||
      isComposerRecording ||
      isAssistantResponding
    ) {
      return;
    }

    const userMessage: AssistantMessage = {
      id: makeId("assistant"),
      role: "user",
      text: normalized,
      tone: "default",
    };
    const conversationHistory = assistantMessages
      .slice(-10)
      .map((message) => ({ role: message.role, text: message.text }));
    const capture = createAssistantCapture(normalized);

    setAssistantMessages((current) => [...current, userMessage]);
    setAskResult("");
    voiceDraftRef.current = "";
    setVoiceDraft("");
    setHasComposerTranscription(false);
    setVoiceHint(defaultVoiceHint("ask"));
    setQuery("");

    setIsAssistantResponding(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: normalized,
          nowISO8601: capture.createdAt,
          history: conversationHistory,
          tasks: listItems.slice(0, 40).map((item) => ({
            id: item.id,
            title: item.title,
            category: item.category,
            certainty: item.certainty,
            dueDateKey: item.dueDateKey ?? null,
            sourceSnippet: item.sourceSnippet,
            reasoning: item.reasoning,
            createdAt: item.createdAt,
          })),
          captures: captures.slice(0, 12).map((entry) => ({
            id: entry.id,
            transcript: entry.transcript,
            createdAt: entry.createdAt,
          })),
        }),
      });

      const payload = (await response.json()) as AssistantApiResponse;
      if (!response.ok || payload.error || typeof payload.reply !== "string") {
        throw new Error(payload.detail || payload.error || "assistant_failed");
      }
      const replyText = payload.reply.trim();
      let assistantTaskEntries: AssistantTaskEntry[] | undefined;

      if (Array.isArray(payload.tasks) && payload.tasks.length > 0) {
        if (payload.intent === "search_tasks") {
          const matchedItems = matchAssistantTasksToExistingItems(payload.tasks, listItems);
          if (matchedItems.length > 0) {
            assistantTaskEntries = buildAssistantTaskEntriesFromItems(matchedItems);
          }
        } else {
          assistantTaskEntries = payload.tasks.map((task) =>
            buildAssistantTaskEntryFromApi(task, normalized),
          );
        }
      }

      setAssistantMessages((current) => [
        ...current,
        {
          id: makeId("assistant"),
          role: "assistant",
          text:
            assistantTaskEntries && assistantTaskEntries.length > 0
              ? assistantTaskEntries.map((task) => formatAssistantTaskLine(task)).join("\n")
              : replyText || "待整理 原话记录",
          tone: toneForAssistantIntent(payload.intent),
          taskListTitle:
            assistantTaskEntries && assistantTaskEntries.length > 0
              ? assistantTaskListTitle(payload.intent)
              : undefined,
          tasks: assistantTaskEntries,
        },
      ]);
    } catch (_error) {
      if (shouldCreateTasksLocally(normalized)) {
        const fallbackItems = inferLocalTasks(
          normalized,
          capture.id,
          capture.createdAt,
          dueDateKeyFromDate(new Date()),
        );
        const fallbackEntries = fallbackItems.map((item) => ({
          category: item.category,
          title: item.title,
          sourceSnippet: item.sourceSnippet,
        }));
        setAssistantMessages((current) => [
          ...current,
          {
            id: makeId("assistant"),
            role: "assistant",
            text: fallbackEntries.map((task) => formatAssistantTaskLine(task)).join("\n"),
            tone: "default",
            taskListTitle: "发布任务",
            tasks: fallbackEntries,
          },
        ]);
      } else {
        const fallbackMessage = answerAssistantPrompt(normalized);
        setAssistantMessages((current) => [...current, fallbackMessage]);
      }
    } finally {
      setIsAssistantResponding(false);
    }
  };

  const startVoiceComposer = (target: VoiceComposerTarget = "capture") => {
    voiceDraftRef.current = "";
    setVoiceDraft("");
    setHasComposerTranscription(false);
    setComposerCategoryChoice("list");
    setSelectedDueDate(startOfDay(new Date()));
    setComposerPriority("normal");
    setComposerReminder("off");
    setIsManualComposerOptionsVisible(false);
    setIsManualComposerAdvancedOpen(false);
    setVoiceComposerTarget(target);
    setVoiceComposerState("idle");
    setVoiceHint(defaultVoiceHint(target));
    setIsVoiceComposerOpen(true);
  };

  useEffect(() => {
    if (isVoiceComposerOpen) return;

    if (activeVoiceInputTarget === "composer" && isRecording) {
      stopNativeRecording(false);
      return;
    }

    if (activeVoiceInputTarget !== "composer" && isVoiceProcessing) {
      return;
    }

    if (!isVoiceProcessing) {
      setVoiceComposerState("idle");
      setVoiceHint(defaultVoiceHint(voiceComposerTarget));
    }
  }, [activeVoiceInputTarget, isVoiceComposerOpen, isRecording, isVoiceProcessing, voiceComposerTarget]);

  useEffect(() => {
    return () => {
      stopNativeRecording(false);
    };
  }, []);

  const renderTrackedItem = (item: TodoItem) => {
    const isEditing = editingItemId === item.id;
    const isCategoryMenuOpen = openCategoryMenuItemId === item.id;
    const sourceCapture = capturesById[item.sourceCaptureId];
    const originalText = sourceCapture?.transcript ?? item.sourceSnippet;

    return (
      <View
        key={item.id}
        style={[
          styles.listItemCard,
          styles.listItemCardForeground,
          { opacity: itemOpacity(item.certainty) },
        ]}
      >
        <Pressable
          style={styles.listItemPressable}
          onPress={() => {
            if (isEditing) return;
            beginEditItem(item);
          }}
        >
          <View style={styles.listItemTop}>
            <View style={styles.listItemTextWrap}>
              <View style={styles.listItemTitleRow}>
                <Pressable
                  style={styles.listCategoryButton}
                  onPress={(event) => {
                    event.stopPropagation();
                    setOpenCategoryMenuItemId((current) =>
                      current === item.id ? null : item.id,
                    );
                  }}
                >
                  <Text style={styles.listCategoryText}>{categoryTitle(item.category)}</Text>
                </Pressable>
                {isEditing ? (
                  <TextInput
                    value={editingTitle}
                    onChangeText={setEditingTitle}
                    autoFocus
                    onSubmitEditing={finishListEditing}
                    onBlur={finishListEditing}
                    placeholder="修改事项标题"
                    placeholderTextColor={palette.inkSoft}
                    style={styles.listInlineInput}
                  />
                ) : (
                  <Text style={styles.listItemTitle}>{item.title}</Text>
                )}
                {isCategoryMenuOpen ? (
                  <View style={styles.categoryDropdownMenu}>
                    {(["shopping", "work", "relationships", "life", "travel", "triage"] as Category[]).map(
                      (category) => {
                        const active = item.category === category;

                        return (
                          <Pressable
                            key={category}
                            style={[
                              styles.categoryDropdownOption,
                              active ? styles.categoryDropdownOptionActive : null,
                            ]}
                            onPress={(event) => {
                              event.stopPropagation();
                              setItemCategory(item.id, category);
                            }}
                          >
                            <Text
                              style={styles.categoryDropdownOptionText}
                            >
                              {categoryTitle(category)}
                            </Text>
                          </Pressable>
                        );
                      },
                    )}
                  </View>
                ) : null}
              </View>
              <Text numberOfLines={2} style={styles.listItemOriginalText}>
                {`原话:${originalText}`}
              </Text>
            </View>

            <View style={styles.listActions}>
              <Pressable style={styles.iconActionButton} onPress={() => beginEditItem(item)}>
                <MaterialCommunityIcons
                  name="pencil-outline"
                  size={18}
                  color={palette.accent}
                />
              </Pressable>
              <Pressable
                style={[styles.iconActionButton, styles.iconDeleteButton]}
                onPress={() => deleteItem(item.id)}
              >
                <MaterialCommunityIcons name="close" size={20} color="#8C4325" />
              </Pressable>
              <Pressable
                style={[
                  styles.iconActionButton,
                  styles.iconConfirmButton,
                  item.certainty === "confirmed" ? styles.iconConfirmButtonDone : null,
                ]}
                disabled={item.certainty === "confirmed"}
                onPress={() => confirmItem(item.id)}
              >
                <MaterialCommunityIcons
                  name="check"
                  size={20}
                  color={item.certainty === "confirmed" ? palette.inkSoft : palette.accent}
                />
              </Pressable>
            </View>
          </View>
        </Pressable>
      </View>
    );
  };

  const renderInbox = () => (
    <View style={styles.homeScreen}>
      <View style={styles.grid}>
        {clusterOrder.map((cluster) => (
          <View
            key={cluster.key}
            style={[
              styles.gridCard,
              clusterOrder.length % 2 === 1 &&
              cluster.key === clusterOrder[clusterOrder.length - 1]?.key
                ? styles.gridCardWide
                : null,
              { backgroundColor: cluster.panelColor, borderColor: palette.border },
            ]}
          >
            <View style={styles.cardHeaderRow}>
              <Text style={[styles.cardTitle, { color: cluster.inkColor }]}>{cluster.title}</Text>
              <Pressable
                style={styles.cardAddTextButton}
                onPress={() => addItemFromInboxCard(cluster.key)}
              >
                <Text style={[styles.cardAddText, { color: cluster.inkColor }]}>+</Text>
              </Pressable>
            </View>
            {grouped[cluster.key].length === 0 ? (
              <Text style={[styles.emptyHint, { color: cluster.mutedInkColor }]}>
                AI 还没放任务到这里
              </Text>
            ) : (
              <View style={styles.gridCardBody}>
                <ScrollView
                  style={styles.gridCardScroll}
                  contentContainerStyle={styles.gridCardScrollContent}
                  showsVerticalScrollIndicator
                  nestedScrollEnabled
                  keyboardShouldPersistTaps="handled"
                >
                  {grouped[cluster.key].map((it) => (
                    <Swipeable
                      key={it.id}
                      overshootRight={false}
                      renderRightActions={() => (
                        <Pressable
                          style={styles.gridDeleteAction}
                          onPress={() => deleteItem(it.id)}
                        >
                          <Text style={styles.gridDeleteActionText}>删除</Text>
                        </Pressable>
                      )}
                    >
                      <Pressable
                        style={[
                          styles.todoRow,
                          { borderBottomColor: cluster.mutedInkColor },
                          { opacity: itemOpacity(it.certainty) },
                        ]}
                        onPress={() => beginGridEditItem(it)}
                      >
                        {editingGridItemId === it.id ? (
                          <TextInput
                            value={editingGridTitle}
                            onChangeText={setEditingGridTitle}
                            autoFocus
                            onSubmitEditing={() => saveGridEditItem(it.id)}
                            onBlur={() => saveGridEditItem(it.id)}
                            placeholder="修改事项"
                            placeholderTextColor={cluster.mutedInkColor}
                            style={[styles.todoEditInput, { color: cluster.rowInkColor }]}
                          />
                        ) : (
                          <Text style={[styles.todoText, { color: cluster.rowInkColor }]}>
                            {it.title}
                          </Text>
                        )}
                      </Pressable>
                    </Swipeable>
                  ))}
                </ScrollView>
              </View>
            )}
          </View>
        ))}
      </View>

      {importantItems.length > 0 ? (
        <View style={styles.homeFocusBlock}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>重要事项</Text>
            <Pressable onPress={() => setActiveTab("assistant")}>
              <Text style={styles.sectionActionText}>去问助理</Text>
            </Pressable>
          </View>
          {importantItems.map((item) => (
            <Pressable
              key={item.id}
              style={styles.homeFocusRow}
              onPress={() => setActiveTab("list")}
            >
              <Text style={styles.homeFocusCategory}>{categoryTitle(item.category)}</Text>
              <Text style={styles.homeFocusText}>{item.title}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );

  const renderAssistant = () => (
    <View style={styles.assistantScreen}>
      <View style={styles.assistantFeed}>
        {assistantMessages.map((message) => (
          <View
            key={message.id}
            style={[
              styles.assistantMessageRow,
              message.role === "user" ? styles.assistantMessageRowUser : null,
            ]}
          >
            {message.role === "assistant" && message.tasks && message.tasks.length > 0 ? (
              <View style={styles.assistantTaskList}>
                {message.taskListTitle ? (
                  <Text style={styles.assistantTaskListLabel}>{message.taskListTitle}</Text>
                ) : null}
                {message.tasks.map((task, index) => {
                  return (
                    <View key={`${message.id}-${index}`} style={styles.assistantTaskRow}>
                      <View style={styles.assistantTaskBody}>
                        <Text style={styles.assistantTaskTitle}>{formatAssistantTaskLine(task)}</Text>
                        <Text style={styles.assistantTaskMeta}>原话: {task.sourceSnippet}</Text>
                      </View>
                    </View>
                  );
                })}
              </View>
            ) : (
              <Text
                style={[
                  styles.assistantMessageText,
                  message.role === "user" ? styles.assistantMessageTextUser : null,
                  message.tone === "plan" ? styles.assistantMessageTextPlan : null,
                ]}
              >
                {message.text}
              </Text>
            )}
          </View>
        ))}
        {isAssistantResponding ? (
          <View style={styles.assistantMessageRow}>
            <Text style={styles.assistantMessageText}>...</Text>
          </View>
        ) : null}
      </View>
    </View>
  );

  const renderList = () => (
    <View style={styles.listScreen}>
      {editingItemId || openCategoryMenuItemId ? (
        <Pressable
          style={styles.listBlankSaver}
          onPress={() => {
            finishListEditing();
            setOpenCategoryMenuItemId(null);
          }}
        />
      ) : null}

      <View style={styles.historyHeader}>
        <Text style={styles.sectionTitle}>所有</Text>
        {/* Keep this explanation visible on the list screen so users know original wording is preserved. */}
        <Text style={styles.historyHeaderText}>{listScreenDescription}</Text>
      </View>

      {listItems.length === 0 ? (
        <View style={styles.simplePanel}>
          <Text style={styles.title}>还没有记录</Text>
          <Text style={styles.simpleItem}>点底部输入框说一句，系统会保存原话并自动整理事项。</Text>
        </View>
      ) : (
        listItems.map((item) => renderTrackedItem(item))
      )}
    </View>
  );

  const renderToday = () => (
    <View style={styles.todayScreen}>
      {todayItems.length === 0 ? (
        <Text style={styles.todayEmptyText}>今天还没有待办事项。</Text>
      ) : (
        <View style={styles.todayList}>
          {todayItems.map((it) => {
            const isEditing = editingItemId === it.id;

            return (
              <View key={it.id} style={styles.todayRow}>
                <View style={styles.todayRowMain}>
                  <View style={styles.todayRowMarker} />
                  {isEditing ? (
                    <TextInput
                      value={editingTitle}
                      onChangeText={setEditingTitle}
                      placeholder="修改今天事项"
                      placeholderTextColor={palette.inkSoft}
                      onSubmitEditing={() => saveEditItem(it.id)}
                      onBlur={() => saveEditItem(it.id)}
                      style={styles.todayEditInput}
                    />
                  ) : (
                    <Text style={styles.todayRowTitle}>{it.title}</Text>
                  )}
                </View>
                <View style={styles.todayRowActions}>
                  <Pressable
                    style={styles.todayActionButton}
                    onPress={() => {
                      if (isEditing) {
                        saveEditItem(it.id);
                        return;
                      }
                      beginEditItem(it);
                    }}
                  >
                    <MaterialCommunityIcons
                      name={isEditing ? "check" : "pencil-outline"}
                      size={18}
                      color={palette.accent}
                    />
                  </Pressable>
                  <Pressable
                    style={[styles.todayActionButton, styles.todayDeleteButton]}
                    onPress={() => deleteItem(it.id)}
                  >
                    <MaterialCommunityIcons name="close" size={20} color="#8C4325" />
                  </Pressable>
                </View>
              </View>
            );
          })}
        </View>
      )}
    </View>
  );

  const renderPlan = () => (
    <View style={styles.calendarScreen}>
      <View style={styles.planCalendarWrap}>
        <View style={styles.planCalendarHeader}>
          <Pressable
            hitSlop={8}
            style={styles.planCalendarNavButton}
            onPress={() => shiftPlanCalendarMonth(-1)}
          >
            <MaterialCommunityIcons name="chevron-left" size={18} color={palette.accent} />
          </Pressable>
          <Text style={styles.planCalendarHeaderText}>{formatMonthLabel(planCalendarMonth)}</Text>
          <Pressable
            hitSlop={8}
            style={styles.planCalendarNavButton}
            onPress={() => shiftPlanCalendarMonth(1)}
          >
            <MaterialCommunityIcons name="chevron-right" size={18} color={palette.accent} />
          </Pressable>
        </View>

        <View style={styles.planCalendarWeekRow}>
          {calendarWeekdayLabels.map((label) => (
            <Text key={label} style={styles.planCalendarWeekLabel}>
              {label}
            </Text>
          ))}
        </View>

        <View style={styles.planCalendarGrid}>
          {planCalendarDays.map((dateOption, index) => {
            if (!dateOption) {
              return <View key={`plan-empty-${index}`} style={styles.planCalendarDayPlaceholder} />;
            }

            const dateKey = dueDateKeyFromDate(dateOption);
            const hasItems = Boolean(scheduledItemsByDateKey[dateKey]?.length);
            const active = isSameDay(dateOption, planSelectedDate);
            const isToday = isSameDay(dateOption, new Date());

            return (
              <Pressable
                key={dateOption.toISOString()}
                style={[styles.planCalendarDayButton, active ? styles.planCalendarDayButtonActive : null]}
                onPress={() => selectPlanDate(dateOption)}
              >
                <Text
                  style={[
                    styles.planCalendarDayText,
                    isToday ? styles.planCalendarDayTextToday : null,
                    active ? styles.planCalendarDayTextActive : null,
                  ]}
                >
                  {dateOption.getDate()}
                </Text>
                <View style={styles.planCalendarDayMarkerSlot}>
                  {hasItems ? (
                    <MaterialCommunityIcons
                      name="checkbox-blank-circle"
                      size={7}
                      color={active ? "#F3E7D8" : palette.accent}
                    />
                  ) : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.planAgendaSection}>
        <View style={styles.planAgendaHeader}>
          <Text style={styles.planAgendaHeaderText}>
            {`${formatCompactDateCode(planSelectedDate)} ${fullWeekdayLabels[planSelectedDate.getDay()]}`}
          </Text>
          <Pressable
            hitSlop={8}
            style={styles.planAgendaAddButton}
            onPress={() => {
              setIsPlanQuickAddOpen((current) => !current);
              setPlanQuickAddTitle("");
            }}
          >
            <MaterialCommunityIcons
              name={isPlanQuickAddOpen ? "close" : "plus"}
              size={20}
              color={palette.accent}
            />
          </Pressable>
        </View>

        {isPlanQuickAddOpen ? (
          <View style={styles.planQuickAddRow}>
            <TextInput
              value={planQuickAddTitle}
              onChangeText={setPlanQuickAddTitle}
              autoFocus
              onSubmitEditing={submitPlanQuickAdd}
              placeholder="添加这一天的事项"
              placeholderTextColor={palette.inkSoft}
              returnKeyType="done"
              style={styles.planQuickAddInput}
            />
            <Pressable
              style={[
                styles.planQuickAddSubmitButton,
                planQuickAddTitle.trim().length > 0 ? styles.planQuickAddSubmitButtonActive : null,
              ]}
              disabled={planQuickAddTitle.trim().length === 0}
              onPress={submitPlanQuickAdd}
            >
              <MaterialCommunityIcons
                name="check"
                size={18}
                color={planQuickAddTitle.trim().length > 0 ? "#F3E7D8" : palette.inkSoft}
              />
            </Pressable>
          </View>
        ) : null}

        <View style={styles.planAgendaList}>
          {planSelectedItems.length > 0 ? (
            planSelectedItems.map((item) => {
              const chip = categoryChipAppearance(item.category);

              return (
                <View key={item.id} style={styles.planAgendaRow}>
                  <View style={[styles.planAgendaRowMarker, { backgroundColor: chip.backgroundColor }]} />
                  <View style={styles.planAgendaRowBody}>
                    <Text style={styles.planAgendaTitle}>{item.title}</Text>
                  </View>
                </View>
              );
            })
          ) : (
            <Text style={styles.planAgendaEmptyText}>选中的这一天还没有安排，换一天看看也可以。</Text>
          )}
        </View>
      </View>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.simplePanel}>
      <Text style={styles.title}>设置</Text>
      <Text style={styles.simpleItem}>当前语音输入: 苹果原生转录</Text>
      <Text style={styles.simpleItem}>当前整理链路: 本地规则 + 可选后端 organize</Text>
      <Text style={styles.simpleItem}>后端地址: http://127.0.0.1:8787</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <View style={styles.topNav}>
        <View style={styles.topNavTabs}>
          {navTabs.map((tab) => (
            <Pressable
              key={tab}
              onPress={() => setActiveTab(tab)}
              style={[styles.navItem, activeTab === tab ? styles.navItemActive : null]}
            >
              <Text style={[styles.navText, activeTab === tab ? styles.navTextActive : null]}>
                {tabLabel[tab]}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 10,
            paddingBottom: 274 + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "inbox" && renderInbox()}
        {activeTab === "assistant" && renderAssistant()}
        {activeTab === "list" && renderList()}
        {activeTab === "today" && renderToday()}
        {activeTab === "plan" && renderPlan()}
        {activeTab === "settings" && renderSettings()}
      </ScrollView>

      <View
        style={[
          styles.voiceComposerDock,
          {
            paddingBottom: 12 + insets.bottom,
          },
        ]}
      >
        {!isAssistantTab && isManualComposerOptionsVisible ? (
          <View style={styles.manualComposerOptions}>
            <View style={styles.manualComposerRow}>
              <Pressable
                style={styles.manualComposerChip}
                onPress={() =>
                  setComposerCategoryChoice((current) => nextComposerCategoryChoice(current))
                }
              >
                <Text style={styles.manualComposerChipText}>
                  {`清单 · ${
                    composerCategoryChoice === "list"
                      ? "自动"
                      : categoryTitle(composerCategoryChoice)
                  }`}
                </Text>
              </Pressable>
              <Pressable
                style={styles.manualComposerChip}
                onPress={() => setSelectedDueDate((current) => nextComposerDueDate(current))}
              >
                <Text style={styles.manualComposerChipText}>
                  {`日期 · ${formatComposerDueDateLabel(selectedDueDate)}`}
                </Text>
              </Pressable>
              <Pressable
                style={[
                  styles.manualComposerChip,
                  isManualComposerAdvancedOpen ? styles.manualComposerChipActive : null,
                ]}
                onPress={() => setIsManualComposerAdvancedOpen((current) => !current)}
              >
                <Text style={styles.manualComposerChipText}>
                  {isManualComposerAdvancedOpen ? "收起" : "更多"}
                </Text>
              </Pressable>
            </View>
            {isManualComposerAdvancedOpen ? (
              <View style={styles.manualComposerRow}>
                <Pressable
                  style={styles.manualComposerChip}
                  onPress={() => setComposerPriority((current) => nextComposerPriority(current))}
                >
                  <Text style={styles.manualComposerChipText}>
                    {`优先级 · ${composerPriorityLabel[composerPriority]}`}
                  </Text>
                </Pressable>
                <Pressable
                  style={styles.manualComposerChip}
                  onPress={() => setComposerReminder((current) => nextComposerReminder(current))}
                >
                  <Text style={styles.manualComposerChipText}>
                    {`提醒 · ${composerReminderLabel[composerReminder]}`}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        ) : null}

        {(isComposerRecording || isComposerVoiceProcessing || voiceComposerState === "error") ? (
          <View
            style={[
              styles.voiceStatusBanner,
              voiceComposerState === "error" ? styles.voiceStatusBannerError : null,
            ]}
          >
            <MaterialCommunityIcons
              name={
                voiceComposerState === "error"
                  ? "alert-circle-outline"
                  : isComposerRecording
                    ? "record-circle-outline"
                    : "timer-sand"
              }
              size={14}
              color={voiceComposerState === "error" ? "#8C4325" : palette.accent}
            />
            <Text
              style={[
                styles.voiceStatusText,
                voiceComposerState === "error" ? styles.voiceStatusTextError : null,
              ]}
            >
              {voiceComposerState === "error"
                ? voiceHint
                : isComposerRecording
                  ? "正在录音，点话筒停止"
                  : "正在转录..."}
            </Text>
          </View>
        ) : null}

        <View style={styles.voiceInputRow}>
          <View style={styles.voiceInputContainer}>
            <TextInput
              value={voiceDraft}
              onChangeText={(nextValue) => {
                voiceDraftRef.current = nextValue;
                setVoiceDraft(nextValue);
              }}
              placeholder={
                isComposerVoiceProcessing
                  ? "正在转录..."
                  : isAssistantTab
                    ? "给助理发消息"
                    : voiceComposerPlaceholder("capture")
              }
              placeholderTextColor={palette.inkSoft}
              multiline
              editable={!isComposerVoiceProcessing}
              textAlignVertical="top"
              onFocus={() => {
                if (!isAssistantTab) {
                  setIsManualComposerOptionsVisible(true);
                }
              }}
              style={styles.voiceComposerInput}
            />
            <Pressable
              style={[
                styles.voiceInlineSendButton,
                voiceDraft.trim().length > 0 &&
                !isComposerRecording &&
                !isComposerVoiceProcessing &&
                !isAssistantInputLocked
                  ? styles.voiceInlineSendButtonActive
                  : null,
              ]}
              disabled={
                voiceDraft.trim().length === 0 ||
                isComposerRecording ||
                isComposerVoiceProcessing ||
                isAssistantInputLocked
              }
              onPress={
                isAssistantTab ? () => void submitAssistantPrompt() : submitVoiceDraft
              }
            >
              <MaterialCommunityIcons
                name="send"
                size={16}
                color={
                  voiceDraft.trim().length > 0 &&
                  !isComposerRecording &&
                  !isComposerVoiceProcessing &&
                  !isAssistantInputLocked
                    ? "#F3E7D8"
                    : palette.inkSoft
                }
              />
            </Pressable>
          </View>

          <Pressable
            style={[
              styles.voiceRecordButton,
              isComposerRecording ? styles.voiceRecordButtonActive : null,
              isComposerVoiceProcessing || isAssistantInputLocked
                ? styles.askButtonDisabled
                : null,
            ]}
            disabled={isComposerVoiceProcessing || isAssistantInputLocked}
            onPress={toggleComposerRecording}
          >
            <MaterialCommunityIcons
              name={isComposerRecording ? "stop" : "microphone-outline"}
              size={isComposerRecording ? 20 : 24}
              color="#F3E7D8"
            />
          </Pressable>
        </View>
      </View>

    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: palette.appBg,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    gap: 18,
  },
  homeScreen: {
    gap: 18,
  },
  headerBlock: {
    gap: 6,
  },
  eyebrow: {
    fontSize: 13,
    color: palette.inkSoft,
    fontWeight: "700",
    letterSpacing: 1,
  },
  title: {
    fontSize: 42 / 1.5,
    color: palette.ink,
    fontWeight: "800",
  },
  queryBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: palette.inputBg,
    borderRadius: 24,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
    borderWidth: 1,
    borderColor: palette.border,
  },
  searchIcon: {
    fontSize: 22,
    color: palette.inkSoft,
  },
  queryInput: {
    flex: 1,
    fontSize: 18,
    color: palette.ink,
  },
  askButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  searchButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  askButtonDisabled: {
    opacity: 0.72,
  },
  askButtonText: {
    color: palette.accent,
    fontWeight: "700",
    fontSize: 16,
  },
  resultBox: {
    backgroundColor: "rgba(214, 203, 185, 0.72)",
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: palette.border,
  },
  resultText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  sectionTitle: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
  },
  sectionActionText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  gridCard: {
    width: "48.5%",
    height: 196,
    minHeight: 0,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    gap: 3,
    overflow: "hidden",
  },
  gridCardWide: {
    width: "100%",
  },
  cardTitle: {
    fontSize: 28 / 1.5,
    fontWeight: "800",
  },
  cardHeaderRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
  },
  cardAddTextButton: {
    paddingHorizontal: 2,
    paddingVertical: 2,
  },
  cardAddText: {
    fontSize: 28 / 1.5,
    lineHeight: 30 / 1.5,
    fontWeight: "800",
  },
  cardSubtitle: {
    fontSize: 14,
    marginBottom: 2,
  },
  emptyHint: {
    fontSize: 14,
  },
  gridCardBody: {
    flex: 1,
    minHeight: 0,
    marginTop: 4,
  },
  gridCardScroll: {
    flex: 1,
    minHeight: 0,
  },
  gridCardScrollContent: {
    paddingBottom: 4,
    paddingRight: 4,
    gap: 2,
  },
  todoRow: {
    paddingVertical: 4,
    paddingHorizontal: 0,
    borderBottomWidth: 0,
    backgroundColor: "transparent",
  },
  todoText: {
    fontSize: 14,
    fontWeight: "600",
  },
  todoEditInput: {
    minHeight: 18,
    paddingVertical: 0,
    paddingHorizontal: 0,
    fontSize: 14,
    fontWeight: "600",
  },
  gridDeleteAction: {
    minWidth: 62,
    borderRadius: 14,
    marginLeft: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(111, 41, 20, 0.9)",
    borderWidth: 1,
    borderColor: "rgba(111, 41, 20, 0.5)",
  },
  gridDeleteActionText: {
    color: "#F7ECE0",
    fontSize: 12,
    fontWeight: "700",
  },
  homeFocusBlock: {
    gap: 8,
    paddingTop: 4,
  },
  homeFocusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.1)",
  },
  homeFocusCategory: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: "800",
  },
  homeFocusText: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "600",
  },
  assistantScreen: {
    gap: 16,
  },
  assistantIntro: {
    gap: 4,
  },
  assistantIntroText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  assistantQuickRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  assistantQuickChip: {
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    paddingHorizontal: 10,
    paddingVertical: 7,
    backgroundColor: "rgba(245, 241, 233, 0.45)",
  },
  assistantQuickChipText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  assistantFeed: {
    gap: 14,
    paddingTop: 4,
  },
  assistantMessageRow: {
    gap: 4,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.08)",
  },
  assistantMessageRowUser: {
    alignItems: "flex-end",
  },
  assistantTaskList: {
    gap: 8,
  },
  assistantTaskListLabel: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1.2,
  },
  assistantTaskRow: {
    paddingVertical: 4,
  },
  assistantTaskBody: {
    gap: 4,
  },
  assistantTaskTitle: {
    color: palette.ink,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: "800",
  },
  assistantTaskMeta: {
    color: palette.inkSoft,
    fontSize: 12,
    lineHeight: 17,
  },
  assistantMessageLabel: {
    color: palette.inkSoft,
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.4,
  },
  assistantMessageText: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 23,
  },
  assistantMessageTextUser: {
    color: palette.accent,
    textAlign: "right",
  },
  assistantMessageTextPlan: {
    lineHeight: 24,
  },
  listScreen: {
    position: "relative",
    gap: 18,
  },
  listBlankSaver: {
    ...StyleSheet.absoluteFillObject,
  },
  historyHeader: {
    gap: 4,
  },
  historyHeaderText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 20,
  },
  captureCard: {
    borderRadius: 28,
    padding: 16,
    gap: 12,
    backgroundColor: "rgba(235, 226, 212, 0.9)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  captureHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
  },
  captureHeaderText: {
    flex: 1,
    gap: 6,
  },
  captureTime: {
    fontSize: 12,
    letterSpacing: 0.6,
    color: palette.inkSoft,
    fontWeight: "700",
  },
  captureTranscript: {
    fontSize: 20,
    lineHeight: 28,
    color: palette.ink,
    fontWeight: "800",
  },
  captureCount: {
    color: palette.inkSoft,
    fontSize: 13,
    fontWeight: "700",
  },
  captureSection: {
    gap: 10,
    paddingBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.12)",
  },
  captureMetaRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 12,
  },
  captureItems: {
    gap: 0,
  },
  captureEmptyText: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
  listItemCard: {
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.12)",
  },
  listItemCardForeground: {
    zIndex: 1,
  },
  listItemPressable: {
    gap: 0,
  },
  listItemTop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 8,
  },
  listItemStatusMark: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 1.5,
    marginTop: 2,
  },
  listItemStatusMarkConfirmed: {
    backgroundColor: "rgba(196, 74, 0, 0.16)",
  },
  listItemTextWrap: {
    flex: 1,
    gap: 2,
  },
  listItemTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 6,
    position: "relative",
  },
  listCategoryButton: {
    paddingVertical: 0,
    paddingRight: 0,
  },
  listCategoryText: {
    color: palette.inkMuted,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
  },
  categoryDropdownMenu: {
    position: "absolute",
    top: 24,
    left: 0,
    minWidth: 112,
    borderRadius: 12,
    padding: 6,
    gap: 4,
    backgroundColor: "rgba(249, 245, 238, 0.98)",
    borderWidth: 1,
    borderColor: palette.border,
    zIndex: 4,
  },
  categoryDropdownOption: {
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(245, 241, 233, 0.7)",
  },
  categoryDropdownOptionActive: {
    backgroundColor: "rgba(196, 74, 0, 0.14)",
  },
  categoryDropdownOptionText: {
    fontSize: 13,
    fontWeight: "800",
  },
  listItemTitle: {
    color: palette.ink,
    flex: 1,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
  },
  listInlineInput: {
    flex: 1,
    minHeight: 17,
    paddingVertical: 0,
    paddingHorizontal: 0,
    color: palette.ink,
    fontSize: 13,
    lineHeight: 17,
    fontWeight: "600",
  },
  listItemOriginalText: {
    color: palette.inkMuted,
    fontSize: 10,
    lineHeight: 14,
  },
  listItemMeta: {
    color: palette.inkSoft,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: "600",
  },
  expandMark: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  listActions: {
    flexDirection: "row",
    gap: 2,
    justifyContent: "flex-end",
    alignSelf: "flex-start",
    marginRight: -2,
    paddingTop: 0,
  },
  iconActionButton: {
    minWidth: 22,
    height: 22,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 2,
  },
  iconActionText: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  iconDeleteButton: {
  },
  iconDeleteText: {
    color: "#8C4325",
  },
  iconConfirmButton: {
  },
  iconConfirmText: {
    color: palette.accent,
  },
  iconConfirmButtonDone: {
    opacity: 0.42,
  },
  iconConfirmTextDone: {
    color: palette.inkSoft,
  },
  detailLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    letterSpacing: 0.6,
    fontWeight: "700",
  },
  detailText: {
    color: palette.inkMuted,
    fontSize: 12,
    lineHeight: 16,
  },
  editBox: {
    gap: 10,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 10,
  },
  editInput: {
    minHeight: 48,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: palette.inputBg,
    color: palette.ink,
    borderWidth: 1,
    borderColor: palette.border,
    fontSize: 16,
  },
  saveEditButton: {
    alignSelf: "flex-start",
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: palette.accent,
  },
  saveEditButtonText: {
    color: "#F3E7D8",
    fontSize: 14,
    fontWeight: "800",
  },
  fab: {
    position: "absolute",
    right: 30,
    width: 62,
    height: 62,
    borderRadius: 31,
    backgroundColor: palette.accent,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 10,
  },
  fabRecording: {
    backgroundColor: palette.accentPressed,
  },
  fabText: {
    color: "#F3E7D8",
    fontSize: 36,
    marginTop: -2,
    fontWeight: "500",
  },
  voiceComposer: {
    position: "absolute",
    left: 18,
    right: 18,
    zIndex: 12,
    borderRadius: 30,
    padding: 18,
    gap: 12,
    backgroundColor: "rgba(239, 231, 218, 0.98)",
    borderWidth: 1,
    borderColor: palette.border,
    elevation: 8,
  },
  voiceComposerDock: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 12,
    paddingTop: 12,
    paddingHorizontal: 18,
    gap: 12,
    backgroundColor: palette.appBg,
    borderTopWidth: 1,
    borderTopColor: palette.border,
  },
  voiceComposerBackdrop: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 11,
  },
  manualComposerOptions: {
    gap: 8,
  },
  manualComposerRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  manualComposerChip: {
    minHeight: 32,
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(245, 241, 233, 0.6)",
  },
  manualComposerChipActive: {
    backgroundColor: "rgba(196, 74, 0, 0.12)",
    borderColor: "rgba(196, 74, 0, 0.24)",
  },
  manualComposerChipText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  voiceComposerInput: {
    flex: 1,
    minHeight: 42,
    maxHeight: 140,
    borderRadius: 0,
    paddingHorizontal: 4,
    paddingVertical: 6,
    paddingRight: 0,
    backgroundColor: "transparent",
    borderWidth: 0,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  calendarPanel: {
    borderRadius: 20,
    padding: 12,
    backgroundColor: "rgba(245, 241, 233, 0.72)",
    borderWidth: 1,
    borderColor: palette.border,
    gap: 10,
  },
  calendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  calendarNavButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 74, 0, 0.1)",
  },
  calendarHeaderText: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
  },
  calendarWeekRow: {
    flexDirection: "row",
  },
  calendarWeekLabel: {
    flex: 1,
    textAlign: "center",
    color: palette.inkSoft,
    fontSize: 12,
    fontWeight: "700",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 8,
  },
  calendarDayPlaceholder: {
    width: "14.2857%",
    height: 38,
  },
  calendarDayButton: {
    width: "14.2857%",
    height: 38,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 19,
  },
  calendarDayButtonActive: {
    backgroundColor: palette.accent,
  },
  calendarDayText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "700",
  },
  calendarDayTextToday: {
    color: palette.accent,
  },
  calendarDayTextActive: {
    color: "#F3E7D8",
  },
  voiceStatusBanner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingTop: 2,
  },
  voiceStatusBannerError: {
    paddingVertical: 6,
  },
  voiceStatusText: {
    color: palette.accent,
    fontSize: 12,
    fontWeight: "700",
  },
  voiceStatusTextError: {
    color: "#8C4325",
  },
  voiceInputRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 8,
  },
  voiceInputContainer: {
    flex: 1,
    flexDirection: "row",
    alignItems: "flex-end",
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 22,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: "rgba(245, 241, 233, 0.48)",
  },
  voiceInlineSendButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 4,
    marginBottom: 2,
    backgroundColor: "rgba(245, 241, 233, 0.8)",
  },
  voiceInlineSendButtonActive: {
    backgroundColor: palette.accent,
  },
  voiceRecordButton: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(196, 74, 0, 0.4)",
    backgroundColor: palette.accent,
  },
  voiceRecordButtonActive: {
    backgroundColor: palette.accentPressed,
  },
  voiceRecordButtonText: {
    color: "#F3E7D8",
    fontSize: 36,
    lineHeight: 36,
    fontWeight: "500",
    marginTop: -2,
  },
  voiceSubmitButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 74, 0, 0.12)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  voiceSubmitButtonText: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 18,
  },
  topNav: {
    marginHorizontal: 18,
    marginTop: 10,
  },
  topNavTabs: {
    width: "100%",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    paddingHorizontal: 2,
    paddingVertical: 2,
    marginHorizontal: -4,
  },
  navItem: {
    width: "33.3333%",
    alignItems: "center",
    paddingHorizontal: 4,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "transparent",
  },
  navItemActive: {
    borderBottomColor: "rgba(196, 74, 0, 0.34)",
  },
  navText: {
    fontSize: 15,
    color: palette.inkSoft,
    fontWeight: "500",
  },
  navTextActive: {
    color: palette.accent,
    fontWeight: "700",
  },
  todayScreen: {
    gap: 0,
  },
  todayEmptyText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 20,
  },
  todayList: {
    marginTop: 0,
  },
  todayRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.12)",
  },
  todayRowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  todayRowMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1.5,
    borderColor: palette.accent,
  },
  todayRowTitle: {
    color: palette.ink,
    flex: 1,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  todayEditInput: {
    flex: 1,
    minHeight: 22,
    paddingHorizontal: 0,
    paddingVertical: 0,
    backgroundColor: "transparent",
    color: palette.ink,
    borderWidth: 0,
    fontSize: 16,
    lineHeight: 22,
  },
  todayRowActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 6,
  },
  todayActionButton: {
    minWidth: 24,
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  todayActionText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  todayDeleteButton: {
  },
  todayDeleteText: {
    color: "#8C4325",
  },
  simplePanel: {
    borderRadius: 24,
    backgroundColor: "rgba(226, 216, 200, 0.85)",
    padding: 18,
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
  },
  simpleItem: {
    color: palette.inkMuted,
    fontSize: 16,
    lineHeight: 22,
  },
  calendarScreen: {
    gap: 18,
  },
  planCalendarWrap: {
    alignSelf: "center",
    width: "100%",
    maxWidth: 340,
    gap: 10,
  },
  planCalendarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 4,
  },
  planCalendarNavButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  planCalendarHeaderText: {
    color: palette.ink,
    fontSize: 16,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  planCalendarWeekRow: {
    flexDirection: "row",
    paddingHorizontal: 2,
  },
  planCalendarWeekLabel: {
    width: "14.2857%",
    textAlign: "center",
    color: palette.inkSoft,
    fontSize: 12,
    fontWeight: "700",
  },
  planCalendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    rowGap: 4,
  },
  planCalendarDayPlaceholder: {
    width: "14.2857%",
    height: 46,
  },
  planCalendarDayButton: {
    width: "14.2857%",
    height: 46,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 5,
    borderRadius: 14,
  },
  planCalendarDayButtonActive: {
    backgroundColor: palette.accent,
  },
  planCalendarDayText: {
    color: palette.inkMuted,
    fontSize: 14,
    fontWeight: "700",
    lineHeight: 18,
  },
  planCalendarDayTextToday: {
    color: palette.accent,
  },
  planCalendarDayTextActive: {
    color: "#F3E7D8",
  },
  planCalendarDayMarkerSlot: {
    minHeight: 12,
    marginTop: 5,
    alignItems: "center",
    justifyContent: "center",
  },
  planAgendaSection: {
    gap: 10,
  },
  planAgendaHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  planAgendaHeaderText: {
    color: palette.ink,
    fontSize: 18,
    fontWeight: "800",
    letterSpacing: 0.3,
  },
  planAgendaAddButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  planQuickAddRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingBottom: 4,
  },
  planQuickAddInput: {
    flex: 1,
    minHeight: 22,
    paddingHorizontal: 0,
    paddingVertical: 0,
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.16)",
  },
  planQuickAddSubmitButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(245, 241, 233, 0.78)",
  },
  planQuickAddSubmitButtonActive: {
    backgroundColor: palette.accent,
  },
  planAgendaList: {
    gap: 0,
  },
  planAgendaRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.1)",
  },
  planAgendaRowMarker: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginTop: 7,
  },
  planAgendaRowBody: {
    flex: 1,
  },
  planAgendaTitle: {
    color: palette.ink,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: "600",
  },
  planAgendaEmptyText: {
    color: palette.inkSoft,
    fontSize: 14,
    lineHeight: 20,
    paddingVertical: 6,
  },
  calendarPreviewList: {
    gap: 0,
  },
  calendarPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(53, 47, 39, 0.1)",
  },
  calendarPreviewDate: {
    width: 48,
    color: palette.accent,
    fontSize: 13,
    fontWeight: "800",
  },
  calendarPreviewText: {
    flex: 1,
    color: palette.ink,
    fontSize: 16,
    fontWeight: "600",
  },
});
