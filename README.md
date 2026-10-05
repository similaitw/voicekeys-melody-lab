# VoiceKeys — Voice to Piano Melody Studio

功能等價重製版：在瀏覽器中把歌曲或人聲轉成鋼琴旋律。

## 功能

- MP3 / WAV / M4A 拖曳與上傳，限制 10 分鐘 / 50 MB
- 完整歌曲：使用 `web-audio-separation` + `UVR-MDX-NET-Voc_FT`（約 67 MB）在瀏覽器分離人聲
- 純人聲：跳過分離，直接做單音旋律辨識
- 音域篩選、音量閘值、音高追蹤、跳音平滑與音符切分
- 波形、下落式音符、可點擊鋼琴鍵盤
- 鋼琴 / 原曲 / 人聲 / 合奏播放模式
- 五線譜 / 簡譜、BPM 量化、簡譜調性選擇、播放跟隨翻頁
- MIDI 匯出
- 分離模型載入失敗時，自動退回直接辨識，不讓整個流程中斷
- 不需要後端；音訊不會上傳

## 部署

本版可直接由 Vercel 以靜態網站部署；人聲分離套件會在需要時由 CDN 載入，不需要伺服器後端。

## 模型與授權

人聲分離透過 MIT 授權的 `web-audio-separation`，模型為 `UVR-MDX-NET-Voc_FT`。第一次使用會由 Hugging Face 下載模型並由瀏覽器快取。

## 建議瀏覽器

Chrome / Edge 桌機版最佳。WebGPU 可用時效能較好；舊裝置仍可用 WASM，但長音檔分析會明顯較慢。
