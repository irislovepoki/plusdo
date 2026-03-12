import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import multer from "multer";

dotenv.config();

const app = express();
const port = Number(process.env.PORT ?? 8787);
const openAIKey = process.env.OPENAI_API_KEY ?? "";
const openAIModel = process.env.OPENAI_MODEL ?? "gpt-4.1-mini";
const openAITranscribeModel =
  process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_request, response) => {
  response.json({
    ok: true,
    mode: "backend_proxy",
    model: openAIModel,
  });
});

app.post("/api/transcribe", upload.single("file"), async (request, response) => {
  try {
    if (!request.file) {
      return response.status(400).json({ error: "audio file is required" });
    }

    if (!openAIKey) {
      return response.status(500).json({ error: "OPENAI_API_KEY is missing" });
    }

    const payload = await transcribeWithOpenAI({
      buffer: request.file.buffer,
      fileName:
        request.file.originalname && request.file.originalname.trim().length > 0
          ? request.file.originalname
          : "voice-note.m4a",
      contentType: request.file.mimetype,
    });

    return response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown transcription error";
    console.error("Transcribe request failed:", message);
    return response
      .status(500)
      .json({ error: "transcribe_failed", detail: message });
  }
});

app.post("/api/organize", async (request, response) => {
  try {
    const { transcript, nowISO8601 } = request.body as OrganizeRequest;

    if (typeof transcript !== "string" || transcript.trim().length === 0) {
      return response.status(400).json({ error: "transcript is required" });
    }

    if (!openAIKey) {
      return response.status(500).json({ error: "OPENAI_API_KEY is missing" });
    }

    const payload = await organizeWithOpenAI({
      transcript: transcript.trim(),
      nowISO8601:
        typeof nowISO8601 === "string" && nowISO8601.length > 0
          ? nowISO8601
          : new Date().toISOString(),
    });

    return response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown organize error";
    console.error("Organize request failed:", message);
    return response.status(500).json({ error: "organize_failed", detail: message });
  }
});

app.post("/api/assistant", async (request, response) => {
  try {
    const body = request.body as AssistantRequest;
    const message = safeString(body.message);

    if (!message) {
      return response.status(400).json({ error: "message is required" });
    }

    if (!openAIKey) {
      return response.status(500).json({ error: "OPENAI_API_KEY is missing" });
    }

    const payload = await respondAsAssistant({
      message,
      nowISO8601:
        typeof body.nowISO8601 === "string" && body.nowISO8601.length > 0
          ? body.nowISO8601
          : new Date().toISOString(),
      history: sanitizeAssistantHistory(body.history),
      tasks: sanitizeAssistantTasks(body.tasks),
      captures: sanitizeAssistantCaptures(body.captures),
    });

    return response.json(payload);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown assistant error";
    console.error("Assistant request failed:", message);
    return response.status(500).json({ error: "assistant_failed", detail: message });
  }
});

app.listen(port, () => {
  console.log(`PlusDo backend listening on http://localhost:${port}`);
});

type Category =
  | "shopping"
  | "life"
  | "relationships"
  | "work"
  | "travel"
  | "triage";

type OrganizeRequest = {
  transcript?: string;
  nowISO8601?: string;
};

type AssistantIntent =
  | "create_tasks"
  | "search_tasks"
  | "plan"
  | "prioritize"
  | "chat";

type AssistantConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

type AssistantContextTask = {
  id: string;
  title: string;
  category: Category;
  certainty: string;
  dueDateKey: string | null;
  sourceSnippet: string;
  reasoning: string;
  createdAt: string;
};

type AssistantContextCapture = {
  id: string;
  transcript: string;
  createdAt: string;
};

type AssistantRequest = {
  message?: unknown;
  nowISO8601?: unknown;
  history?: unknown;
  tasks?: unknown;
  captures?: unknown;
};

