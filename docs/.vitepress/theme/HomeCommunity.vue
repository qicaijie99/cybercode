<script setup lang="ts">
import { computed } from 'vue'
import { useData, withBase } from 'vitepress'

const { lang } = useData()
const isChinese = computed(() => lang.value.startsWith('zh'))
const qrCodeUrl = withBase('/images/cybercode-qq-community.png')
</script>

<template>
  <section v-if="isChinese" class="home-community" aria-labelledby="home-community-title">
    <div class="home-community__inner">
      <div class="home-community__copy">
        <p class="home-community__eyebrow">CYBERCODE COMMUNITY</p>
        <h2 id="home-community-title">加入 CyberCode 用户群</h2>
        <p>交流使用心得、反馈问题，也可以围观新功能从想法变成代码。</p>
        <p class="home-community__number">QQ群：463169230</p>
      </div>

      <a
        class="home-community__qr-link"
        :href="qrCodeUrl"
        target="_blank"
        rel="noreferrer"
        aria-label="打开 CyberCode QQ 群二维码原图"
      >
        <img
          class="home-community__qr"
          :src="qrCodeUrl"
          alt="CyberCode AI研究中心 QQ 群二维码，群号 463169230"
          width="1284"
          height="2289"
          loading="lazy"
        >
      </a>
    </div>
  </section>
</template>
