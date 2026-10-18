<script setup lang="ts">
import { onMounted, reactive, ref } from "vue";
import { ElMessageBox } from "element-plus";
import { message } from "@/utils/message";
import TokenBar from "../TokenBar.vue";
import {
  createDaily,
  deleteDaily,
  getDaily,
  listDaily,
  listPuzzleOptions,
  updateDaily,
  type Daily,
  type PuzzleSummary
} from "@/api/crossword";
import { statusLabel, statusType } from "../dict";

defineOptions({
  name: "CrosswordDaily"
});

const loading = ref(false);
const saving = ref(false);
const list = ref<Daily[]>([]);
const puzzles = ref<PuzzleSummary[]>([]);
const range = ref<[string, string] | null>(null);
const dialogVisible = ref(false);
const editing = ref(false);

const form = reactive({
  date: "",
  puzzleId: undefined as number | undefined,
  title: "",
  hintsLimit: 10
});

async function load() {
  loading.value = true;
  try {
    const [from, to] = range.value || [];
    list.value = (await listDaily(from && to ? { from, to } : undefined)) || [];
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

async function openCreate() {
  editing.value = false;
  form.date = "";
  form.puzzleId = undefined;
  form.title = "";
  form.hintsLimit = 10;
  await ensurePuzzles();
  dialogVisible.value = true;
}

async function openEdit(row: Daily) {
  editing.value = true;
  await ensurePuzzles();
  try {
    const detail = await getDaily(row.date);
    form.date = detail.date;
    form.puzzleId = detail.puzzleId;
    form.title = detail.title;
    form.hintsLimit = detail.hintsLimit;
    dialogVisible.value = true;
  } catch {
    /* 错误已提示 */
  }
}

async function save() {
  const title = form.title.trim();
  if (!editing.value && !/^\d{4}-\d{2}-\d{2}$/.test(form.date)) {
    message("请选择日期", { type: "warning" });
    return;
  }
  if (!form.puzzleId) {
    message("请选择谜题", { type: "warning" });
    return;
  }
  if (!title || title.length > 64) {
    message("标题为 1 到 64 字", { type: "warning" });
    return;
  }
  const payload = {
    date: form.date,
    puzzleId: form.puzzleId,
    title,
    hintsLimit: Number(form.hintsLimit)
  };
  saving.value = true;
  try {
    if (editing.value) {
      await updateDaily(form.date, payload);
      message("已更新", { type: "success" });
    } else {
      await createDaily(payload);
      message("已安排", { type: "success" });
    }
    dialogVisible.value = false;
    await load();
  } catch {
    /* 错误已提示 */
  } finally {
    saving.value = false;
  }
}

async function onDelete(row: Daily) {
  try {
    await ElMessageBox.confirm(`取消 ${row.date} 的每日谜题？`, "取消安排", {
      type: "warning"
    });
  } catch {
    return;
  }
  try {
    await deleteDaily(row.date);
    message("已取消", { type: "success" });
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
        <div class="filters">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            @change="load"
          />
          <el-button @click="load">刷新</el-button>
        </div>
        <el-button type="primary" @click="openCreate">安排一天</el-button>
      </div>
      <p class="hint">
        不选日期时，列出北京时间今天的前 7 天到后 30 天。范围最长 400 天。
      </p>
      <el-table v-loading="loading" :data="list" border>
        <el-table-column prop="date" label="日期" width="120" />
        <el-table-column prop="title" label="标题" min-width="140" />
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
              >取消</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="editing ? `编辑 ${form.date}` : '安排每日谜题'"
      width="520px"
    >
      <el-form label-width="88px">
        <el-form-item label="日期">
          <el-date-picker
            v-model="form.date"
            type="date"
            value-format="YYYY-MM-DD"
            placeholder="选择日期"
            :disabled="editing"
            style="width: 100%"
          />
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
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.filters {
  display: flex;
  gap: 8px;
  align-items: center;
}

.hint {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
