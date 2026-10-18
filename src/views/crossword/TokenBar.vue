<script setup lang="ts">
import { ref } from "vue";
import { message } from "@/utils/message";
import { getCrosswordToken, setCrosswordToken } from "@/api/crossword";

defineOptions({
  name: "CrosswordTokenBar"
});

const token = ref(getCrosswordToken());
const saved = ref(getCrosswordToken());

function save() {
  setCrosswordToken(token.value);
  saved.value = getCrosswordToken();
  message(saved.value ? "管理端令牌已保存" : "已清空管理端令牌", {
    type: saved.value ? "success" : "warning"
  });
}
</script>

<template>
  <div class="token-bar">
    <el-alert
      v-if="!saved"
      title="请填写管理端令牌。请求会带上 X-Crossword-Token，对应服务端环境变量 CROSSWORD_CONSOLE_TOKEN。"
      type="warning"
      show-icon
      :closable="false"
    />
    <div class="token-row">
      <el-input
        v-model="token"
        show-password
        clearable
        placeholder="X-Crossword-Token"
        style="max-width: 420px"
      />
      <el-button type="primary" @click="save">保存令牌</el-button>
    </div>
  </div>
</template>

<style scoped>
.token-bar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 16px;
}

.token-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
