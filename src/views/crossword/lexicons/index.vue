<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import { formatTime } from "../dict";
import {
  generateWordsByDeepseek,
  getDeepseekKey,
  setDeepseekKey
} from "../lexicon/deepseek";
import { deleteLexicon, listLexicons, saveLexicon } from "../lexicon/storage";
import type { Lexicon, LexiconLevel, LexiconWord } from "../lexicon/types";
import {
  LEXICON_LEVELS,
  parseLexiconCsv,
  parseLexiconJson
} from "../lexicon/words";

defineOptions({
  name: "CrosswordLexicons"
});

const loading = ref(false);
const saving = ref(false);
const generating = ref(false);
const adding = ref(false);
const list = ref<Lexicon[]>([]);
const apiKey = ref(getDeepseekKey());
const savedKey = ref(getDeepseekKey());
const fileInput = ref<HTMLInputElement>();
const csvInput = ref<HTMLInputElement>();

const editorVisible = ref(false);
const editingId = ref<string | null>(null);
const form = reactive({
  name: "",
  words: [] as LexiconWord[]
});

const aiVisible = ref(false);
const ai = reactive({
  name: "",
  topic: "",
  count: 12,
  minLength: 3,
  maxLength: 8,
  level: "normal" as LexiconLevel
});

const addVisible = ref(false);
const add = reactive({
  topic: "",
  count: 6,
  minLength: 3,
  maxLength: 8,
  level: "normal" as LexiconLevel
});

const BATCH_LIMIT = 100;
type BatchStatus = "wait" | "running" | "ok" | "fail" | "stopped";
interface BatchItem {
  topic: string;
  status: BatchStatus;
  detail: string;
}

const batchVisible = ref(false);
const batching = ref(false);
const batchItems = ref<BatchItem[]>([]);
const batch = reactive({
  topics: "",
  count: 12,
  minLength: 3,
  maxLength: 8,
  level: "normal" as LexiconLevel
});
let batchController: AbortController | null = null;

const batchTopics = computed(() => parseTopics(batch.topics));
const batchHint = computed(
  () =>
    `共 ${batchTopics.value.length} 个主题。数量、词长和难度共用，按顺序逐个生成，每个主题保存为一个词库。`
);
const batchProgress = computed(() => {
  const done = batchItems.value.filter(item => item.status !== "wait").length;
  return `${done}/${batchItems.value.length}`;
});

function parseTopics(text: string) {
  const seen = new Set<string>();
  const topics: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const topic = line.trim().slice(0, 64);
    if (!topic) continue;
    const key = topic.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    topics.push(topic);
  }
  return topics;
}

function batchTag(status: BatchStatus) {
  if (status === "ok") return "success";
  if (status === "fail") return "danger";
  if (status === "running") return "warning";
  return "info";
}

function batchLabel(status: BatchStatus) {
  if (status === "ok") return "已保存";
  if (status === "fail") return "失败";
  if (status === "running") return "生成中";
  if (status === "stopped") return "已停止";
  return "等待";
}

async function load() {
  loading.value = true;
  try {
    list.value = await listLexicons();
  } catch {
    list.value = [];
    message("无法读取本地词库", { type: "error" });
  } finally {
    loading.value = false;
  }
}

function saveKey() {
  setDeepseekKey(apiKey.value);
  savedKey.value = getDeepseekKey();
  message(
    savedKey.value ? "DeepSeek API Key 已保存" : "已清空 DeepSeek API Key",
    {
      type: savedKey.value ? "success" : "warning"
    }
  );
}

function openDraft(name: string, words: LexiconWord[]) {
  editingId.value = null;
  form.name = name;
  form.words = words.map(item => ({ ...item }));
  editorVisible.value = true;
}

function openEdit(row: Lexicon) {
  editingId.value = row.id;
  form.name = row.name;
  form.words = row.words.map(item => ({ ...item }));
  editorVisible.value = true;
}