type RawTask = {
  title?: unknown;
  reasoning?: unknown;
  category?: unknown;
  hiddenTags?: unknown;
  confidenceScore?: unknown;
  dueDateISO8601?: unknown;
  timeHint?: unknown;
  priorityHint?: unknown;
  reminderDateISO8601?: unknown;
  reminderHint?: unknown;
  sourceSnippet?: unknown;
};

type OrganizePayload = {
  tasks: NormalizedTask[];
};

type TranscribePayload = {
  transcript: string;
};

type NormalizedTask = {
  title: string;
  reasoning: string;
  category: Category;
  hiddenTags: string[];
  confidenceScore: number;
  dueDateISO8601: string | null;
  timeHint: string;
  priorityHint: string;
  reminderDateISO8601: string | null;
  reminderHint: string;
  sourceSnippet: string;
};

type AssistantPayload = {
  reply: string;
  intent: AssistantIntent;
  tasks: NormalizedTask[];
};

async function transcribeWithOpenAI(input: {
  buffer: Buffer;
  fileName: string;
  contentType: string;
}): Promise<TranscribePayload> {
  const form = new FormData();
  const contentType =
    input.contentType && input.contentType.trim().length > 0
      ? input.contentType
      : "audio/m4a";
  const fileBytes = new Uint8Array(input.buffer);
  const file = new File([fileBytes], input.fileName, {
    type: contentType,
  });

  form.append("file", file);
  form.append("model", openAITranscribeModel);
  form.append("language", "zh");

  const openAIResponse = await fetch(
    "https://api.openai.com/v1/audio/transcriptions",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAIKey}`,
      },
      body: form,
    },
  );

  if (!openAIResponse.ok) {
    const detail = await openAIResponse.text();
    throw new Error(
      `OpenAI transcription failed: ${openAIResponse.status} ${detail}`,
    );
  }

  const data = (await openAIResponse.json()) as { text?: string };
  const transcript = typeof data.text === "string" ? data.text.trim() : "";

  if (!transcript) {
    throw new Error("OpenAI returned empty transcript");
  }

  return { transcript };
}

async function organizeWithOpenAI(input: {
  transcript: string;
  nowISO8601: string;
}): Promise<OrganizePayload> {
  const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIKey}`,
    },
    body: JSON.stringify({
      model: openAIModel,
      messages: [
        { role: "system", content: buildSystemPrompt(input.nowISO8601) },
        { role: "user", content: input.transcript },
      ],
      response_format: {
        type: "json_schema",
        json_schema: taskSchema,
      },
    }),
  });

  if (!openAIResponse.ok) {
    const detail = await openAIResponse.text();
    throw new Error(`OpenAI request failed: ${openAIResponse.status} ${detail}`);
  }

  const data = (await openAIResponse.json()) as {
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{
              type?: string;
              text?: string;
            }>;
      };
    }>;
  };

  const content = extractContent(data);
  const parsed = JSON.parse(content) as { tasks?: RawTask[] };

  return {
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
  };
}

