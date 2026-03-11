import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
} from "expo-audio";
import { StatusBar } from "expo-status-bar";
import { MaterialCommunityIcons } from "@expo/vector-icons";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, useState } from "react";
import {
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

type Tab = "inbox" | "list" | "today" | "plan" | "settings";
type Category = "work" | "shopping" | "relationships" | "life";
type CertaintyTier = "confirmed" | "direct" | "suggestion";
type VoiceComposerTarget = "capture" | "ask";
type VoiceInputTarget = "query" | "composer";

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
  sourceCaptureId: string;
  sourceSnippet: string;
  reasoning: string;
  createdAt: string;
};

type VoiceComposerState =
  | "idle"
  | "listening"
  | "processing"
  | "error";

const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8787";

const palette = {
  appBg: "#D8CEBE",
  ink: "#2F2D29",
  inkMuted: "#6E675B",
  inkSoft: "#8C8476",
  inputBg: "#E0D7C8",
  panelWork: "#B39670",
  panelShopping: "#C7BCAB",
  panelRelationships: "#DDD6CB",
  panelLife: "#747758",
  panelLifeInk: "#ECE6DA",
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
    title: "去超市买番茄",
    category: "shopping",
    certainty: "direct",
    sourceCaptureId: "capture-1",
    sourceSnippet: "番茄也没了",
    reasoning: "从原话直接提炼出的补货事项。",
    createdAt: "2026-03-10T09:11:00.000Z",
  },
  {
    id: "item-2",
    title: "买点蔬菜",
    category: "shopping",
    certainty: "suggestion",
    sourceCaptureId: "capture-1",
    sourceSnippet: "最近吃蔬菜很少",
    reasoning: "根据饮食习惯做出的弱建议。",
    createdAt: "2026-03-10T09:11:30.000Z",
  },
  {
    id: "item-3",
    title: "准备生日礼物",
    category: "relationships",
    certainty: "direct",
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
    title: "生活 / 出行",
    panelColor: palette.panelLife,
    inkColor: palette.panelLifeInk,
    mutedInkColor: "rgba(236,230,218,0.82)",
    rowColor: palette.rowBgDark,
    rowInkColor: palette.panelLifeInk,
  },
];

const tabLabel: Record<Tab, string> = {
  inbox: "首页",
  list: "清单",
  today: "今天",
  plan: "计划",
  settings: "设置",
};

const certaintyLabel: Record<CertaintyTier, string> = {
  confirmed: "100%",
  direct: "70%",
  suggestion: "40%",
};

const certaintyHint: Record<CertaintyTier, string> = {
  confirmed: "已确认",
  direct: "高置信",
  suggestion: "弱建议",
};

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
      item.category === "life") &&
    (item.certainty === "confirmed" ||
      item.certainty === "direct" ||
      item.certainty === "suggestion") &&
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
  }
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
      return "work";
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

function audioMimeTypeFromUri(uri: string): string {
  const lowered = uri.toLowerCase();

  if (lowered.endsWith(".wav")) return "audio/wav";
  if (lowered.endsWith(".webm")) return "audio/webm";
  if (lowered.endsWith(".caf")) return "audio/x-caf";
  if (lowered.endsWith(".mp3")) return "audio/mpeg";
  if (lowered.endsWith(".aac")) return "audio/aac";
  return "audio/mp4";
}

function isSameDay(lhs: Date, rhs: Date): boolean {
  return (
    lhs.getFullYear() === rhs.getFullYear() &&
    lhs.getMonth() === rhs.getMonth() &&
    lhs.getDate() === rhs.getDate()
  );
}

