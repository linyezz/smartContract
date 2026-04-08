<template>
  <div class="header-row">
    <div>
      <h2 class="section-title">{{ title }}</h2>
      <p class="section-subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.extra">
      <slot name="extra" />
    </div>
  </div>
</template>

<script setup>
defineProps({
  title: {
    type: String,
    required: true
  },
  subtitle: {
    type: String,
    default: ''
  }
})
</script>

<style scoped>
.header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 18px;
}

@media (max-width: 760px) {
  .header-row {
    flex-direction: column;
    align-items: flex-start;
  }
}
</style>