async function respondAsAssistant(input: {
  message: string;
  nowISO8601: string;
  history: AssistantConversationMessage[];
  tasks: AssistantContextTask[];
  captures: AssistantContextCapture[];
}): Promise<AssistantPayload> {
  const messages = [
    {
      role: "system" as const,
      content: buildAssistantSystemPrompt(input.nowISO8601),
    },
    {
      role: "system" as const,
      content: buildAssistantContextPrompt(input.tasks, input.captures),
    },
    ...input.history.slice(-10).map((message) => ({
      role: message.role,
      content: message.text,
    })),
    {
      role: "user" as const,
      content: input.message,
    },
  ];

  const openAIResponse = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openAIKey}`,
    },
    body: JSON.stringify({
      model: openAIModel,
      messages,
      response_format: {
        type: "json_schema",
        json_schema: assistantSchema,
      },
    }),
  });

  if (!openAIResponse.ok) {
    const detail = await openAIResponse.text();
    throw new Error(`OpenAI request failed: ${openAIResponse.status} ${detail}`);
  }

  const data = (await openAIResponse.json()) as {
    choices?: Array<{
      message?: {
        content?:
          | string
          | Array<{
              type?: string;
              text?: string;
            }>;
      };
    }>;
  };

  const content = extractContent(data);
  const parsed = JSON.parse(content) as {
    reply?: unknown;
    intent?: unknown;
    tasks?: RawTask[];
  };
  const intentValue = safeString(parsed.intent);
  const intent = validAssistantIntent(intentValue) ? intentValue : "chat";

  return {
    reply: safeString(parsed.reply),
    intent,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks.map(normalizeTask) : [],
  };
}

function buildSystemPrompt(nowISO8601: string): string {
  return [
    "你是一个待办整理助手。请把用户原话拆解为任务 JSON。",
    "规则：",
    "1. 最多输出 4 条任务。",
    "2. category 只能是 shopping/life/relationships/work/travel/triage。",
    "3. confidenceScore 取 0.0~1.0，越明确越高，联想建议更低。",
    "4. 只要能合理推测出潜在待办，就优先创建待办，不要只是复述原话。",
    "5. title 必须改写成简洁、可执行的任务标题，尽量用动词开头，例如“买猫砂”“整理家里”“准备生日礼物”。",
    "6. 当用户表达缺少、用完、没有、想吃、想喝、需要补货时，优先理解为购物或补货需求。",
    "7. dueDateISO8601 和 timeHint 只有在用户明确说了完成时间、日期、期限时才填写；否则分别输出 null 和空字符串。",
    "8. priorityHint 只有在用户明确提到高优先级、重要、紧急、先做等强信号时才填写；否则输出空字符串。",
    "9. reminderDateISO8601 和 reminderHint 只有在用户明确提到提醒时间时才填写；否则分别输出 null 和空字符串。",
    "10. sourceSnippet 尽量保留用户原话里和这条任务最相关的短句。",
    "11. 不要编造人名、日期或事件；不确定就降低 confidenceScore。",
    "12. 输出必须符合 schema，不要输出额外字段。",
    `当前时间(ISO8601)：${nowISO8601}`,
  ].join("\n");
}

function buildAssistantSystemPrompt(nowISO8601: string): string {
  return [
    "你是 PlusDo 的 AI 助理。你的默认风格必须偏主动，不要过度保守。",
    "用户可以对你说任何事，但你要尽量把它理解成个人事务管理、回忆、整理、规划、提醒相关的请求。",
    "前台只有一个输入框，所以不要要求用户先选模式。你要自己判断意图。",
    "intent 只能是 create_tasks/search_tasks/plan/prioritize/chat 之一。",
    "当前阶段只先做好助理页。create_tasks 代表“发布任务”，意思是生成待确认的任务草稿，不代表已经保存或已经同步到别的页面。",
    "只要用户的话里能合理推测出潜在待办，就优先创建待办，不要只是复述原话。",
    "title 必须改写成简洁、可执行的任务标题，尽量用动词开头。",
    "当用户表达缺少、用完、没有、快没了、想吃、想喝、需要补货时，优先理解为购物或补货需求。",
    "例如：家里没鞋子了->买鞋子，想吃橘子->买橘子，猫砂没了->买猫砂，最近家里有点乱->整理家里。",
    "如果用户是在回忆、查找、确认自己有没有忘事，请优先根据提供的任务上下文回答，不要编造不存在的事项；只要找到匹配事项，就把这些事项写进 tasks。",
    "如果用户在问如何做一件事，可以给出 2 到 4 步清晰建议；只有在确实适合落成待办时才输出 tasks。",
    "tasks 最多 4 条。只有在完全无法提炼行动时才输出空数组。",
    "category 只能是 shopping/life/relationships/work/travel/triage。",
    "confidenceScore 取 0.0~1.0。明确直接的事项更高，联想建议更低。",
    "不要编造上下文里没有提到的既有事项、日期、人物或完成状态。",
    "dueDateISO8601 和 timeHint 只有在用户明确说了完成时间、日期、期限时才填写；否则分别输出 null 和空字符串。",
    "priorityHint 只有在用户明确提到高优先级、重要、紧急、先做等强信号时才填写；否则输出空字符串。",
    "reminderDateISO8601 和 reminderHint 只有在用户明确提到提醒时间时才填写；否则分别输出 null 和空字符串。",
    "sourceSnippet 尽量保留用户原话里和这条任务最相关的短句。",
    "如果 tasks 非空，reply 必须只输出任务结果本身，不要解释，不要寒暄，不要加“我帮你记下了”。",
    "如果 tasks 非空，reply 用换行分隔，每行格式必须是“类别 任务 时间 重要性 提醒”。字段之间只用一个空格。",
    "如果某个字段没有，就直接省略，不要补“待定”、不要补“普通”、不要补默认提醒。",
    "类别用中文：购物/工作/关系/生活/旅行/待整理。",
    "如果 tasks 为空，reply 才能用一句简洁中文说明或追问。",
    `当前时间(ISO8601)：${nowISO8601}`,
  ].join("\n");
}

function buildAssistantContextPrompt(
  tasks: AssistantContextTask[],
  captures: AssistantContextCapture[],
): string {
  const taskLines =
    tasks.length > 0
      ? tasks.slice(0, 40).map((task, index) => {
          const dueDate = task.dueDateKey ? ` | 日期:${task.dueDateKey}` : "";
          const sourceSnippet = task.sourceSnippet ? ` | 原话:${task.sourceSnippet}` : "";
          const reasoning = task.reasoning ? ` | 理由:${task.reasoning}` : "";
          return `${index + 1}. [${task.category}] ${task.title}${dueDate}${sourceSnippet}${reasoning}`;
        })
      : ["(暂无任务)"];
  const captureLines =
    captures.length > 0
      ? captures.slice(0, 12).map((capture, index) => {
          return `${index + 1}. ${capture.transcript} | ${capture.createdAt}`;
        })
      : ["(暂无原话记录)"];

  return [
    "下面是当前用户在 PlusDo 里的上下文。回答回忆/查找类问题时，请优先参考这些内容。",
    "",
    "[当前任务]",
    ...taskLines,
    "",
    "[最近原话]",
    ...captureLines,
  ].join("\n");
}

function extractContent(data: {
  choices?: Array<{
    message?: {
      content?:
        | string
        | Array<{
            type?: string;
            text?: string;
          }>;
    };
  }>;
}): string {
  const content = data.choices?.[0]?.message?.content;

  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }

  if (Array.isArray(content)) {
    const text = content
      .map((block) => (typeof block?.text === "string" ? block.text : ""))
      .filter(Boolean)
      .join("\n");
    if (text.trim().length > 0) {
      return text;
    }
  }

  throw new Error("OpenAI returned empty content");
}

function normalizeTask(task: RawTask): NormalizedTask {
  const validCategories = new Set<Category>([
    "shopping",
    "life",
    "relationships",
    "work",
    "travel",
    "triage",
  ]);

  const categoryValue = safeString(task.category);
  const category = validCategories.has(categoryValue as Category)
    ? (categoryValue as Category)
    : "triage";

  return {
    title: safeString(task.title),
    reasoning: safeString(task.reasoning),
    category,
    hiddenTags: Array.isArray(task.hiddenTags)
      ? task.hiddenTags.map((tag) => safeString(tag)).filter(Boolean)
      : [],
    confidenceScore: clampNumber(task.confidenceScore, 0.1, 0.95),
    dueDateISO8601: safeNullableString(task.dueDateISO8601),
    timeHint: safeString(task.timeHint),
    priorityHint: safeString(task.priorityHint),
    reminderDateISO8601: safeNullableString(task.reminderDateISO8601),
    reminderHint: safeString(task.reminderHint),
    sourceSnippet: safeString(task.sourceSnippet),
  };
}

function sanitizeAssistantHistory(value: unknown): AssistantConversationMessage[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const message = entry as Partial<AssistantConversationMessage>;
      return message.role === "user" || message.role === "assistant"
        ? {
            role: message.role,
            text: safeString(message.text),
          }
        : null;
    })
    .filter((entry): entry is AssistantConversationMessage => {
      return Boolean(entry && entry.text.length > 0);
    });
}

function sanitizeAssistantTasks(value: unknown): AssistantContextTask[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const task = entry as Partial<AssistantContextTask>;
      const categoryValue = safeString(task.category);
      if (!validCategory(categoryValue)) {
        return null;
      }

      return {
        id: safeString(task.id),
        title: safeString(task.title),
        category: categoryValue,
        certainty: safeString(task.certainty),
        dueDateKey: safeNullableString(task.dueDateKey),
        sourceSnippet: safeString(task.sourceSnippet),
        reasoning: safeString(task.reasoning),
        createdAt: safeString(task.createdAt),
      };
    })
    .filter((task): task is AssistantContextTask => Boolean(task && task.title.length > 0));
}

function sanitizeAssistantCaptures(value: unknown): AssistantContextCapture[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      if (!entry || typeof entry !== "object") {
        return null;
      }
      const capture = entry as Partial<AssistantContextCapture>;
      return {
        id: safeString(capture.id),
        transcript: safeString(capture.transcript),
        createdAt: safeString(capture.createdAt),
      };
    })
    .filter(
      (capture): capture is AssistantContextCapture =>
        Boolean(capture && capture.transcript.length > 0),
    );
}

function safeString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function safeNullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function clampNumber(value: unknown, min: number, max: number): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) {
    return min;
  }
  return Math.min(Math.max(number, min), max);
}

function validCategory(value: string): value is Category {
  return (
    value === "shopping" ||
    value === "life" ||
    value === "relationships" ||
    value === "work" ||
    value === "travel" ||
    value === "triage"
  );
}

function validAssistantIntent(value: string): value is AssistantIntent {
  return (
    value === "create_tasks" ||
    value === "search_tasks" ||
    value === "plan" ||
    value === "prioritize" ||
    value === "chat"
  );
}

const taskItemSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    reasoning: { type: "string" },
    category: {
      type: "string",
      enum: ["shopping", "life", "relationships", "work", "travel", "triage"],
    },
    hiddenTags: { type: "array", items: { type: "string" } },
    confidenceScore: { type: "number" },
    dueDateISO8601: { type: ["string", "null"] },
    timeHint: { type: "string" },
    priorityHint: { type: "string" },
    reminderDateISO8601: { type: ["string", "null"] },
    reminderHint: { type: "string" },
    sourceSnippet: { type: "string" },
  },
  required: [
    "title",
    "reasoning",
    "category",
    "hiddenTags",
    "confidenceScore",
    "dueDateISO8601",
    "timeHint",
    "priorityHint",
    "reminderDateISO8601",
    "reminderHint",
    "sourceSnippet",
  ],
  additionalProperties: false,
} as const;

const taskSchema = {
  name: "plusdo_tasks",
  strict: true,
  schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        maxItems: 4,
        items: taskItemSchema,
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
} as const;

const assistantSchema = {
  name: "plusdo_assistant_turn",
  strict: true,
  schema: {
    type: "object",
    properties: {
      reply: { type: "string" },
      intent: {
        type: "string",
        enum: ["create_tasks", "search_tasks", "plan", "prioritize", "chat"],
      },
      tasks: {
        type: "array",
        maxItems: 4,
        items: taskItemSchema,
      },
    },
    required: ["reply", "intent", "tasks"],
    additionalProperties: false,
  },
} as const;
