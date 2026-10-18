<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref } from "vue";
import { ElMessageBox, type TableInstance } from "element-plus";
import { copyTextToClipboard } from "@pureadmin/utils";
import { message } from "@/utils/message";
import TokenBar from "../TokenBar.vue";
import {
  fillChineseCluesByDeepseek,
  getDeepseekKey
} from "../lexicon/deepseek";
import { layoutIntoSquare } from "../lexicon/layout";
import { listLexicons } from "../lexicon/storage";
import type { Lexicon, LexiconWord } from "../lexicon/types";
import {
  createPuzzle,
  deletePuzzle,
  getPuzzle,
  listPuzzles,
  replaceClues,
  updatePuzzle,
  type ClueWrite,
  type PuzzleStatus,
  type PuzzleSummary
} from "@/api/crossword";
import { STATUS_OPTIONS, formatTime, statusLabel, statusType } from "../dict";

defineOptions({
  name: "CrosswordPuzzles"
});

const loading = ref(false);
const saving = ref(false);
const fillingClues = ref(false);
const list = ref<PuzzleSummary[]>([]);
const total = ref(0);
const query = reactive({
  status: undefined as PuzzleStatus | undefined,
  page: 1,
  pageSize: 20
});

const dialogVisible = ref(false);
const editingId = ref<number | null>(null);
const openedSize = ref(5);
const form = reactive({
  code: "",
  size: 5,
  status: 0 as PuzzleStatus,
  clues: [] as ClueWrite[]
});

function blankClue(): ClueWrite {
  return {
    direction: "across",
    number: 1,
    clue: "",
    answer: "",
    row: 0,
    col: 0
  };
}