function openAi() {
  ai.name = "";
  ai.topic = "";
  ai.count = 12;
  ai.minLength = 3;
  ai.maxLength = 8;
  ai.level = "normal";
  aiVisible.value = true;
}

function openBatch() {
  batchVisible.value = true;
}

function stopBatch() {
  batchController?.abort();
}

function onBatchBeforeClose(done: () => void) {
  if (batching.value) {
    message("正在生成，请先停止", { type: "warning" });
    return;
  }
  done();
}

async function generateBatch() {
  if (batching.value) return;
  const key = getDeepseekKey();
  if (!key) {
    message("请先保存 DeepSeek API Key", { type: "warning" });
    return;
  }
  const topics = batchTopics.value;
  if (!topics.length) {
    message("请填写主题，每行一个", { type: "warning" });
    return;
  }
  if (topics.length > BATCH_LIMIT) {
    message(`一次最多 ${BATCH_LIMIT} 个主题`, { type: "warning" });
    return;
  }
  if (batch.minLength > batch.maxLength) {
    message("最短词长不能大于最长词长", { type: "warning" });
    return;
  }

  const items = topics.map(topic => ({
    topic,
    status: "wait" as BatchStatus,
    detail: ""
  }));
  batchItems.value = items;
  batching.value = true;
  const controller = new AbortController();
  batchController = controller;
  let aborted = false;

  try {
    for (const item of items) {
      if (controller.signal.aborted) {
        aborted = true;
        break;
      }
      item.status = "running";
      item.detail = "正在请求 DeepSeek";
      try {
        const { words, skipped } = await generateWordsByDeepseek({
          apiKey: key,
          topic: item.topic,
          count: batch.count,
          minLength: batch.minLength,
          maxLength: batch.maxLength,
          level: batch.level,
          signal: controller.signal
        });
        await saveLexicon({ name: item.topic, words });
        const short =
          words.length < batch.count ? `，少于要求的 ${batch.count} 个` : "";
        const ignored = skipped ? `，忽略了 ${skipped} 个不符合规则的结果` : "";
        item.status = "ok";
        item.detail = `${words.length} 个单词${short}${ignored}`;
        list.value = await listLexicons();
      } catch (error) {
        if (controller.signal.aborted) {
          item.status = "stopped";
          item.detail = "已停止";
          aborted = true;
          break;
        }
        item.status = "fail";
        item.detail = error instanceof Error ? error.message : "生成失败";
      }
    }
  } finally {
    if (aborted) {
      for (const item of items) {
        if (item.status === "wait") {
          item.status = "stopped";
          item.detail = "未生成";
        }
      }
    }
    batchController = null;
    batching.value = false;
  }

  const ok = items.filter(item => item.status === "ok").length;
  const fail = items.filter(item => item.status === "fail").length;
  if (aborted) {
    message(`已停止，保存了 ${ok} 个词库`, {
      type: ok ? "success" : "warning"
    });
    return;
  }
  message(
    fail ? `完成：成功 ${ok} 个，失败 ${fail} 个` : `已保存 ${ok} 个词库`,
    {
      type: fail ? "warning" : "success"
    }
  );
}

async function generateByAi() {
  if (batching.value) {
    message("批量生成还在进行，请先停止", { type: "warning" });
    return;
  }
  const key = getDeepseekKey();
  if (!key) {
    message("请先保存 DeepSeek API Key", { type: "warning" });
    return;
  }
  const topic = ai.topic.trim();
  if (!topic) {
    message("请填写主题", { type: "warning" });
    return;
  }
  if (ai.minLength > ai.maxLength) {
    message("最短词长不能大于最长词长", { type: "warning" });
    return;
  }
  generating.value = true;
  try {
    const { words, skipped } = await generateWordsByDeepseek({
      apiKey: key,
      topic,
      count: ai.count,
      minLength: ai.minLength,
      maxLength: ai.maxLength,
      level: ai.level
    });
    aiVisible.value = false;
    add.topic = topic;
    add.minLength = ai.minLength;
    add.maxLength = ai.maxLength;
    add.level = ai.level;
    openDraft(ai.name.trim() || topic, words);
    const short = words.length < ai.count ? `，少于要求的 ${ai.count} 个` : "";
    const ignored = skipped ? `，忽略了 ${skipped} 个不符合规则的结果` : "";
    message(`已得到 ${words.length} 个单词${short}${ignored}，确认后保存`, {
      type: skipped || words.length < ai.count ? "warning" : "success"
    });
  } catch (error) {
    message(error instanceof Error ? error.message : "生成失败", {
      type: "error"
    });
  } finally {
    generating.value = false;
  }
}