function formatDueDateLabel(date: Date): string {
  const today = new Date();
  if (isSameDay(date, today)) return "今天";
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

function formatCaptureTime(iso: string): string {
  const date = new Date(iso);
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeTaskFromAI(
  task: {
    title?: string;
    category?: string;
    confidenceScore?: number;
    sourceSnippet?: string;
    reasoning?: string;
  },
  context: {
    captureId: string;
    createdAt: string;
    transcript: string;
  },
): TodoItem {
  return {
    id: makeId("item"),
    title: typeof task.title === "string" && task.title.trim().length > 0 ? task.title.trim() : "待确认事项",
    category: normalizeCategory(task.category),
    certainty: normalizeCertainty(task.confidenceScore),
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
      return rawCategory;
    case "travel":
    case "life":
    case "triage":
    default:
      return "life";
  }
}

function normalizeCertainty(rawScore: number | undefined): CertaintyTier {
  if (typeof rawScore === "number" && rawScore >= 0.75) {
    return "direct";
  }
  return "suggestion";
}

function inferLocalTasks(transcript: string, captureId: string, createdAt: string): TodoItem[] {
  const lowered = transcript.replaceAll("，", ",").replaceAll("。", ",");
  const tasks: TodoItem[] = [];

  if (lowered.includes("番茄")) {
    tasks.push({
      id: makeId("item"),
      title: "去超市买番茄",
      category: "shopping",
      certainty: "direct",
      sourceCaptureId: captureId,
      sourceSnippet: "番茄没了",
      reasoning: "从原话直接提炼出的补货事项。",
      createdAt,
    });
  }

  if (lowered.includes("蔬菜")) {
    tasks.push({
      id: makeId("item"),
      title: "买点蔬菜",
      category: "shopping",
      certainty: lowered.includes("买") ? "direct" : "suggestion",
      sourceCaptureId: captureId,
      sourceSnippet: "最近吃蔬菜很少",
      reasoning: "根据饮食和补货语义生成的事项。",
      createdAt: new Date(Date.parse(createdAt) + 1000).toISOString(),
    });
  }

  if (lowered.includes("生日")) {
    tasks.push({
      id: makeId("item"),
      title: "准备生日礼物",
      category: "relationships",
      certainty: "direct",
      sourceCaptureId: captureId,
      sourceSnippet: "下个月生日",
      reasoning: "生日事件通常需要提前准备礼物或安排。",
      createdAt: new Date(Date.parse(createdAt) + 2000).toISOString(),
    });
  }

  if (lowered.includes("报价") || lowered.includes("客户") || lowered.includes("会议")) {
    tasks.push({
      id: makeId("item"),
      title: "跟进工作事项",
      category: "work",
      certainty: "direct",
      sourceCaptureId: captureId,
      sourceSnippet: transcript,
      reasoning: "从工作关键词中识别出的直接待办。",
      createdAt: new Date(Date.parse(createdAt) + 3000).toISOString(),
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      id: makeId("item"),
      title: transcript.length > 16 ? `${transcript.slice(0, 16)}…` : transcript,
      category: "life",
      certainty: "direct",
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
  const audioRecorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [activeTab, setActiveTab] = useState<Tab>("inbox");
  const [query, setQuery] = useState("");
  const [captures, setCaptures] = useState<CaptureRecord[]>(seedCaptures);
  const [items, setItems] = useState<TodoItem[]>(seedItems);
  const [isRecording, setIsRecording] = useState(false);
  const [isVoiceProcessing, setIsVoiceProcessing] = useState(false);
  const [activeVoiceInputTarget, setActiveVoiceInputTarget] = useState<VoiceInputTarget | null>(null);
  const [isVoiceComposerOpen, setIsVoiceComposerOpen] = useState(false);
  const [voiceComposerTarget, setVoiceComposerTarget] =
    useState<VoiceComposerTarget>("capture");
  const [voiceDraft, setVoiceDraft] = useState("");
  const [selectedDueDate, setSelectedDueDate] = useState<Date>(() => new Date());
  const [isDueDatePickerOpen, setIsDueDatePickerOpen] = useState(false);
  const [voiceComposerState, setVoiceComposerState] = useState<VoiceComposerState>("idle");
  const [voiceHint, setVoiceHint] = useState(defaultVoiceHint("capture"));
  const [askResult, setAskResult] = useState("");
  const [isAsking, setIsAsking] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState("");
  const [editingGridItemId, setEditingGridItemId] = useState<string | null>(null);
  const [editingGridTitle, setEditingGridTitle] = useState("");
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [hasHydratedStorage, setHasHydratedStorage] = useState(false);
  const voiceDraftRef = useRef("");

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

  const grouped = useMemo(() => {
    const ordered = [...items].sort((lhs, rhs) => {
      const lhsWeight = certaintyWeight(lhs.certainty);
      const rhsWeight = certaintyWeight(rhs.certainty);
      if (lhsWeight === rhsWeight) {
        return rhs.createdAt.localeCompare(lhs.createdAt);
      }
      return rhsWeight - lhsWeight;
    });

    return {
      work: ordered.filter((it) => it.category === "work"),
      shopping: ordered.filter((it) => it.category === "shopping"),
      relationships: ordered.filter((it) => it.category === "relationships"),
      life: ordered.filter((it) => it.category === "life"),
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

  const dueDateOptions = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    return Array.from({ length: 14 }, (_value, index) => {
      const nextDate = new Date(start);
      nextDate.setDate(start.getDate() + index);
      return nextDate;
    });
  }, []);

  const isQueryRecording = isRecording && activeVoiceInputTarget === "query";
  const isQueryVoiceProcessing = isVoiceProcessing && activeVoiceInputTarget === "query";
  const isComposerRecording = isRecording && activeVoiceInputTarget === "composer";
  const isComposerVoiceProcessing = isVoiceProcessing && activeVoiceInputTarget === "composer";

  const runRecall = (input: string = query) => {
    const normalized = input.trim();
    if (!normalized) return;

    setQuery(normalized);

    const matches = items.filter((item) => {
      const capture = capturesById[item.sourceCaptureId];
      return (
        item.title.includes(normalized) ||
        item.sourceSnippet.includes(normalized) ||
        capture?.transcript.includes(normalized)
      );
    });

    if (matches.length > 0) {
      setAskResult(`你之前提过：${matches.slice(0, 3).map((item) => item.title).join("、")}`);
      return;
    }

    const shoppingItems = items.filter((item) => item.category === "shopping");
    if (normalized.includes("买") || normalized.includes("忘")) {
      setAskResult(
        shoppingItems.length > 0
          ? `购物相关你提过：${shoppingItems.slice(0, 3).map((item) => item.title).join("、")}`
          : "还没有找到明确的购物事项。",
      );
      return;
    }

    setAskResult("现在还没有找到明显匹配，你可以去清单页回看原话。");
  };

  const transcribeRecording = async (uri: string, target: VoiceInputTarget) => {
    const fileName = uri.split("/").pop() ?? `voice-${Date.now()}.m4a`;
    const form = new FormData();

    form.append("file", {
      uri,
      name: fileName,
      type: audioMimeTypeFromUri(uri),
    } as unknown as Blob);

    setIsVoiceProcessing(true);
    if (target === "composer") {
      setVoiceComposerState("processing");
      setVoiceHint(processingVoiceHint(voiceComposerTarget));
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/transcribe`, {
        method: "POST",
        body: form,
      });
      const payload = (await response.json()) as
        | {
            transcript?: string;
            error?: string;
            detail?: string;
          }
        | undefined;

      if (!response.ok || payload?.error || !payload?.transcript) {
        const detail = payload?.detail ?? payload?.error ?? "转写失败";
        throw new Error(detail);
      }

      const normalized = payload.transcript.trim();
      if (target === "query") {
        setAskResult("");
        setQuery((current) => {
          const trimmedCurrent = current.trim();
          if (normalized.length === 0) return trimmedCurrent;
          return trimmedCurrent.length > 0 ? `${trimmedCurrent} ${normalized}` : normalized;
        });
      } else {
        const currentDraft = voiceDraftRef.current.trim();
        const mergedDraft =
          normalized.length === 0
            ? currentDraft
            : currentDraft.length > 0
              ? `${currentDraft}\n${normalized}`
              : normalized;

        voiceDraftRef.current = mergedDraft;
        setVoiceDraft(mergedDraft);
        setVoiceComposerState("idle");
        setVoiceHint(
          mergedDraft.length > 0
            ? pausedVoiceHint(voiceComposerTarget)
            : "没有听到内容，可以再试一次。",
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "语音转录失败";
      if (target === "query") {
        setAskResult(`语音转录失败: ${message}`);
      } else {
        setVoiceComposerState("error");
        setVoiceHint(`语音转录失败: ${message}`);
      }
    } finally {
      setIsVoiceProcessing(false);
      setActiveVoiceInputTarget(null);
    }
  };

  const organizeTranscript = async (input: string) => {
    const normalized = input.trim();
    if (!normalized) return;

    const captureId = makeId("capture");
    const createdAt = new Date().toISOString();
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
          transcript: normalized,
          nowISO8601: createdAt,
        }),
      });
      const payload = (await response.json()) as
        | {
            tasks?: Array<{
              title?: string;
              category?: string;
              confidenceScore?: number;
              sourceSnippet?: string;
              reasoning?: string;
            }>;
            error?: string;
          }
        | undefined;

      if (!response.ok || payload?.error || !payload?.tasks) {
        const fallbackItems = inferLocalTasks(normalized, captureId, createdAt);
        setItems((current) => [...fallbackItems, ...current]);
        setAskResult(
          payload?.error
            ? `后端暂不可用，已本地整理 ${fallbackItems.length} 条事项。`
            : `已本地整理 ${fallbackItems.length} 条事项。`,
        );
        setActiveTab("list");
        return;
      }

      const nextItems = payload.tasks.map((task, index) =>
        normalizeTaskFromAI(task, {
          captureId,
          createdAt: new Date(Date.now() + index * 1000).toISOString(),
          transcript: normalized,
        }),
      );

      setItems((current) => [...nextItems, ...current]);
      setAskResult(
        nextItems.length > 0 ? `AI 已整理 ${nextItems.length} 条事项。` : "AI 暂时没有拆出事项。",
      );
      setActiveTab("list");
    } catch (_error) {
      const fallbackItems = inferLocalTasks(normalized, captureId, createdAt);
      setItems((current) => [...fallbackItems, ...current]);
      setAskResult(`网络失败，已本地整理 ${fallbackItems.length} 条事项。`);
      setActiveTab("list");
    } finally {
      setIsAsking(false);
    }
  };

  const addItemFromInboxCard = (category: Category) => {
    const createdAt = new Date().toISOString();
    const captureId = makeId("capture");
    const itemId = makeId("item");
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
    setExpandedItemId((current) => (current === itemId ? null : current));
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

  const deleteItem = (itemId: string) => {
    setItems((current) => current.filter((item) => item.id !== itemId));
    if (editingItemId === itemId) setEditingItemId(null);
    if (editingGridItemId === itemId) setEditingGridItemId(null);
    if (expandedItemId === itemId) setExpandedItemId(null);
  };

  const beginEditItem = (item: TodoItem) => {
    setEditingItemId(item.id);
    setEditingTitle(item.title);
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

  const toggleOriginalForItem = (itemId: string) => {
    setExpandedItemId((current) => (current === itemId ? null : itemId));
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

  const stopNativeRecording = async (shouldTranscribe: boolean) => {
    const target = activeVoiceInputTarget;

    try {
      await audioRecorder.stop();
    } catch (_error) {
      // Ignore recorder stop races when closing quickly.
    } finally {
      setIsRecording(false);
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
      }).catch(() => undefined);
    }

    if (!shouldTranscribe) {
      setActiveVoiceInputTarget(null);
      return;
    }

    const recorderUri = audioRecorder.uri ?? audioRecorder.getStatus().url;
    if (!recorderUri) {
      if (target === "query") {
        setAskResult("没有拿到录音文件，可以再试一次。");
      } else if (target === "composer") {
        setVoiceComposerState("error");
        setVoiceHint("没有拿到录音文件，可以再试一次。");
      }
      setActiveVoiceInputTarget(null);
      return;
    }

    if (!target) {
      setActiveVoiceInputTarget(null);
      return;
    }

    await transcribeRecording(recorderUri, target);
  };

  const startNativeRecording = async (target: VoiceInputTarget) => {
    try {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        if (target === "query") {
          setAskResult("没有麦克风权限，请先允许录音。");
        } else if (target === "composer") {
          setVoiceComposerState("error");
          setVoiceHint("没有麦克风权限，请先允许录音。");
        }
        return;
      }

      await setAudioModeAsync({
        allowsRecording: true,
        playsInSilentMode: true,
      });
      await audioRecorder.prepareToRecordAsync();
      audioRecorder.record();
      if (target === "query") {
        setAskResult("");
      }
      setActiveVoiceInputTarget(target);
      setIsRecording(true);
      if (target === "composer") {
        setVoiceComposerState("listening");
        setVoiceHint(listeningVoiceHint(voiceComposerTarget));
      }
    } catch (error) {
      setActiveVoiceInputTarget(null);
      setIsRecording(false);
      const message = error instanceof Error ? error.message : "无法开始录音";
      if (target === "query") {
        setAskResult(`语音录音失败: ${message}`);
      } else if (target === "composer") {
        setVoiceComposerState("error");
        setVoiceHint(`语音录音失败: ${message}`);
      }
    }
  };

  const toggleComposerRecording = () => {
    if (isVoiceProcessing) return;

    if (isComposerRecording) {
      void stopNativeRecording(true);
      return;
    }

    void startNativeRecording("composer");
  };

  const submitVoiceDraft = () => {
    const normalized = voiceDraft.trim();
    if (!normalized) return;

    setIsVoiceComposerOpen(false);

    const dueDateNote = isSameDay(selectedDueDate, new Date())
      ? ""
      : `（计划日期：${selectedDueDate.toISOString().slice(0, 10)}）`;
    const payload = dueDateNote.length > 0 ? `${normalized} ${dueDateNote}` : normalized;
    void organizeTranscript(payload);
  };

  const startVoiceComposer = (target: VoiceComposerTarget = "capture") => {
    voiceDraftRef.current = "";
    setVoiceDraft("");
    setVoiceComposerTarget(target);
    setSelectedDueDate(new Date());
    setIsDueDatePickerOpen(false);
    setVoiceComposerState("idle");
    setVoiceHint(defaultVoiceHint(target));
    setIsVoiceComposerOpen(true);
  };

  useEffect(() => {
    if (isVoiceComposerOpen) return;

    if (activeVoiceInputTarget === "composer" && isRecording) {
      void stopNativeRecording(false);
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
      void stopNativeRecording(false);
    };
  }, []);

  const renderInbox = () => (
    <>
      <View style={styles.queryBox}>
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="我是不是忘了买什么？"
          placeholderTextColor={palette.inkSoft}
          style={styles.queryInput}
        />
        <Pressable
          style={[styles.askButton, isQueryVoiceProcessing ? styles.askButtonDisabled : null]}
          disabled={isQueryVoiceProcessing}
          onPress={() => {
            if (isQueryRecording) {
              void stopNativeRecording(true);
              return;
            }

            void startNativeRecording("query");
          }}
        >
          {isQueryVoiceProcessing ? (
            <Text style={styles.askButtonText}>...</Text>
          ) : isQueryRecording ? (
            <MaterialCommunityIcons name="stop" size={20} color={palette.accent} />
          ) : (
            <MaterialCommunityIcons
              name="microphone-outline"
              size={22}
              color={palette.accent}
            />
          )}
        </Pressable>
        <Pressable
          style={[
            styles.searchButton,
            query.trim().length === 0 ? styles.askButtonDisabled : null,
          ]}
          disabled={query.trim().length === 0}
          onPress={() => {
            runRecall();
          }}
        >
          <MaterialCommunityIcons
            name="magnify-plus-outline"
            size={20}
            color={palette.inkSoft}
          />
        </Pressable>
      </View>

      {askResult.length > 0 ? (
        <View style={styles.resultBox}>
          <Text style={styles.resultText}>{askResult}</Text>
        </View>
      ) : null}

      <View style={styles.grid}>
        {clusterOrder.map((cluster) => (
          <View
            key={cluster.key}
            style={[
              styles.gridCard,
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
              grouped[cluster.key].slice(0, 2).map((it) => (
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
                      { backgroundColor: cluster.rowColor },
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
              ))
            )}
          </View>
        ))}
      </View>
    </>
  );

  const renderList = () => (
    <View style={styles.listScreen}>
      {listItems.length === 0 ? (
        <View style={styles.simplePanel}>
          <Text style={styles.title}>清单是空的</Text>
          <Text style={styles.simpleItem}>点加号说一句，系统会保存原话并自动整理事项。</Text>
        </View>
      ) : (
        listItems.map((item) => {
          const isEditing = editingItemId === item.id;
          const isExpanded = expandedItemId === item.id;
          const shouldShowOriginal = item.certainty !== "confirmed" || isExpanded;
          const sourceCapture = capturesById[item.sourceCaptureId];
          const chipAppearance = categoryChipAppearance(item.category);

          return (
            <View key={item.id} style={[styles.listItemCard, { opacity: itemOpacity(item.certainty) }]}>
              <Pressable
                style={styles.listItemPressable}
                onPress={() => {
                  if (item.certainty === "confirmed") {
                    toggleOriginalForItem(item.id);
                  }
                }}
              >
                <View style={styles.listItemTop}>
                  <View style={styles.listItemTextWrap}>
                    <View style={styles.listItemTitleRow}>
                      <Pressable
                        style={[
                          styles.categoryChipButton,
                          {
                            backgroundColor: chipAppearance.backgroundColor,
                            borderColor: palette.border,
                          },
                        ]}
                        onPress={() => cycleItemCategory(item.id)}
                      >
                        <Text
                          style={[
                            styles.categoryChipButtonText,
                            { color: chipAppearance.textColor },
                          ]}
                        >
                          {categoryTitle(item.category)}
                        </Text>
                      </Pressable>
                      <Text style={styles.listItemTitle}>{item.title}</Text>
                    </View>
                    <Text style={styles.listItemMeta}>
                      {certaintyHint[item.certainty]} · {certaintyLabel[item.certainty]} ·{" "}
                      {formatCaptureTime(item.createdAt)}
                    </Text>
                  </View>
                </View>

                {shouldShowOriginal ? (
                  <View style={styles.listDetails}>
                    <Text style={styles.detailLabel}>原话</Text>
                    <Text style={styles.detailText}>{sourceCapture?.transcript ?? "暂无原话"}</Text>
                  </View>
                ) : null}
              </Pressable>

              <View style={styles.listActions}>
                <Pressable style={styles.iconActionButton} onPress={() => beginEditItem(item)}>
                  <Text style={styles.iconActionText}>✎</Text>
                </Pressable>
                <Pressable
                  style={[styles.iconActionButton, styles.iconDeleteButton]}
                  onPress={() => deleteItem(item.id)}
                >
                  <Text style={[styles.iconActionText, styles.iconDeleteText]}>✕</Text>
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
                  <Text
                    style={[
                      styles.iconActionText,
                      styles.iconConfirmText,
                      item.certainty === "confirmed" ? styles.iconConfirmTextDone : null,
                    ]}
                  >
                    ✓
                  </Text>
                </Pressable>
              </View>

              {isEditing ? (
                <View style={styles.editBox}>
                  <TextInput
                    value={editingTitle}
                    onChangeText={setEditingTitle}
                    placeholder="修改事项标题"
                    placeholderTextColor={palette.inkSoft}
                    style={styles.editInput}
                  />
                  <Pressable style={styles.saveEditButton} onPress={() => saveEditItem(item.id)}>
                    <Text style={styles.saveEditButtonText}>保存</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </View>
  );

  const renderToday = () => {
    const todayItems = items.filter((item) => item.certainty !== "suggestion");

    return (
      <View style={styles.simplePanel}>
        <Text style={styles.title}>今天要做</Text>
        {todayItems.length === 0 ? (
          <Text style={styles.simpleItem}>今天还没有待办事项。</Text>
        ) : (
          <View style={styles.todayList}>
            {todayItems.map((it) => {
              const isEditing = editingItemId === it.id;

              return (
                <View key={it.id} style={styles.todayRow}>
                  {isEditing ? (
                    <TextInput
                      value={editingTitle}
                      onChangeText={setEditingTitle}
                      placeholder="修改今天事项"
                      placeholderTextColor={palette.inkSoft}
                      style={styles.todayEditInput}
                    />
                  ) : (
                    <Text style={styles.todayRowTitle}>{it.title}</Text>
                  )}

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
                      <Text style={styles.todayActionText}>{isEditing ? "保存" : "编辑"}</Text>
                    </Pressable>
                    <Pressable
                      style={[styles.todayActionButton, styles.todayDeleteButton]}
                      onPress={() => deleteItem(it.id)}
                    >
                      <Text style={[styles.todayActionText, styles.todayDeleteText]}>删除</Text>
                    </Pressable>
                  </View>
                </View>
              );
            })}
          </View>
        )}
      </View>
    );
  };

  const renderPlan = () => (
    <View style={styles.simplePanel}>
      <Text style={styles.title}>日历计划</Text>
      <Text style={styles.simpleItem}>这里接日历视图（下一步可接 react-native-calendars）</Text>
    </View>
  );

  const renderSettings = () => (
    <View style={styles.simplePanel}>
      <Text style={styles.title}>设置</Text>
      <Text style={styles.simpleItem}>当前架构: Expo + TypeScript + Node TypeScript</Text>
      <Text style={styles.simpleItem}>后端地址: http://127.0.0.1:8787</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen} edges={["top", "bottom"]}>
      <StatusBar style="dark" />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={[
          styles.scrollContent,
          {
            paddingTop: 8,
            paddingBottom: 220 + insets.bottom,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {activeTab === "inbox" && renderInbox()}
        {activeTab === "list" && renderList()}
        {activeTab === "today" && renderToday()}
        {activeTab === "plan" && renderPlan()}
        {activeTab === "settings" && renderSettings()}
      </ScrollView>

      {isVoiceComposerOpen ? (
        <View style={[styles.voiceComposer, { bottom: 102 + insets.bottom }]}>
          <Pressable
            style={styles.voiceComposerCloseFloating}
            onPress={() => {
              setIsVoiceComposerOpen(false);
            }}
          >
            <Text style={styles.voiceComposerCloseText}>×</Text>
          </Pressable>
          <TextInput
            value={voiceDraft}
            onChangeText={(nextValue) => {
              voiceDraftRef.current = nextValue;
              setVoiceDraft(nextValue);
            }}
            placeholder={voiceComposerPlaceholder("capture")}
            placeholderTextColor={palette.inkSoft}
            multiline
            textAlignVertical="top"
            style={styles.voiceComposerInput}
          />

          <View style={styles.voiceComposerMetaRow}>
            <Pressable
              style={[
                styles.voiceMetaChip,
                styles.voiceMetaChipActive,
              ]}
              onPress={() => {
                setIsDueDatePickerOpen((current) => !current);
              }}
            >
              <Text style={styles.voiceMetaChipText}>{formatDueDateLabel(selectedDueDate)}</Text>
            </Pressable>
            <Pressable style={styles.voiceMetaChip}>
              <Text style={styles.voiceMetaChipText}>附件</Text>
            </Pressable>
            <Pressable style={styles.voiceMetaChip}>
              <Text style={styles.voiceMetaChipText}>优先级</Text>
            </Pressable>
            <Pressable style={styles.voiceMetaChip}>
              <Text style={styles.voiceMetaChipText}>提醒</Text>
            </Pressable>
            <Pressable
              style={[
                styles.voiceSubmitButton,
                voiceDraft.trim().length === 0 || isAsking || isRecording || isVoiceProcessing
                  ? styles.askButtonDisabled
                  : null,
              ]}
              disabled={voiceDraft.trim().length === 0 || isAsking || isRecording || isVoiceProcessing}
              onPress={submitVoiceDraft}
            >
              <Text style={styles.voiceSubmitButtonText}>{isAsking ? "…" : voiceComposerSubmitLabel("capture")}</Text>
            </Pressable>
          </View>

          {isDueDatePickerOpen ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              <View style={styles.voiceDateOptionsRow}>
                {dueDateOptions.map((dateOption) => {
                  const active = isSameDay(dateOption, selectedDueDate);
                  return (
                    <Pressable
                      key={dateOption.toISOString()}
                      style={[styles.voiceDateOptionChip, active ? styles.voiceDateOptionChipActive : null]}
                      onPress={() => {
                        setSelectedDueDate(dateOption);
                        setIsDueDatePickerOpen(false);
                      }}
                    >
                      <Text style={[styles.voiceDateOptionText, active ? styles.voiceDateOptionTextActive : null]}>
                        {formatDueDateLabel(dateOption)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </ScrollView>
          ) : null}

          <View style={styles.voiceComposerBottomRow}>
            <Pressable style={styles.voiceListPicker}>
              <Text style={styles.voiceListPickerText}>清单</Text>
            </Pressable>
            <View style={styles.voiceBottomActions}>
              <Pressable
                style={[
                  styles.voiceRecordButton,
                  isComposerRecording ? styles.voiceRecordButtonActive : null,
                  isComposerVoiceProcessing ? styles.askButtonDisabled : null,
                ]}
                disabled={isComposerVoiceProcessing}
                onPress={toggleComposerRecording}
              >
                {isComposerRecording ? (
                  <View style={styles.voiceStopSquare} />
                ) : (
                  <Text style={styles.voiceRecordButtonText}>+</Text>
                )}
              </Pressable>
            </View>
          </View>

        </View>
      ) : (
        <Pressable
          style={[
            styles.fab,
            { bottom: 102 + insets.bottom },
            isComposerRecording ? styles.fabRecording : null,
          ]}
          onPress={() => startVoiceComposer("capture")}
        >
          <Text style={styles.fabText}>+</Text>
        </Pressable>
      )}

      <View style={[styles.bottomNav, { bottom: 14 + insets.bottom }]}>
        {(["inbox", "list", "today", "plan", "settings"] as Tab[]).map((tab) => (
          <Pressable
            key={tab}
            onPress={() => setActiveTab(tab)}
            style={styles.navItem}
          >
            <Text style={[styles.navText, activeTab === tab ? styles.navTextActive : null]}>
              {tabLabel[tab]}
            </Text>
          </Pressable>
        ))}
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
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  gridCard: {
    width: "48.5%",
    minHeight: 180,
    borderRadius: 24,
    borderWidth: 1,
    padding: 14,
    gap: 8,
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
  todoRow: {
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 10,
  },
  todoText: {
    fontSize: 14,
    fontWeight: "600",
  },
  todoEditInput: {
    minHeight: 22,
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
  listScreen: {
    gap: 14,
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
  listItemCard: {
    borderRadius: 20,
    padding: 12,
    gap: 10,
    backgroundColor: "rgba(249, 245, 238, 0.84)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  listItemPressable: {
    gap: 8,
  },
  listItemTop: {
    flexDirection: "row",
    justifyContent: "flex-start",
    alignItems: "flex-start",
    gap: 12,
  },
  listItemTextWrap: {
    flex: 1,
    gap: 4,
  },
  listItemTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  categoryChipButton: {
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
  },
  categoryChipButtonText: {
    fontSize: 13,
    fontWeight: "800",
  },
  listItemTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "800",
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
    gap: 10,
    justifyContent: "flex-end",
    alignSelf: "flex-end",
  },
  iconActionButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 74, 0, 0.1)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  iconActionText: {
    color: palette.accent,
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 20,
  },
  iconDeleteButton: {
    backgroundColor: "rgba(111, 41, 20, 0.08)",
  },
  iconDeleteText: {
    color: "#8C4325",
  },
  iconConfirmButton: {
    backgroundColor: "rgba(196, 74, 0, 0.2)",
  },
  iconConfirmText: {
    color: palette.accent,
  },
  iconConfirmButtonDone: {
    backgroundColor: "rgba(47, 45, 41, 0.12)",
  },
  iconConfirmTextDone: {
    color: palette.inkSoft,
  },
  listDetails: {
    gap: 6,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 10,
  },
  detailLabel: {
    color: palette.inkSoft,
    fontSize: 12,
    letterSpacing: 0.6,
    fontWeight: "700",
  },
  detailText: {
    color: palette.inkMuted,
    fontSize: 14,
    lineHeight: 21,
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
    width: 76,
    height: 76,
    borderRadius: 38,
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
    fontSize: 42,
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
  voiceComposerCloseFloating: {
    position: "absolute",
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 74, 0, 0.12)",
    zIndex: 1,
  },
  voiceComposerCloseText: {
    fontSize: 28,
    lineHeight: 28,
    color: palette.accent,
  },
  voiceComposerInput: {
    minHeight: 84,
    borderRadius: 0,
    paddingHorizontal: 0,
    paddingVertical: 0,
    paddingRight: 42,
    backgroundColor: "transparent",
    borderWidth: 0,
    color: palette.ink,
    fontSize: 24,
    lineHeight: 32,
    fontWeight: "700",
  },
  voiceComposerMetaRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap",
  },
  voiceMetaChip: {
    height: 40,
    borderRadius: 20,
    paddingHorizontal: 14,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: "rgba(245, 241, 233, 0.5)",
  },
  voiceMetaChipActive: {
    backgroundColor: "rgba(196, 74, 0, 0.12)",
  },
  voiceMetaChipText: {
    color: palette.accent,
    fontSize: 15,
    fontWeight: "700",
  },
  voiceDateOptionsRow: {
    flexDirection: "row",
    gap: 8,
    marginTop: 2,
    paddingBottom: 2,
  },
  voiceDateOptionChip: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(245, 241, 233, 0.6)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  voiceDateOptionChipActive: {
    backgroundColor: "rgba(196, 74, 0, 0.16)",
  },
  voiceDateOptionText: {
    color: palette.inkMuted,
    fontSize: 13,
    fontWeight: "700",
  },
  voiceDateOptionTextActive: {
    color: palette.accent,
  },
  voiceComposerBottomRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: palette.border,
    paddingTop: 10,
  },
  voiceListPicker: {
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(245, 241, 233, 0.65)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  voiceListPickerText: {
    color: palette.inkMuted,
    fontSize: 15,
    fontWeight: "700",
  },
  voiceBottomActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  voiceRecordButton: {
    width: 62,
    height: 62,
    borderRadius: 31,
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
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(196, 74, 0, 0.12)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  voiceSubmitButtonText: {
    color: palette.accent,
    fontSize: 22,
    fontWeight: "800",
    lineHeight: 24,
  },
  voiceStopSquare: {
    width: 18,
    height: 18,
    borderRadius: 3,
    backgroundColor: "#F3E7D8",
  },
  bottomNav: {
    position: "absolute",
    left: 18,
    right: 18,
    backgroundColor: palette.navBg,
    borderRadius: 28,
    paddingHorizontal: 10,
    paddingVertical: 16,
    flexDirection: "row",
    justifyContent: "space-between",
    borderWidth: 1,
    borderColor: palette.border,
  },
  navItem: {
    flex: 1,
    alignItems: "center",
  },
  navText: {
    fontSize: 16,
    color: palette.inkSoft,
    fontWeight: "600",
  },
  navTextActive: {
    color: palette.ink,
    fontWeight: "800",
  },
  todayList: {
    gap: 10,
  },
  todayRow: {
    borderRadius: 16,
    padding: 12,
    gap: 10,
    backgroundColor: "rgba(249, 245, 238, 0.9)",
    borderWidth: 1,
    borderColor: palette.border,
  },
  todayRowTitle: {
    color: palette.ink,
    fontSize: 17,
    lineHeight: 23,
    fontWeight: "700",
  },
  todayEditInput: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: palette.inputBg,
    color: palette.ink,
    borderWidth: 1,
    borderColor: palette.border,
    fontSize: 16,
  },
  todayRowActions: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 8,
  },
  todayActionButton: {
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: "rgba(196, 74, 0, 0.1)",
  },
  todayActionText: {
    color: palette.accent,
    fontSize: 13,
    fontWeight: "700",
  },
  todayDeleteButton: {
    backgroundColor: "rgba(111, 41, 20, 0.08)",
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
});
