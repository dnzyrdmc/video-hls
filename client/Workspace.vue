<script setup>
import { ref, onMounted, onUnmounted, nextTick } from "vue";
import Hls from "hls.js";
import { api, act, base64 } from "./api";
const videos = ref([]),
  title = ref("Demo video"),
  file = ref(null),
  player = ref(null),
  selected = ref(null),
  busy = ref(false);
let timer, hls;
async function load() {
  videos.value = await api("/videos");
}
async function upload() {
  if (!file.value) throw new Error("MP4 seç");
  if (file.value.size > 8 * 1024 * 1024) throw new Error("En fazla 8 MB");
  busy.value = true;
  try {
    await api("/videos", "POST", {
      title: title.value,
      base64: await base64(file.value),
    });
    await load();
  } finally {
    busy.value = false;
  }
}
async function play(v) {
  selected.value = v;
  await nextTick();
  hls?.destroy();
  const url = "/api/videos/" + v.id + "/file/index.m3u8";
  if (Hls.isSupported()) {
    hls = new Hls();
    hls.loadSource(url);
    hls.attachMedia(player.value);
  } else player.value.src = url;
}
onMounted(async () => {
  await act(load, "");
  timer = setInterval(() => act(load, ""), 3000);
});
onUnmounted(() => {
  clearInterval(timer);
  hls?.destroy();
});
</script>
<template>
  <div class="grid">
    <form class="panel" @submit.prevent="act(upload, 'İşleme alındı')">
      <h2>MP4 yükle ve HLS üret</h2>
      <label>Başlık<input v-model="title" required /></label
      ><label
        >MP4 · en fazla 8 MB<input
          type="file"
          accept="video/mp4"
          @change="file = $event.target.files[0]" /></label
      ><button :disabled="busy">{{ busy ? "Yükleniyor..." : "Yükle" }}</button>
      <p class="muted">
        FFmpeg yerel olarak kurulu olmalı. Demo ilk 30 saniyeyi 640 piksel
        genişliğinde dönüştürür.
      </p>
    </form>
    <section class="panel">
      <h2>HLS oynatıcı</h2>
      <video v-if="selected" ref="player" controls></video>
      <p v-else class="empty">Hazır bir video seç.</p>
    </section>
  </div>
  <section class="panel">
    <h2>İş kuyruğu</h2>
    <div class="card" v-for="v in videos">
      <div class="toolbar">
        <strong>{{ v.title }}</strong
        ><span class="badge">{{ v.status }}</span
        ><button v-if="v.status === 'ready'" @click="act(() => play(v), '')">
          Oynat
        </button>
      </div>
      <pre v-if="v.error">{{ v.error }}</pre>
    </div>
  </section>
</template>