function openAddWords() {
  if (!getDeepseekKey()) {
    message("请先保存 DeepSeek API Key", { type: "warning" });
    return;
  }
  if (!add.topic.trim()) add.topic = form.name.trim();
  addVisible.value = true;
}

async function addWordsByAi() {
  const key = getDeepseekKey();
  if (!key) {
    message("请先保存 DeepSeek API Key", { type: "warning" });
    return;
  }
  const topic = add.topic.trim();
  if (!topic) {
    message("请填写主题", { type: "warning" });
    return;
  }
  if (add.minLength > add.maxLength) {
    message("最短词长不能大于最长词长", { type: "warning" });
    return;
  }
  adding.value = true;
  try {
    const { words, skipped } = await generateWordsByDeepseek({
      apiKey: key,
      topic,
      count: add.count,
      minLength: add.minLength,
      maxLength: add.maxLength,
      level: add.level,
      exclude: form.words.map(item => item.answer)
    });
    if (!words.length) {
      message("没有新的单词，请换个主题或再试一次", { type: "warning" });
      return;
    }
    form.words.push(...words);
    addVisible.value = false;
    const ignored = skipped
      ? `，忽略了 ${skipped} 个重复或不符合规则的结果`
      : "";
    message(`已增加 ${words.length} 个单词${ignored}`, {
      type: skipped ? "warning" : "success"
    });
  } catch (error) {
    message(error instanceof Error ? error.message : "增加失败", {
      type: "error"
    });
  } finally {
    adding.value = false;
  }
}

async function onImportCsv(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const name = file.name.replace(/\.csv$/i, "").trim();
    const parsed = parseLexiconCsv(await file.text(), name);
    openDraft(parsed.name, parsed.words);
    message(`已读入 ${parsed.words.length} 个单词，线索留空，确认后保存`, {
      type: "success"
    });
  } catch (error) {
    message(error instanceof Error ? error.message : "导入失败", {
      type: "error"
    });
  }
}

async function onImport(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const parsed = parseLexiconJson(await file.text());
    openDraft(parsed.name, parsed.words);
  } catch (error) {
    message(error instanceof Error ? error.message : "导入失败", {
      type: "error"
    });
  }
}