async function load() {
  loading.value = true;
  try {
    const data = await listPuzzles({
      status: query.status,
      page: query.page,
      pageSize: query.pageSize
    });
    list.value = data.list || [];
    total.value = data.total || 0;
  } catch {
    list.value = [];
    total.value = 0;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

function openCreate() {
  editingId.value = null;
  openedSize.value = 5;
  form.code = "";
  form.size = 5;
  form.status = 0;
  form.clues = [blankClue()];
  dialogVisible.value = true;
}

async function openEdit(row: PuzzleSummary) {
  try {
    const detail = await getPuzzle(row.id);
    editingId.value = detail.id;
    openedSize.value = detail.size;
    form.code = detail.code;
    form.size = detail.size;
    form.status = detail.status;
    form.clues = (detail.clues || []).map(item => ({
      direction: item.direction,
      number: item.number,
      clue: item.clue,
      answer: item.answer,
      row: item.row,
      col: item.col
    }));
    if (!form.clues.length) form.clues.push(blankClue());
    dialogVisible.value = true;
  } catch {
    /* 错误已提示 */
  }
}

/** 题号不连贯时，按现有题号从小到大补成 1、2、3…。相同题号仍共用。 */
function compactClueNumbers() {
  const kept = form.clues.filter(
    item => (item.clue || "").trim() || (item.answer || "").trim()
  );
  const unique = [
    ...new Set(
      kept
        .map(item => Number(item.number))
        .filter(n => Number.isInteger(n) && n > 0)
    )
  ].sort((a, b) => a - b);
  if (unique.every((n, index) => n === index + 1)) return;
  const next = new Map(unique.map((n, index) => [n, index + 1]));
  for (const item of kept) {
    const number = next.get(Number(item.number));
    if (number) item.number = number;
  }
}

const missingClueAnswers = computed(() => {
  const seen = new Set<string>();
  const answers: string[] = [];
  for (const item of form.clues) {
    const answer = item.answer.trim().toUpperCase();
    if (!answer || item.clue.trim() || seen.has(answer)) continue;
    if (!/^[A-Z]{2,32}$/.test(answer)) continue;
    seen.add(answer);
    answers.push(answer);
  }
  return answers;
});

async function fillClues() {
  if (fillingClues.value) return;
  const key = getDeepseekKey();
  if (!key) {
    message("请先在词库页保存 DeepSeek API Key", { type: "warning" });
    return;
  }
  const answers = missingClueAnswers.value;
  if (!answers.length) {
    message("没有缺少线索的英文答案", { type: "warning" });
    return;
  }
  fillingClues.value = true;
  try {
    const { clues, skipped } = await fillChineseCluesByDeepseek({
      apiKey: key,
      answers
    });
    const byAnswer = new Map(clues.map(item => [item.answer, item.clue]));
    let filled = 0;
    for (const item of form.clues) {
      if (item.clue.trim()) continue;
      const clue = byAnswer.get(item.answer.trim().toUpperCase());
      if (!clue) continue;
      item.clue = clue;
      filled += 1;
    }
    message(
      skipped
        ? `已填充 ${filled} 条中文线索，${skipped} 个答案没有可用结果`
        : `已填充 ${filled} 条中文线索`,
      { type: skipped ? "warning" : "success" }
    );
  } catch (error) {
    message(error instanceof Error ? error.message : "填充失败", {
      type: "error"
    });
  } finally {
    fillingClues.value = false;
  }
}

function normalizeClues(): ClueWrite[] {
  return form.clues
    .filter(item => item.clue.trim() || item.answer.trim())
    .map(item => ({
      direction: item.direction,
      number: Number(item.number),
      clue: item.clue.trim(),
      answer: item.answer.trim(),
      row: Number(item.row),
      col: Number(item.col)
    }));
}

async function save() {
  const code = form.code.trim().toLowerCase();
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(code) || code.length > 64) {
    message("标识需为小写字母、数字和连字符，且以字母开头", {
      type: "warning"
    });
    return;
  }
  if (form.size < 1 || form.size > 32) {
    message("边长须在 1 到 32 之间", { type: "warning" });
    return;
  }
  compactClueNumbers();
  const clues = normalizeClues();
  const size = Number(form.size);
  saving.value = true;
  try {
    if (!editingId.value) {
      await createPuzzle({ code, size, status: form.status, clues });
      message("已创建", { type: "success" });
    } else if (size === openedSize.value) {
      await updatePuzzle(editingId.value, { code, size, status: form.status });
      await replaceClues(editingId.value, clues);
      message("已更新", { type: "success" });
    } else {
      await updatePuzzle(editingId.value, {
        code,
        size,
        status: form.status,
        clues
      });
      message("已更新", { type: "success" });
    }
    dialogVisible.value = false;
    await load();
  } catch {
    /* 错误已提示 */
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: PuzzleSummary) {
  try {
    await ElMessageBox.confirm(
      `删除谜题「${row.code}」？仍被关卡或每日使用时无法删除。`,
      "删除谜题",
      { type: "warning" }
    );
  } catch {
    return;
  }
  try {
    await deletePuzzle(row.id);
    message("已删除", { type: "success" });
    await load();
  } catch {
    /* 错误已提示 */
  }
}

const generateVisible = ref(false);
const generating = ref(false);
const lexicons = ref<Lexicon[]>([]);
const lexiconId = ref("");
const draftWords = ref<LexiconWord[]>([]);
const wordTable = ref<TableInstance>();
const pickedWords = ref<LexiconWord[]>([]);

const activeLexicon = computed(
  () => lexicons.value.find(item => item.id === lexiconId.value) || null
);

function canPick(row: LexiconWord) {
  const size = Number(form.size);
  return row.answer.length >= 2 && row.answer.length <= size;
}

function selectEligible() {
  const table = wordTable.value;
  if (!table) return;
  table.clearSelection();
  for (const row of draftWords.value) {
    if (canPick(row)) table.toggleRowSelection(row, true);
  }
}

function syncDraft() {
  draftWords.value = (activeLexicon.value?.words || []).map(word => ({
    ...word
  }));
}

function lowercaseWords() {
  draftWords.value = draftWords.value.map(word => ({
    ...word,
    answer: word.answer.toLowerCase()
  }));
  nextTick(selectEligible);
}

async function openGenerate() {
  try {
    lexicons.value = await listLexicons();
  } catch {
    message("无法读取本地词库", { type: "error" });
    return;
  }
  if (!lexicons.value.some(item => item.id === lexiconId.value)) {
    lexiconId.value = lexicons.value[0]?.id || "";
  }
  syncDraft();
  generateVisible.value = true;
  await nextTick();
  selectEligible();
}

function onPick(rows: LexiconWord[]) {
  pickedWords.value = rows;
}

async function onLexiconChange() {
  syncDraft();
  await nextTick();
  selectEligible();
}

async function applyGenerate() {
  const chosen = pickedWords.value.filter(canPick);
  if (!chosen.length) {
    message("请至少选择一个不超过边长的单词", { type: "warning" });
    return;
  }
  const dirty = form.clues.some(item => item.clue.trim() || item.answer.trim());
  if (dirty) {
    try {
      await ElMessageBox.confirm("生成结果会替换当前线索。", "从词库生成", {
        type: "warning"
      });
    } catch {
      return;
    }
  }
  generating.value = true;
  await nextTick();
  try {
    const outcome = layoutIntoSquare(chosen, Number(form.size));
    if (!outcome.clues.length) {
      message("选中的单词无法交叉，或排不进当前边长", { type: "warning" });
      return;
    }
    form.size = outcome.size;
    form.clues = outcome.clues.map(item => {
      const source = chosen.find(
        word => word.answer.toLowerCase() === item.answer.toLowerCase()
      );
      return {
        ...item,
        answer: source?.answer || item.answer
      };
    });
    generateVisible.value = false;
    if (outcome.dropped.length) {
      const names = outcome.dropped
        .slice(0, 12)
        .map(answer => {
          const source = chosen.find(
            word => word.answer.toLowerCase() === answer.toLowerCase()
          );
          return source?.answer || answer;
        })
        .join("、");
      const more =
        outcome.dropped.length > 12 ? ` 等 ${outcome.dropped.length} 个` : "";
      message(
        `已生成 ${outcome.clues.length} 条线索，未放入：${names}${more}`,
        { type: "warning" }
      );
    } else {
      message(`已生成 ${outcome.clues.length} 条线索`, { type: "success" });
    }
  } finally {
    generating.value = false;
  }
}

const cells = computed(() => {
  const size = Number(form.size) || 0;
  const board = Array.from(
    { length: Math.max(size, 0) * Math.max(size, 0) },
    () => ({
      on: false,
      letter: "",
      number: 0
    })
  );
  if (size < 1 || size > 32) return board;
  for (const clue of form.clues) {
    const answer = clue.answer || "";
    if (!answer.trim()) continue;
    for (let i = 0; i < answer.length; i += 1) {
      const row =
        clue.direction === "down" ? Number(clue.row) + i : Number(clue.row);
      const col =
        clue.direction === "across" ? Number(clue.col) + i : Number(clue.col);
      if (row < 0 || col < 0 || row >= size || col >= size) continue;
      const cell = board[row * size + col];
      cell.on = true;
      if (/[A-Za-z]/.test(answer[i])) cell.letter = answer[i];
      if (i === 0 && clue.number) cell.number = Number(clue.number);
    }
  }
  return board;
});

function boardJson() {
  const size = Number(form.size);
  const grid: string[] = [];
  if (size >= 1 && size <= 32) {
    for (let row = 0; row < size; row += 1) {
      let line = "";
      for (let col = 0; col < size; col += 1) {
        const cell = cells.value[row * size + col];
        line += !cell?.on ? "#" : cell.letter || ".";
      }
      grid.push(line);
    }
  }
  return {
    size,
    grid,
    clues: normalizeClues()
  };
}

async function copyBoard() {
  const text = JSON.stringify(boardJson(), null, 2);
  try {
    await navigator.clipboard.writeText(text);
    message("已复制盘面 JSON", { type: "success" });
    return;
  } catch {
    /* 浏览器不允许直接写剪贴板时，退回选中复制 */
  }
  const ok = copyTextToClipboard(text);
  message(ok ? "已复制盘面 JSON" : "复制失败", {
    type: ok ? "success" : "error"
  });
}

onMounted(load);
</script>

<template>
  <div class="page">
    <TokenBar />
    <el-card shadow="never">
      <div class="toolbar">
        <div class="filters">
          <el-select
            v-model="query.status"
            clearable
            placeholder="全部状态"
            style="width: 140px"
            @change="onSearch"
          >
            <el-option
              v-for="item in STATUS_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
          <el-button @click="load">刷新</el-button>
        </div>
        <el-button type="primary" @click="openCreate">新建谜题</el-button>
      </div>

      <el-table v-loading="loading" :data="list" border>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="code" label="标识" min-width="140" />
        <el-table-column label="边长" width="80">
          <template #default="{ row }">{{ row.size }}×{{ row.size }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{
              statusLabel(row.status)
            }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="clueCount" label="线索" width="80" />
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

      <div class="pager">
        <el-pagination
          v-model:current-page="query.page"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          background
          @current-change="load"
          @size-change="onSearch"
        />
      </div>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editingId ? `编辑谜题 #${editingId}` : '新建谜题'"
      width="980px"
      destroy-on-close
    >
      <div class="editor">
        <div class="editor-main">
          <el-form label-width="72px">
            <el-form-item label="标识">
              <el-input
                v-model="form.code"
                maxlength="64"
                placeholder="如 cup-tea"
              />
            </el-form-item>
            <el-form-item label="边长">
              <el-input-number v-model="form.size" :min="1" :max="32" />
            </el-form-item>
            <el-form-item label="状态">
              <el-select v-model="form.status" style="width: 140px">
                <el-option
                  v-for="item in STATUS_OPTIONS"
                  :key="item.value"
                  :label="item.label"
                  :value="item.value"
                />
              </el-select>
            </el-form-item>
          </el-form>

          <div class="clue-head">
            <span>线索</span>
            <div class="clue-actions">
              <el-button size="small" @click="openGenerate"
                >从词库生成</el-button
              >
              <el-button
                size="small"
                :loading="fillingClues"
                :disabled="!missingClueAnswers.length"
                @click="fillClues"
              >
                填充中文线索
              </el-button>
              <el-button size="small" @click="form.clues.push(blankClue())"
                >添加</el-button
              >
            </div>
          </div>
          <el-table :data="form.clues" border size="small" max-height="360">
            <el-table-column label="方向" width="110">
              <template #default="{ row }">
                <el-select v-model="row.direction">
                  <el-option label="横向" value="across" />
                  <el-option label="纵向" value="down" />
                </el-select>
              </template>
            </el-table-column>
            <el-table-column label="题号" width="90">
              <template #default="{ row }">
                <el-input-number
                  v-model="row.number"
                  :min="1"
                  :max="999"
                  :controls="false"
                />
              </template>
            </el-table-column>
            <el-table-column label="提示" min-width="140">
              <template #default="{ row }">
                <el-input v-model="row.clue" maxlength="512" />
              </template>
            </el-table-column>
            <el-table-column label="答案" width="110">
              <template #default="{ row }">
                <el-input v-model="row.answer" maxlength="32" />
              </template>
            </el-table-column>
            <el-table-column label="行" width="80">
              <template #default="{ row }">
                <el-input-number v-model="row.row" :min="0" :controls="false" />
              </template>
            </el-table-column>
            <el-table-column label="列" width="80">
              <template #default="{ row }">
                <el-input-number v-model="row.col" :min="0" :controls="false" />
              </template>
            </el-table-column>
            <el-table-column width="70">
              <template #default="{ $index }">
                <el-button
                  link
                  type="danger"
                  @click="form.clues.splice($index, 1)"
                >
                  删除
                </el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
        <div class="preview">
          <div class="preview-head">
            <p class="preview-title">盘面预览</p>
            <el-button size="small" @click="copyBoard">复制 JSON</el-button>
          </div>
          <div
            v-if="form.size >= 1 && form.size <= 32"
            class="board"
            :style="{ gridTemplateColumns: `repeat(${form.size}, 28px)` }"
          >
            <div
              v-for="(cell, index) in cells"
              :key="index"
              class="cell"
              :class="{ on: cell.on }"
            >
              <sup v-if="cell.number">{{ cell.number }}</sup>
              {{ cell.letter }}
            </div>
          </div>
        </div>
      </div>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >
      </template>
    </el-dialog>

    <el-dialog
      v-model="generateVisible"
      title="从词库生成"
      width="720px"
      append-to-body
      destroy-on-close
    >
      <el-form label-width="72px">
        <el-form-item label="词库">
          <el-select
            v-model="lexiconId"
            placeholder="选择词库"
            style="width: 280px"
            @change="onLexiconChange"
          >
            <el-option
              v-for="item in lexicons"
              :key="item.id"
              :label="`${item.name}（${item.words.length}）`"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
      </el-form>
      <p class="hint">
        当前边长 {{ form.size }}×{{
          form.size
        }}。超出边长的单词不能选。长词会先排成横条，短词再纵向穿过去。排不进方盘，或和主盘面没有交叉的单词会丢掉。生成后会去掉空行和空列，但同一行或同一列上的两个词之间会留下一格黑格。边长改成刚好包住内容的方盘。
      </p>
      <el-table
        v-if="activeLexicon"
        ref="wordTable"
        :data="draftWords"
        border
        size="small"
        max-height="360"
        row-key="answer"
        @selection-change="onPick"
      >
        <el-table-column type="selection" width="48" :selectable="canPick" />
        <el-table-column prop="answer" label="答案" width="140" />
        <el-table-column prop="clue" label="线索" min-width="180" />
        <el-table-column label="" width="90">
          <template #default="{ row }">
            <span v-if="!canPick(row)" class="muted">超出边长</span>
          </template>
        </el-table-column>
      </el-table>
      <el-empty v-else description="还没有词库，请先在「词库」页面创建或导入" />
      <template #footer>
        <el-button @click="generateVisible = false">取消</el-button>
        <el-button :disabled="!draftWords.length" @click="lowercaseWords">
          一键小写
        </el-button>
        <el-button
          type="primary"
          :loading="generating"
          :disabled="!activeLexicon"
          @click="applyGenerate"
        >
          生成盘面
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  padding: 16px;
}

.toolbar,
.pager,
.clue-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.toolbar {
  margin-bottom: 12px;
}

.filters {
  display: flex;
  gap: 8px;
}

.pager {
  justify-content: flex-end;
  margin-top: 12px;
}

.editor {
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.editor-main {
  flex: 1;
  min-width: 0;
}

.clue-head {
  margin-bottom: 8px;
  font-weight: 600;
}

.clue-actions {
  display: flex;
  gap: 8px;
}

.hint,
.muted {
  font-size: 13px;
  color: var(--el-text-color-secondary);
}

.hint {
  margin: 0 0 8px;
}

.preview-head {
  display: flex;
  gap: 8px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.preview-title {
  margin: 0;
  font-weight: 600;
}

.board {
  display: grid;
  gap: 2px;
  width: max-content;
  max-height: 480px;
  padding: 2px;
  overflow: auto;
  background: #dcdfe6;
}

.cell {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  font-size: 12px;
  color: #fff;
  background: #303133;
}

.cell.on {
  color: #303133;
  background: #fff;
}

.cell sup {
  position: absolute;
  top: 0;
  left: 1px;
  font-size: 9px;
  line-height: 1;
}
</style>
