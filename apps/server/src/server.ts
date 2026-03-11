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

type RawTask = {
  title?: unknown;
  reasoning?: unknown;
  category?: unknown;
  hiddenTags?: unknown;
  confidenceScore?: unknown;
  dueDateISO8601?: unknown;
  timeHint?: unknown;
  sourceSnippet?: unknown;
};

type OrganizePayload = {
  tasks: Array<{
    title: string;
    reasoning: string;
    category: Category;
    hiddenTags: string[];
    confidenceScore: number;
    dueDateISO8601: string | null;
    timeHint: string;
    sourceSnippet: string;
  }>;
};

type TranscribePayload = {
  transcript: string;
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

function buildSystemPrompt(nowISO8601: string): string {
  return [
    "你是一个待办整理助手。请把用户原话拆解为任务 JSON。",
    "规则：",
    "1. 最多输出 4 条任务。",
    "2. category 只能是 shopping/life/relationships/work/travel/triage。",
    "3. confidenceScore 取 0.0~1.0，越明确越高，联想建议更低。",
    "4. 不要编造人名、日期或事件；不确定就降低 confidenceScore。",
    "5. 输出必须符合 schema，不要输出额外字段。",
    `当前时间(ISO8601)：${nowISO8601}`,
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

function normalizeTask(task: RawTask): OrganizePayload["tasks"][number] {
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
    sourceSnippet: safeString(task.sourceSnippet),
  };
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

const taskSchema = {
  name: "plusdo_tasks",
  strict: true,
  schema: {
    type: "object",
    properties: {
      tasks: {
        type: "array",
        maxItems: 4,
        items: {
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
            "sourceSnippet",
          ],
          additionalProperties: false,
        },
      },
    },
    required: ["tasks"],
    additionalProperties: false,
  },
} as const;