async function save() {
  saving.value = true;
  try {
    await saveLexicon({
      id: editingId.value || undefined,
      name: form.name,
      words: form.words
    });
    message(editingId.value ? "词库已更新" : "词库已保存", { type: "success" });
    editorVisible.value = false;
    await load();
  } catch (error) {
    message(error instanceof Error ? error.message : "保存失败", {
      type: "error"
    });
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: Lexicon) {
  try {
    await ElMessageBox.confirm(
      `删除词库「${row.name}」？已经生成的谜题不会受影响。`,
      "删除词库",
      { type: "warning" }
    );
  } catch {
    return;
  }
  try {
    await deleteLexicon(row.id);
    message("已删除", { type: "success" });
    await load();
  } catch {
    message("删除失败", { type: "error" });
  }
}

onMounted(load);
</script>

<template>
  <div class="page">
    <el-card shadow="never" class="key-card">
      <div class="key-row">
        <el-input
          v-model="apiKey"
          show-password
          clearable
          placeholder="DeepSeek API Key"
          style="max-width: 420px"
        />
        <el-button type="primary" @click="saveKey">保存 Key</el-button>
      </div>
      <p v-if="!savedKey" class="hint">
        用 DeepSeek 生成词库前，先把 API Key 保存在这台浏览器里。
      </p>
    </el-card>

    <el-card shadow="never">
      <div class="toolbar">
        <span class="title">词库</span>
        <div class="actions">
          <el-button @click="csvInput?.click()">导入 CSV</el-button>
          <el-button @click="fileInput?.click()">导入 JSON</el-button>
          <el-button :disabled="generating" @click="openBatch"
            >批量生成</el-button
          >
          <el-button type="primary" :disabled="batching" @click="openAi"
            >用 DeepSeek 生成</el-button
          >
          <input
            ref="csvInput"
            class="file"
            type="file"
            accept=".csv,text/csv"
            @change="onImportCsv"
          />
          <input
            ref="fileInput"
            class="file"
            type="file"
            accept="application/json,.json"
            @change="onImport"
          />
        </div>
      </div>
      <p class="hint">
        CSV 须有表头，只读取「单词」列，线索留空。例如：序号,单词,课次,翻译,…
      </p>
      <p class="hint">
        JSON：{"name":"animals","words":[{"answer":"TIGER","clue":"A large
        striped cat"}]}
      </p>

      <el-table v-loading="loading" :data="list" border>
        <el-table-column prop="name" label="名称" min-width="160" />
        <el-table-column label="单词" width="90">
          <template #default="{ row }">{{ row.words.length }}</template>
        </el-table-column>
        <el-table-column label="更新时间" min-width="160">
          <template #default="{ row }">{{
            formatTime(row.updatedAt)
          }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openEdit(row)"
              >编辑</el-button
            >
            <el-button link type="danger" @click="onDelete(row)"
              >删除</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="aiVisible"
      title="用 DeepSeek 生成词库"
      width="520px"
      destroy-on-close
    >
      <el-form label-width="88px">
        <el-form-item label="名称">
          <el-input
            v-model="ai.name"
            maxlength="64"
            placeholder="留空则使用主题"
          />
        </el-form-item>
        <el-form-item label="主题" required>
          <el-input
            v-model="ai.topic"
            maxlength="80"
            placeholder="如 animals、kitchen"
          />
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="ai.count" :min="2" :max="30" />
        </el-form-item>
        <el-form-item label="词长">
          <div class="length">
            <el-input-number v-model="ai.minLength" :min="2" :max="32" />
            <span>到</span>
            <el-input-number v-model="ai.maxLength" :min="2" :max="32" />
          </div>
        </el-form-item>
        <el-form-item label="难度">
          <el-select v-model="ai.level" style="width: 160px">
            <el-option
              v-for="item in LEXICON_LEVELS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="aiVisible = false">取消</el-button>
        <el-button type="primary" :loading="generating" @click="generateByAi">
          生成
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="batchVisible"
      title="批量生成词库"
      width="640px"
      :close-on-click-modal="!batching"
      :close-on-press-escape="!batching"
      :before-close="onBatchBeforeClose"
    >
      <el-form label-width="88px">
        <el-form-item label="主题" required>
          <el-input
            v-model="batch.topics"
            type="textarea"
            :rows="8"
            :disabled="batching"
            placeholder="每行一个主题，例如：&#10;animals&#10;kitchen&#10;space"
          />
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number
            v-model="batch.count"
            :min="2"
            :max="30"
            :disabled="batching"
          />
        </el-form-item>
        <el-form-item label="词长">
          <div class="length">
            <el-input-number
              v-model="batch.minLength"
              :min="2"
              :max="32"
              :disabled="batching"
            />
            <span>到</span>
            <el-input-number
              v-model="batch.maxLength"
              :min="2"
              :max="32"
              :disabled="batching"
            />
          </div>
        </el-form-item>
        <el-form-item label="难度">
          <el-select
            v-model="batch.level"
            :disabled="batching"
            style="width: 160px"
          >
            <el-option
              v-for="item in LEXICON_LEVELS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint">{{ batchHint }}</p>
      <div v-if="batchItems.length" class="batch-list">
        <div v-for="item in batchItems" :key="item.topic" class="batch-item">
          <el-tag :type="batchTag(item.status)" size="small" class="batch-tag">
            {{ batchLabel(item.status) }}
          </el-tag>
          <span class="batch-topic">{{ item.topic }}</span>
          <span class="batch-detail">{{ item.detail }}</span>
        </div>
      </div>
      <template #footer>
        <el-button v-if="batching" @click="stopBatch">停止</el-button>
        <el-button v-else @click="batchVisible = false">关闭</el-button>
        <el-button
          type="primary"
          :loading="batching"
          :disabled="!batchTopics.length"
          @click="generateBatch"
        >
          {{ batching ? `生成中 ${batchProgress}` : "开始生成" }}
        </el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="editorVisible"
      :title="editingId ? '编辑词库' : '保存词库'"
      width="760px"
      destroy-on-close
    >
      <el-form label-width="72px">
        <el-form-item label="名称">
          <el-input v-model="form.name" maxlength="64" />
        </el-form-item>
      </el-form>
      <div class="clue-head">
        <span>单词</span>
        <div class="clue-actions">
          <el-button size="small" @click="openAddWords">用接口增加</el-button>
          <el-button
            size="small"
            @click="form.words.push({ answer: '', clue: '' })"
          >
            添加
          </el-button>
        </div>
      </div>
      <el-table :data="form.words" border size="small" max-height="360">
        <el-table-column label="答案" width="180">
          <template #default="{ row }">
            <el-input v-model="row.answer" maxlength="32" />
          </template>
        </el-table-column>
        <el-table-column label="线索" min-width="220">
          <template #default="{ row }">
            <el-input v-model="row.clue" maxlength="512" />
          </template>
        </el-table-column>
        <el-table-column width="70">
          <template #default="{ $index }">
            <el-button link type="danger" @click="form.words.splice($index, 1)">
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
      <template #footer>
        <el-button @click="editorVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="addVisible"
      title="用接口增加单词"
      width="520px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="88px">
        <el-form-item label="主题" required>
          <el-input
            v-model="add.topic"
            maxlength="80"
            placeholder="如 animals、kitchen"
          />
        </el-form-item>
        <el-form-item label="数量">
          <el-input-number v-model="add.count" :min="1" :max="30" />
        </el-form-item>
        <el-form-item label="词长">
          <div class="length">
            <el-input-number v-model="add.minLength" :min="2" :max="32" />
            <span>到</span>
            <el-input-number v-model="add.maxLength" :min="2" :max="32" />
          </div>
        </el-form-item>
        <el-form-item label="难度">
          <el-select v-model="add.level" style="width: 160px">
            <el-option
              v-for="item in LEXICON_LEVELS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint">已有答案会跳过，新单词追加到当前列表，确认后再保存。</p>
      <template #footer>
        <el-button @click="addVisible = false">取消</el-button>
        <el-button type="primary" :loading="adding" @click="addWordsByAi">
          增加
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
}

.key-row,
.toolbar,
.length,
.clue-head {
  display: flex;
  gap: 8px;
  align-items: center;
}

.toolbar,
.clue-head {
  justify-content: space-between;
}

.toolbar {
  margin-bottom: 8px;
}

.title,
.clue-head {
  font-weight: 600;
}

.clue-head {
  margin-bottom: 8px;
}

.clue-actions {
  display: flex;
  gap: 8px;
}

.hint {
  margin: 8px 0 0;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.toolbar .hint {
  margin: 0;
}

.file {
  display: none;
}

.batch-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 240px;
  margin-top: 12px;
  overflow: auto;
}

.batch-item {
  display: flex;
  gap: 8px;
  align-items: center;
}

.batch-tag {
  flex: none;
}

.batch-topic {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-weight: 600;
  white-space: nowrap;
}

.batch-detail {
  flex: 1.4;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 13px;
  color: var(--el-text-color-secondary);
  white-space: nowrap;
}
</style>
