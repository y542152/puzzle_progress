<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import TokenBar from "../TokenBar.vue";
import {
  createLevel,
  deleteLevel,
  getLevel,
  listLevels,
  listPuzzleOptions,
  updateLevel,
  type Difficulty,
  type Level,
  type PuzzleSummary
} from "@/api/crossword";
import {
  DIFFICULTY_OPTIONS,
  difficultyLabel,
  statusLabel,
  statusType
} from "../dict";

defineOptions({
  name: "CrosswordLevels"
});

const loading = ref(false);
const saving = ref(false);
const list = ref<Level[]>([]);
const puzzles = ref<PuzzleSummary[]>([]);
const dialogVisible = ref(false);
const editing = ref(false);

const form = reactive({
  level: 1,
  puzzleId: undefined as number | undefined,
  title: "",
  difficulty: "easy" as Difficulty,
  hintsLimit: 10
});

async function load() {
  loading.value = true;
  try {
    list.value = (await listLevels()) || [];
  } catch {
    list.value = [];
  } finally {
    loading.value = false;
  }
}

async function ensurePuzzles() {
  if (puzzles.value.length) return;
  try {
    puzzles.value = await listPuzzleOptions();
  } catch {
    puzzles.value = [];
  }
}

function resetForm() {
  const last = list.value[list.value.length - 1];
  form.level = (last?.level || 0) + 1;
  form.puzzleId = undefined;
  form.title = "";
  form.difficulty = "easy";
  form.hintsLimit = 10;
}

async function openCreate() {
  editing.value = false;
  resetForm();
  await ensurePuzzles();
  dialogVisible.value = true;
}

async function openEdit(row: Level) {
  editing.value = true;
  await ensurePuzzles();
  try {
    const detail = await getLevel(row.level);
    form.level = detail.level;
    form.puzzleId = detail.puzzleId;
    form.title = detail.title;
    form.difficulty = detail.difficulty;
    form.hintsLimit = detail.hintsLimit;
    dialogVisible.value = true;
  } catch {
    /* 错误已提示 */
  }
}

async function save() {
  const title = form.title.trim();
  if (!form.puzzleId) {
    message("请选择谜题", { type: "warning" });
    return;
  }
  if (!title || title.length > 64) {
    message("标题为 1 到 64 字", { type: "warning" });
    return;
  }
  if (!editing.value && form.level < 1) {
    message("关卡号从 1 起", { type: "warning" });
    return;
  }
  const payload = {
    level: form.level,
    puzzleId: form.puzzleId,
    title,
    difficulty: form.difficulty,
    hintsLimit: Number(form.hintsLimit)
  };
  saving.value = true;
  try {
    if (editing.value) {
      await updateLevel(form.level, payload);
      message("已更新", { type: "success" });
    } else {
      await createLevel(payload);
      message("已创建", { type: "success" });
    }
    dialogVisible.value = false;
    await load();
  } catch {
    /* 错误已提示 */
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: Level) {
  try {
    await ElMessageBox.confirm(
      `删除第 ${row.level} 关「${row.title}」？`,
      "删除关卡",
      {
        type: "warning"
      }
    );
  } catch {
    return;
  }
  try {
    await deleteLevel(row.level);
    message("已删除", { type: "success" });
    await load();
  } catch {
    /* 错误已提示 */
  }
}

function puzzleLabel(item: PuzzleSummary) {
  return `${item.code}（#${item.id}，${item.size}×${item.size}，${statusLabel(item.status)}）`;
}

onMounted(load);
</script>

<template>
  <div class="page">
    <TokenBar />
    <el-card shadow="never">
      <div class="toolbar">
        <el-button @click="load">刷新</el-button>
        <el-button type="primary" @click="openCreate">新建关卡</el-button>
      </div>
      <el-table v-loading="loading" :data="list" border>
        <el-table-column prop="level" label="关卡" width="80" />
        <el-table-column prop="title" label="标题" min-width="140" />
        <el-table-column label="难度" width="90">
          <template #default="{ row }">{{
            difficultyLabel(row.difficulty)
          }}</template>
        </el-table-column>
        <el-table-column prop="puzzleCode" label="谜题" min-width="140" />
        <el-table-column label="谜题状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.puzzleStatus)">
              {{ statusLabel(row.puzzleStatus) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="边长" width="80">
          <template #default="{ row }">{{ row.size }}×{{ row.size }}</template>
        </el-table-column>
        <el-table-column prop="hintsLimit" label="提示次数" width="100" />
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
      v-model="dialogVisible"
      :title="editing ? `编辑第 ${form.level} 关` : '新建关卡'"
      width="520px"
    >
      <el-form label-width="88px">
        <el-form-item label="关卡号">
          <el-input-number v-model="form.level" :min="1" :disabled="editing" />
        </el-form-item>
        <el-form-item label="谜题">
          <el-select
            v-model="form.puzzleId"
            filterable
            placeholder="选择谜题"
            style="width: 100%"
          >
            <el-option
              v-for="item in puzzles"
              :key="item.id"
              :label="puzzleLabel(item)"
              :value="item.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="标题">
          <el-input v-model="form.title" maxlength="64" />
        </el-form-item>
        <el-form-item label="难度">
          <el-select v-model="form.difficulty" style="width: 140px">
            <el-option
              v-for="item in DIFFICULTY_OPTIONS"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="提示次数">
          <el-input-number v-model="form.hintsLimit" :min="0" :max="100" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save"
          >保存</el-button
        >
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.page {
  padding: 16px;
}

.toolbar {
  display: flex;
  gap: 8px;
  justify-content: flex-end;
  margin-bottom: 12px;
}
</style>
