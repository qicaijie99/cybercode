<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useData, withBase } from 'vitepress'

const { lang } = useData()
const isChinese = computed(() => lang.value.startsWith('zh'))
const qrCodeUrl = withBase('/images/cybercode-qq-community.png')
const isOpen = ref(false)
const dialogPanel = ref<HTMLElement | null>(null)
let previousBodyOverflow = ''
let previouslyFocusedElement: HTMLElement | null = null

function syncWithHash() {
  isOpen.value = window.location.hash === '#join-community'
}

function closeModal() {
  isOpen.value = false
  if (window.location.hash === '#join-community') {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    )
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (event.key === 'Escape' && isOpen.value) closeModal()
}

watch(isOpen, async (open) => {
  if (typeof document === 'undefined') return
  if (open) {
    previouslyFocusedElement = document.activeElement as HTMLElement | null
    previousBodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    await nextTick()
    dialogPanel.value?.focus()
  } else {
    document.body.style.overflow = previousBodyOverflow
    previouslyFocusedElement?.focus()
    previouslyFocusedElement = null
  }
})

onMounted(() => {
  syncWithHash()
  window.addEventListener('hashchange', syncWithHash)
  window.addEventListener('keydown', handleKeyDown)
})

onBeforeUnmount(() => {
  window.removeEventListener('hashchange', syncWithHash)
  window.removeEventListener('keydown', handleKeyDown)
  document.body.style.overflow = previousBodyOverflow
})
</script>

<template>
  <span v-if="isChinese" id="join-community" class="home-community-anchor" aria-hidden="true" />

  <Teleport v-if="isChinese" to="body">
    <Transition name="home-community-modal">
      <div
        v-if="isOpen"
        class="home-community-modal__backdrop"
        @click.self="closeModal"
      >
        <section
          ref="dialogPanel"
          class="home-community-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="home-community-title"
          tabindex="-1"
        >
          <button
            type="button"
            class="home-community-modal__close"
            aria-label="关闭加群二维码"
            @click="closeModal"
          >
            <span aria-hidden="true">×</span>
          </button>

          <header class="home-community-modal__header">
            <p class="home-community-modal__eyebrow">CYBERCODE COMMUNITY</p>
            <h2 id="home-community-title">加入 CyberCode 用户群</h2>
            <p>使用手机 QQ 扫描二维码，交流使用心得、反馈问题和关注新功能。</p>
          </header>

          <a
            class="home-community-modal__qr-link"
            :href="qrCodeUrl"
            target="_blank"
            rel="noreferrer"
            aria-label="打开 CyberCode QQ 群二维码原图"
          >
            <img
              class="home-community-modal__qr"
              :src="qrCodeUrl"
              alt="CyberCode AI研究中心 QQ 群二维码，群号 463169230"
              width="1284"
              height="2289"
            >
          </a>

          <p class="home-community-modal__number">QQ群：463169230</p>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>
