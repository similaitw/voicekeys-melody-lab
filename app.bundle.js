const $ = (id) => document.getElementById(id);
const els = {
  fileInput: $('fileInput'), dropZone: $('dropZone'), dropTitle: $('dropTitle'), dropHint: $('dropHint'), sampleBtn: $('sampleBtn'),
  rangeSelect: $('rangeSelect'), contentSelect: $('contentSelect'), analyzeBtn: $('analyzeBtn'), analyzeBtnText: $('analyzeBtnText'), cancelBtn: $('cancelBtn'),
  statusText: $('statusText'), statusPct: $('statusPct'), progressBar: $('progressBar'),
  noteCount: $('noteCount'), noteRange: $('noteRange'), confidence: $('confidence'), durationMetric: $('durationMetric'), midiBtn: $('midiBtn'),
  playerHeading: $('playerHeading'), playerSub: $('playerSub'), waveform: $('waveform'), restartBtn: $('restartBtn'), playBtn: $('playBtn'), timeLabel: $('timeLabel'), seek: $('seek'),
  speedSelect: $('speedSelect'), volume: $('volume'), fallingCanvas: $('fallingCanvas'), pianoCanvas: $('pianoCanvas'), currentNote: $('currentNote'),
  originalAudio: $('originalAudio'), vocalAudio: $('vocalAudio'), bpm: $('bpm'), keySelect: $('keySelect'), followScore: $('followScore'), scoreSvg: $('scoreSvg'), scoreEmpty: $('scoreEmpty'),
  prevPage: $('prevPage'), nextPage: $('nextPage'), pageLabel: $('pageLabel')
};

const state = {
  file: null,
  fileUrl: null,
  originalBuffer: null,
  vocalBuffer: null,
  vocalUrl: null,
  pitchFrames: [],
  notes: [],
  analyzing: false,
  abortRequested: false,
  mode: 'piano',
  scoreMode: 'staff',
  scorePage: 0,
  scorePages: 0,
  lastPlayerTime: 0,
  raf: 0,
  audioCtx: null,
  activeSynth: new Set(),
  pianoLayout: [],
  duration: 0,
  analysisStarted: 0,
  warning: ''
};

const rangeMap = {
  auto: [70, 1200],
  low: [82.41, 329.63],
  mid: [110, 880],
  high: [164.81, 1046.5],
  wide: [65.41, 2093]
};

const noteNames = ['C','C♯','D','D♯','E','F','F♯','G','G♯','A','A♯','B'];
const isBlackPc = (pc) => [1,3,6,8,10].includes(pc);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sleep = (ms = 0) => new Promise(r => setTimeout(r, ms));

function formatTime(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}
function midiName(midi) {
  const n = Math.round(midi);
  return `${noteNames[(n % 12 + 12) % 12]}${Math.floor(n / 12) - 1}`;
}
function freqToMidi(freq) { return 69 + 12 * Math.log2(freq / 440); }
function midiToFreq(midi) { return 440 * Math.pow(2, (midi - 69) / 12); }

function setStatus(text, pct = null) {
  els.statusText.textContent = text;
  els.statusPct.textContent = pct == null ? '' : `${Math.round(pct)}%`;
  if (pct != null) els.progressBar.style.width = `${clamp(pct, 0, 100)}%`;
}
function resetPipeline() {
  document.querySelectorAll('.pipeline [data-stage]').forEach(el => el.classList.remove('active','done'));
}
function setStage(stage, text, pct = 0) {
  const order = ['separate','gate','pitch','smooth','ready'];
  const idx = order.indexOf(stage);
  document.querySelectorAll('.pipeline [data-stage]').forEach(el => {
    const i = order.indexOf(el.dataset.stage);
    el.classList.toggle('done', i < idx);
    el.classList.toggle('active', i === idx);
  });
  setStatus(text, pct);
}
function finishPipeline() {
  document.querySelectorAll('.pipeline [data-stage]').forEach(el => { el.classList.remove('active'); el.classList.add('done'); });
  els.progressBar.style.width = '100%';
}
function setAnalyzing(v) {
  state.analyzing = v;
  els.analyzeBtn.disabled = v || !state.file;
  els.cancelBtn.classList.toggle('hidden', !v);
  els.fileInput.disabled = v;
  els.sampleBtn.disabled = v;
}
function checkAbort() {
  if (state.abortRequested) throw new Error('__ABORT__');
}

function cleanupObjectUrl(key) {
  if (state[key] && String(state[key]).startsWith('blob:')) URL.revokeObjectURL(state[key]);
  state[key] = null;
}

async function decodeFile(file) {
  const ctx = getAudioContext();
  const arr = await file.arrayBuffer();
  return await ctx.decodeAudioData(arr.slice(0));
}
function getAudioContext() {
  if (!state.audioCtx) state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return state.audioCtx;
}

async function acceptFile(file, {isSample = false} = {}) {
  if (!file) return;
  const extOk = /\.(mp3|wav|m4a)$/i.test(file.name || '') || /^audio\//.test(file.type || '');
  if (!extOk) { alert('請選擇 MP3、WAV 或 M4A 音訊檔。'); return; }
  if (file.size > 50 * 1024 * 1024) { alert('檔案超過 50 MB，請換一個較小的音訊檔。'); return; }

  setStatus('正在讀取音訊…', 3);
  try {
    const buffer = await decodeFile(file);
    if (buffer.duration > 600.5) { alert('音訊超過 10 分鐘，請裁切後再試。'); return; }
    cleanupObjectUrl('fileUrl');
    cleanupObjectUrl('vocalUrl');
    state.file = file;
    state.fileUrl = URL.createObjectURL(file);
    state.originalBuffer = buffer;
    state.vocalBuffer = null;
    state.duration = buffer.duration;
    state.notes = [];
    state.pitchFrames = [];
    state.warning = '';

    els.originalAudio.src = state.fileUrl;
    els.vocalAudio.removeAttribute('src');
    els.dropTitle.textContent = file.name || '範例旋律';
    els.dropHint.textContent = `${formatTime(buffer.duration)} · ${(file.size / 1024 / 1024).toFixed(1)} MB`;
    els.analyzeBtn.disabled = false;
    if (isSample) els.contentSelect.value = 'solo';
    updateAnalyzeButton();
    resetAnalysisUI();
    drawWaveform(buffer);
    drawPiano();
    setStatus('歌曲已就緒，開始尋找旋律。', 0);
  } catch (err) {
    console.error(err);
    alert('瀏覽器無法解碼這個音訊檔。若是 M4A，請改用 Chrome / Edge 或轉成 MP3/WAV。');
  }
}

function resetAnalysisUI() {
  resetPipeline();
  els.noteCount.textContent = '—';
  els.noteRange.textContent = '—';
  els.confidence.textContent = '—';
  els.durationMetric.textContent = '—';
  els.midiBtn.disabled = true;
  els.restartBtn.disabled = true;
  els.playBtn.disabled = true;
  els.seek.disabled = true;
  els.seek.value = 0;
  els.seek.max = state.duration || 1;
  els.playerHeading.textContent = '等待你的第一段旋律';
  els.playerSub.textContent = state.file ? `已載入 ${formatTime(state.duration)}` : '尚未分析';
  els.timeLabel.textContent = `0:00 / ${formatTime(state.duration || 0)}`;
  els.scoreSvg.innerHTML = '';
  els.scoreEmpty.style.display = 'grid';
  els.pageLabel.textContent = '尚無樂譜';
  els.prevPage.disabled = true;
  els.nextPage.disabled = true;
  drawFalling(0);
}

function updateAnalyzeButton() {
  els.analyzeBtnText.textContent = els.contentSelect.value === 'song' ? '分離人聲並辨識' : '直接辨識旋律';
}

els.dropZone.addEventListener('click', () => els.fileInput.click());
els.dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); els.fileInput.click(); } });
els.fileInput.addEventListener('change', () => acceptFile(els.fileInput.files?.[0]));
['dragenter','dragover'].forEach(type => els.dropZone.addEventListener(type, e => { e.preventDefault(); els.dropZone.classList.add('drag'); }));
['dragleave','drop'].forEach(type => els.dropZone.addEventListener(type, e => { e.preventDefault(); els.dropZone.classList.remove('drag'); }));
els.dropZone.addEventListener('drop', e => acceptFile(e.dataTransfer?.files?.[0]));
els.contentSelect.addEventListener('change', updateAnalyzeButton);

els.sampleBtn.addEventListener('click', async () => {
  const sample = createDemoWav();
  await acceptFile(sample, {isSample:true});
});

function createDemoWav() {
  const sr = 44100;
  const melody = [
    [60,.65],[64,.65],[67,.65],[69,.65],[67,.9],[64,.55],[62,.55],[60,1.1],
    [64,.55],[65,.55],[67,.9],[72,.7],[69,.7],[67,.7],[64,1.05]
  ];
  const gap = .06;
  const total = melody.reduce((s,[,d]) => s + d + gap, 0) + .4;
  const data = new Float32Array(Math.ceil(total * sr));
  let t0 = .15;
  for (const [midi,dur] of melody) {
    const f = midiToFreq(midi);
    const start = Math.floor(t0 * sr), end = Math.min(data.length, Math.floor((t0 + dur) * sr));
    for (let i=start;i<end;i++) {
      const t=(i-start)/sr;
      const a=Math.min(1,t/.025)*Math.min(1,(dur-t)/.12);
      const vibrato = Math.sin(2*Math.PI*5*t)*.002;
      data[i] += a * (.48*Math.sin(2*Math.PI*f*(1+vibrato)*t)+.16*Math.sin(2*Math.PI*f*2*t)+.07*Math.sin(2*Math.PI*f*3*t));
    }
    t0 += dur + gap;
  }
  const blob = encodeMonoWav(data, sr);
  return new File([blob], 'VoiceKeys-Demo.wav', {type:'audio/wav'});
}

function encodeMonoWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const str = (o,s) => { for(let i=0;i<s.length;i++) view.setUint8(o+i,s.charCodeAt(i)); };
  str(0,'RIFF'); view.setUint32(4,36+samples.length*2,true); str(8,'WAVE'); str(12,'fmt ');
  view.setUint32(16,16,true); view.setUint16(20,1,true); view.setUint16(22,1,true); view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true); view.setUint16(32,2,true); view.setUint16(34,16,true); str(36,'data'); view.setUint32(40,samples.length*2,true);
  let o=44; for (let i=0;i<samples.length;i++,o+=2) { const s=clamp(samples[i],-1,1); view.setInt16(o, s<0?s*0x8000:s*0x7fff, true); }
  return new Blob([buffer], {type:'audio/wav'});
}

els.analyzeBtn.addEventListener('click', analyze);
els.cancelBtn.addEventListener('click', () => {
  state.abortRequested = true;
  els.cancelBtn.disabled = true;
  setStatus('已要求取消；目前步驟結束後停止。');
});

async function analyze() {
  if (!state.file || !state.originalBuffer || state.analyzing) return;
  pausePlayer();
  state.abortRequested = false;
  els.cancelBtn.disabled = false;
  state.analysisStarted = performance.now();
  state.warning = '';
  setAnalyzing(true);
  resetPipeline();
  try {
    let targetBuffer = state.originalBuffer;
    if (els.contentSelect.value === 'song') {
      setStage('separate', '準備人聲分離模型…', 2);
      try {
        const separated = await separateVocals(state.fileUrl);
        checkAbort();
        targetBuffer = separated.buffer;
        state.vocalBuffer = separated.buffer;
        cleanupObjectUrl('vocalUrl');
        state.vocalUrl = separated.url;
        els.vocalAudio.src = state.vocalUrl;
      } catch (err) {
        if (String(err?.message) === '__ABORT__') throw err;
        console.warn('Vocal separation failed, using fallback:', err);
        state.warning = '人聲模型無法載入，已改用本機中央聲道／直接辨識備援。';
        setStatus(`${state.warning} 正在繼續…`, 20);
        targetBuffer = createCenterVocalBuffer(state.originalBuffer);
        state.vocalBuffer = targetBuffer;
        cleanupObjectUrl('vocalUrl');
        state.vocalUrl = URL.createObjectURL(audioBufferToWavBlob(targetBuffer));
        els.vocalAudio.src = state.vocalUrl;
      }
    } else {
      setStage('separate', '純人聲模式：跳過人聲分離。', 100);
      state.vocalBuffer = state.originalBuffer;
      els.vocalAudio.src = state.fileUrl;
      await sleep(140);
    }
    checkAbort();

    setStage('gate', '分析音量，找出有效聲音區段…', 0);
    const pitchResult = await trackPitch(targetBuffer);
    checkAbort();
    state.pitchFrames = pitchResult.frames;

    setStage('smooth', '修正短暫跳音並切分音符…', 25);
    await sleep(20);
    state.notes = segmentNotes(state.pitchFrames, pitchResult.hopSeconds);
    checkAbort();
    setStage('smooth', '量化旋律並合併過短音符…', 80);
    state.notes = cleanupNotes(state.notes);
    await sleep(10);

    setStage('ready', '建立鋼琴、動畫與樂譜…', 90);
    finalizeAnalysis();
    finishPipeline();
    const suffix = state.warning ? ` ${state.warning}` : '';
    setStatus(`完成：找到 ${state.notes.length} 個旋律音符。${suffix}`, 100);
  } catch (err) {
    if (String(err?.message) === '__ABORT__') {
      setStatus('已取消分析。', 0);
      resetPipeline();
    } else {
      console.error(err);
      setStatus(`分析失敗：${err?.message || err}`, 0);
    }
  } finally {
    setAnalyzing(false);
    els.cancelBtn.disabled = false;
  }
}

async function separateVocals(objectUrl) {
  checkAbort();
  setStage('separate', '首次使用會下載約 67 MB 人聲模型…', 4);
  let mod;
  try {
    mod = await import('web-audio-separation');
  } catch (localImportError) {
    console.warn('Local package unavailable; trying CDN bundle.', localImportError);
    mod = await import('https://esm.sh/web-audio-separation@0.3.1?bundle&deps=onnxruntime-web@1.29.0');
  }
  checkAbort();
  const separator = mod.createSeparator('UVR-MDX-NET-Voc_FT', {
    common: {
      logLevel: 'warning',
      outputSingleStem: 'vocals',
      onProgress: (p) => {
        const f = clamp((p.fraction || 0) * 100, 0, 100);
        if (p.stage === 'loading-model') setStage('separate', '載入人聲模型…', 5 + f * .2);
        else if (p.stage === 'demixing') setStage('separate', `分離人聲${p.totalChunks ? ` · ${p.chunk || 0}/${p.totalChunks}` : ''}…`, 25 + f * .65);
        else if (p.stage === 'writing-output') setStage('separate', '整理人聲音軌…', 90 + f * .1);
      }
    },
    mdx: { executionProviders: ['webgpu','wasm'], overlap: 0.25, batchSize: 1 }
  });
  await separator.loadModel();
  checkAbort();
  const urls = await separator.separate(objectUrl);
  checkAbort();
  if (!urls?.length) throw new Error('人聲分離沒有產生輸出');
  const vocalUrl = urls[0];
  const ab = await fetch(vocalUrl).then(r => r.arrayBuffer());
  const buffer = await getAudioContext().decodeAudioData(ab.slice(0));
  setStage('separate', '人聲分離完成。', 100);
  return {url:vocalUrl, buffer};
}

function createCenterVocalBuffer(buffer) {
  const ctx = getAudioContext();
  const out = ctx.createBuffer(1, buffer.length, buffer.sampleRate);
  const dst = out.getChannelData(0);
  const l = buffer.getChannelData(0);
  const r = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : l;
  let prev = 0;
  for (let i=0;i<buffer.length;i++) {
    const mid = (l[i] + r[i]) * .5;
    const hp = mid - prev * .94;
    prev = mid;
    dst[i] = clamp(mid * .82 + hp * .18, -1, 1);
  }
  return out;
}

function audioBufferToWavBlob(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  const arr = new Float32Array(length);
  for (let c=0;c<channels;c++) {
    const d=buffer.getChannelData(c); for(let i=0;i<length;i++) arr[i]+=d[i]/channels;
  }
  return encodeMonoWav(arr, buffer.sampleRate);
}

async function trackPitch(buffer) {
  setStage('gate', '建立單聲道分析訊號…', 10);
  const mono = mixToMono(buffer);
  const [minHz, maxHz] = rangeMap[els.rangeSelect.value] || rangeMap.auto;
  const targetRate = maxHz > 900 ? 8000 : 4000;
  const signal = downsample(mono, buffer.sampleRate, targetRate);
  checkAbort();

  const frameSize = targetRate === 8000 ? 768 : 384;
  const hopSize = Math.round(targetRate * 0.032);
  const hopSeconds = hopSize / targetRate;
  const minLag = Math.max(2, Math.floor(targetRate / Math.min(maxHz, targetRate/2.2)));
  const maxLag = Math.min(frameSize - 8, Math.ceil(targetRate / Math.max(minHz, 55)));
  const frameCount = Math.max(0, Math.floor((signal.length - frameSize) / hopSize) + 1);

  let sumSq=0; for(let i=0;i<signal.length;i+=4) sumSq += signal[i]*signal[i];
  const globalRms = Math.sqrt(sumSq / Math.ceil(signal.length/4));
  const gate = Math.max(0.006, globalRms * 0.16);
  setStage('gate', `有效聲音門檻 ${gate.toFixed(3)}，開始追蹤音高…`, 100);
  await sleep(20);
  setStage('pitch', '追蹤基頻與音高穩定度…', 0);

  const frames = [];
  const windowed = new Float32Array(frameSize);
  for (let fi=0; fi<frameCount; fi++) {
    if (fi % 24 === 0) {
      checkAbort();
      setStage('pitch', `追蹤音高… ${fi}/${frameCount}`, frameCount ? fi/frameCount*100 : 0);
      await sleep(0);
    }
    const start = fi * hopSize;
    let mean=0;
    for(let i=0;i<frameSize;i++) mean += signal[start+i];
    mean /= frameSize;
    let rms=0;
    for(let i=0;i<frameSize;i++) {
      const w = .5 - .5 * Math.cos(2*Math.PI*i/(frameSize-1));
      const v=(signal[start+i]-mean)*w;
      windowed[i]=v; rms+=v*v;
    }
    rms=Math.sqrt(rms/frameSize);
    const time = (start + frameSize/2) / targetRate;
    if (rms < gate) { frames.push({time,pitch:null,midi:null,clarity:0,rms}); continue; }
    const det = autoCorrPitch(windowed, targetRate, minLag, maxLag);
    if (!det || det.clarity < .58 || det.freq < minHz || det.freq > maxHz) {
      frames.push({time,pitch:null,midi:null,clarity:det?.clarity || 0,rms});
    } else {
      frames.push({time,pitch:det.freq,midi:freqToMidi(det.freq),clarity:det.clarity,rms});
    }
  }
  setStage('pitch', '音高追蹤完成。', 100);
  return {frames, hopSeconds};
}

function mixToMono(buffer) {
  const len = buffer.length;
  const out = new Float32Array(len);
  for (let c=0;c<buffer.numberOfChannels;c++) {
    const ch=buffer.getChannelData(c); for(let i=0;i<len;i++) out[i]+=ch[i]/buffer.numberOfChannels;
  }
  return out;
}

function downsample(input, sourceRate, targetRate) {
  if (sourceRate <= targetRate * 1.05) return input.slice();
  const ratio = sourceRate / targetRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i=0;i<out.length;i++) {
    const a=Math.floor(i*ratio), b=Math.min(input.length,Math.floor((i+1)*ratio));
    let s=0; for(let j=a;j<b;j++) s+=input[j]; out[i]=s/Math.max(1,b-a);
  }
  return out;
}

function autoCorrPitch(x, sr, minLag, maxLag) {
  // YIN-style cumulative mean normalized difference. Choosing the first
  // convincing valley avoids the octave-down errors common in plain autocorrelation.
  const diff = new Float32Array(maxLag + 2);
  const cmnd = new Float32Array(maxLag + 2);
  cmnd[0] = 1;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    let d = 0;
    const n = x.length - tau;
    for (let i = 0; i < n; i += 2) {
      const delta = x[i] - x[i + tau];
      d += delta * delta;
    }
    diff[tau] = d;
  }
  let running = 0;
  for (let tau = 1; tau <= maxLag + 1; tau++) {
    running += diff[tau];
    cmnd[tau] = running > 1e-12 ? (diff[tau] * tau) / running : 1;
  }

  let bestTau = 0;
  const threshold = 0.18;
  for (let tau = Math.max(2, minLag); tau <= maxLag; tau++) {
    if (cmnd[tau] < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1] < cmnd[tau]) tau++;
      bestTau = tau;
      break;
    }
  }
  if (!bestTau) {
    let best = 1;
    for (let tau = Math.max(2, minLag); tau <= maxLag; tau++) {
      if (cmnd[tau] < best) { best = cmnd[tau]; bestTau = tau; }
    }
    if (!bestTau || best > 0.42) return null;
  }

  let tau = bestTau;
  if (bestTau > 1 && bestTau < maxLag) {
    const y1 = cmnd[bestTau - 1], y2 = cmnd[bestTau], y3 = cmnd[bestTau + 1];
    const den = y1 - 2 * y2 + y3;
    if (Math.abs(den) > 1e-8) tau += 0.5 * (y1 - y3) / den;
  }
  const clarity = clamp(1 - cmnd[bestTau], 0, 1);
  return { freq: sr / tau, clarity };
}

function segmentNotes(frames, hopSeconds) {
  if (!frames.length) return [];
  const smooth = frames.map((f,i) => {
    if (f.midi == null) return null;
    const vals=[];
    for(let j=Math.max(0,i-2);j<=Math.min(frames.length-1,i+2);j++) if(frames[j].midi!=null) vals.push(frames[j].midi);
    vals.sort((a,b)=>a-b);
    return vals.length ? vals[Math.floor(vals.length/2)] : null;
  });
  const q=smooth.map(m=>m==null?null:Math.round(m));
  for(let i=1;i<q.length-1;i++) if(q[i-1]!=null && q[i+1]===q[i-1] && q[i]!==q[i-1]) q[i]=q[i-1];
  for(let i=1;i<q.length;i++) if(q[i]!=null && q[i-1]!=null && Math.abs(q[i]-q[i-1])===1 && Math.abs((smooth[i]||q[i])-q[i-1])<.72) q[i]=q[i-1];

  const notes=[]; let cur=null; let gap=0;
  const close=(endTime)=>{
    if(!cur)return;
    cur.duration=Math.max(hopSeconds, endTime-cur.start);
    cur.confidence=cur.confSum/Math.max(1,cur.frames);
    delete cur.confSum; delete cur.frames;
    if(cur.duration>=.075) notes.push(cur);
    cur=null; gap=0;
  };
  for(let i=0;i<frames.length;i++) {
    const f=frames[i], m=q[i];
    if(m==null) {
      if(cur){gap++; if(gap>=2) close(f.time-hopSeconds);}
      continue;
    }
    if(!cur) {cur={midi:m,start:Math.max(0,f.time-hopSeconds/2),duration:0,confidence:0,confSum:f.clarity,frames:1};gap=0;continue;}
    if(m===cur.midi || (Math.abs(m-cur.midi)<=1 && f.clarity<.72)) {cur.confSum+=f.clarity;cur.frames++;gap=0;}
    else {close(f.time-hopSeconds/2);cur={midi:m,start:Math.max(0,f.time-hopSeconds/2),duration:0,confidence:0,confSum:f.clarity,frames:1};}
  }
  close((frames.at(-1)?.time || 0)+hopSeconds);
  return notes;
}

function cleanupNotes(notes) {
  const out=[];
  for (const n of notes) {
    if (n.duration < .09 && n.confidence < .74) continue;
    const prev=out.at(-1);
    if(prev && prev.midi===n.midi && n.start-(prev.start+prev.duration)<.11) {
      const end=n.start+n.duration; prev.duration=end-prev.start; prev.confidence=(prev.confidence+n.confidence)/2;
    } else out.push({...n});
  }
  return out;
}

function finalizeAnalysis() {
  const notes=state.notes;
  const elapsed=(performance.now()-state.analysisStarted)/1000;
  els.noteCount.textContent=String(notes.length);
  if(notes.length){
    const lo=Math.min(...notes.map(n=>n.midi)), hi=Math.max(...notes.map(n=>n.midi));
    els.noteRange.textContent=`${midiName(lo)} – ${midiName(hi)}`;
    els.confidence.textContent=`${Math.round(notes.reduce((s,n)=>s+n.confidence,0)/notes.length*100)}%`;
  } else { els.noteRange.textContent='未偵測'; els.confidence.textContent='—'; }
  els.durationMetric.textContent=`${elapsed.toFixed(1)} 秒`;
  els.midiBtn.disabled=!notes.length;
  els.restartBtn.disabled=!notes.length;
  els.playBtn.disabled=!notes.length;
  els.seek.disabled=!notes.length;
  els.seek.max=state.duration;
  els.playerHeading.textContent=notes.length?'旋律已就緒':'沒有找到穩定旋律';
  els.playerSub.textContent=notes.length?`${notes.length} 個音符 · ${formatTime(state.duration)}`:'可調整音域或改用純人聲音檔再試';
  state.scorePage=0;
  computeScorePages();
  renderScore();
  drawFalling(0); drawPiano();
}

function drawWaveform(buffer) {
  const c=els.waveform, ctx=c.getContext('2d');
  const w=c.width,h=c.height; ctx.clearRect(0,0,w,h);
  ctx.fillStyle='#11110f';ctx.fillRect(0,0,w,h);
  const data=buffer.getChannelData(0); const step=Math.max(1,Math.floor(data.length/w));
  ctx.strokeStyle='#8e856f';ctx.lineWidth=1;ctx.beginPath();
  for(let x=0;x<w;x++){let min=1,max=-1;const start=x*step,end=Math.min(data.length,start+step);for(let i=start;i<end;i+=Math.max(1,Math.floor(step/24))){const v=data[i];if(v<min)min=v;if(v>max)max=v;}ctx.moveTo(x,(1+min)*h/2);ctx.lineTo(x,(1+max)*h/2);}ctx.stroke();
  ctx.strokeStyle='#c8a76a';ctx.globalAlpha=.8;ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();ctx.globalAlpha=1;
}

function drawFalling(time) {
  const c=els.fallingCanvas, ctx=c.getContext('2d'); const w=c.width,h=c.height;
  ctx.fillStyle='#141412';ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='#27261f';ctx.lineWidth=1;for(let i=0;i<=36;i++){const x=i*w/36;ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke();}
  const look=4.5, minMidi=48,maxMidi=84;
  for(const n of state.notes){const rel=n.start-time;if(rel>look||n.start+n.duration<time-.2)continue;const x=(n.midi-minMidi)/(maxMidi-minMidi)*w;const nw=Math.max(8,w/(maxMidi-minMidi)*.7);const y=h-rel/look*h;const nh=Math.max(8,n.duration/look*h);ctx.fillStyle=`rgba(226,197,142,${.35+.6*n.confidence})`;ctx.fillRect(x-nw/2,y-nh,nw,nh);}
  ctx.strokeStyle='#e4c58e';ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(0,h-3);ctx.lineTo(w,h-3);ctx.stroke();
}

function buildPianoLayout() {
  const w=els.pianoCanvas.width,h=els.pianoCanvas.height,min=48,max=84;
  const white=[];for(let m=min;m<=max;m++)if(!isBlackPc(m%12))white.push(m);
  const ww=w/white.length; const layout=[];
  white.forEach((m,i)=>layout.push({midi:m,x:i*ww,width:ww,height:h,color:'white'}));
  for(let m=min;m<=max;m++)if(isBlackPc(m%12)){
    const prevWhite=white.filter(x=>x<m).at(-1);const idx=white.indexOf(prevWhite);layout.push({midi:m,x:(idx+1)*ww-ww*.31,width:ww*.62,height:h*.62,color:'black'});
  }
  state.pianoLayout=layout;
}
function drawPiano(activeMidi=null) {
  buildPianoLayout(); const c=els.pianoCanvas,ctx=c.getContext('2d'),w=c.width,h=c.height;
  ctx.fillStyle='#eeeae0';ctx.fillRect(0,0,w,h);
  for(const k of state.pianoLayout.filter(k=>k.color==='white')){ctx.fillStyle=Math.round(activeMidi)===k.midi?'#dfbd7f':'#f5f2ea';ctx.fillRect(k.x,k.y||0,k.width,k.height);ctx.strokeStyle='#292820';ctx.strokeRect(k.x,0,k.width,k.height);}
  for(const k of state.pianoLayout.filter(k=>k.color==='black')){ctx.fillStyle=Math.round(activeMidi)===k.midi?'#b48b4e':'#171713';ctx.fillRect(k.x,0,k.width,k.height);}
}
els.pianoCanvas.addEventListener('pointerdown', e=>{
  const r=els.pianoCanvas.getBoundingClientRect(),sx=els.pianoCanvas.width/r.width,sy=els.pianoCanvas.height/r.height,x=(e.clientX-r.left)*sx,y=(e.clientY-r.top)*sy;
  let key=state.pianoLayout.filter(k=>k.color==='black').find(k=>x>=k.x&&x<=k.x+k.width&&y<=k.height);
  if(!key)key=state.pianoLayout.filter(k=>k.color==='white').find(k=>x>=k.x&&x<=k.x+k.width);
  if(key){playSynth(key.midi,.55,Number(els.volume.value));drawPiano(key.midi);setTimeout(()=>drawPiano(),180);}
});

function playSynth(midi, duration=.45, volume=.7) {
  const ctx=getAudioContext(); if(ctx.state==='suspended')ctx.resume();
  const now=ctx.currentTime; const gain=ctx.createGain(); const master=ctx.createGain();
  const o1=ctx.createOscillator(),o2=ctx.createOscillator();
  o1.type='triangle';o2.type='sine';o1.frequency.value=midiToFreq(midi);o2.frequency.value=midiToFreq(midi)*2;
  master.gain.value=clamp(volume,0,1)*.42;gain.gain.setValueAtTime(.0001,now);gain.gain.exponentialRampToValueAtTime(.75,now+.012);gain.gain.exponentialRampToValueAtTime(.18,now+Math.min(.18,duration*.35));gain.gain.exponentialRampToValueAtTime(.0001,now+Math.max(.08,duration));
  o1.connect(gain);o2.connect(gain);gain.connect(master);master.connect(ctx.destination);o2.detune.value=3;
  o1.start(now);o2.start(now);o1.stop(now+duration+.05);o2.stop(now+duration+.05);
  const node={o1,o2};state.activeSynth.add(node);o1.onended=()=>state.activeSynth.delete(node);
}
function stopSynths(){for(const n of state.activeSynth){try{n.o1.stop();n.o2.stop();}catch{}}state.activeSynth.clear();}

function configureAudioMode() {
  const v=Number(els.volume.value), mode=state.mode;
  els.originalAudio.volume=(mode==='original'||mode==='ensemble')?v:0;
  els.vocalAudio.volume=mode==='vocal'?v:0;
}
function setMode(mode) {
  state.mode=mode;document.querySelectorAll('.mode').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));configureAudioMode();
  if(!els.originalAudio.paused){
    if(mode==='vocal' && els.vocalAudio.src){els.vocalAudio.currentTime=els.originalAudio.currentTime;els.vocalAudio.playbackRate=els.originalAudio.playbackRate;els.vocalAudio.play().catch(()=>{});}else els.vocalAudio.pause();
  }
}
document.querySelectorAll('.mode').forEach(b=>b.addEventListener('click',()=>setMode(b.dataset.mode)));
els.volume.addEventListener('input',configureAudioMode);
els.speedSelect.addEventListener('change',()=>{const r=Number(els.speedSelect.value);els.originalAudio.playbackRate=r;els.vocalAudio.playbackRate=r;});

async function playPlayer() {
  if(!state.notes.length)return;
  const ctx=getAudioContext();if(ctx.state==='suspended')await ctx.resume();
  configureAudioMode();const rate=Number(els.speedSelect.value);els.originalAudio.playbackRate=rate;els.vocalAudio.playbackRate=rate;
  const t=Number(els.seek.value)||0;els.originalAudio.currentTime=t;
  if(state.mode==='vocal' && els.vocalAudio.src){els.vocalAudio.currentTime=t;els.vocalAudio.play().catch(()=>{});}else els.vocalAudio.pause();
  await els.originalAudio.play();state.lastPlayerTime=t-.05;els.playBtn.textContent='❚❚';cancelAnimationFrame(state.raf);state.raf=requestAnimationFrame(playerTick);
}
function pausePlayer(){els.originalAudio.pause();els.vocalAudio.pause();stopSynths();cancelAnimationFrame(state.raf);if(els.playBtn)els.playBtn.textContent='▶';}
els.playBtn.addEventListener('click',()=>els.originalAudio.paused?playPlayer():pausePlayer());
els.restartBtn.addEventListener('click',()=>{pausePlayer();seekTo(0);playPlayer();});
els.originalAudio.addEventListener('ended',()=>{pausePlayer();seekTo(0);});
function seekTo(t){t=clamp(t,0,state.duration||0);els.originalAudio.currentTime=t;if(els.vocalAudio.src)try{els.vocalAudio.currentTime=t;}catch{}els.seek.value=t;state.lastPlayerTime=t-.05;updatePlayerVisuals(t);}
els.seek.addEventListener('input',()=>seekTo(Number(els.seek.value)));

function playerTick(){
  const t=els.originalAudio.currentTime;const rate=Number(els.speedSelect.value);
  els.seek.value=t;updatePlayerVisuals(t);
  if(state.mode==='piano'||state.mode==='ensemble'){
    for(const n of state.notes){if(n.start>state.lastPlayerTime+.005&&n.start<=t+.04){playSynth(n.midi,Math.max(.08,n.duration/rate),Number(els.volume.value));}}
  }
  state.lastPlayerTime=t;
  if(!els.originalAudio.paused)state.raf=requestAnimationFrame(playerTick);
}
function updatePlayerVisuals(t){
  els.timeLabel.textContent=`${formatTime(t)} / ${formatTime(state.duration)}`;drawFalling(t);
  const current=state.notes.find(n=>t>=n.start&&t<=n.start+n.duration);
  els.currentNote.textContent=current?midiName(current.midi):'—';drawPiano(current?.midi ?? null);
  if(els.followScore.checked && state.notes.length){const p=scorePageForTime(t);if(p!==state.scorePage){state.scorePage=p;renderScore();}}
}

els.midiBtn.addEventListener('click',()=>downloadMidi());
function vlq(n){const bytes=[n&0x7f];while((n>>=7))bytes.unshift((n&0x7f)|0x80);return bytes;}
function downloadMidi(){
  if(!state.notes.length)return;const bpm=clamp(Number(els.bpm.value)||90,40,220),ppq=480;const events=[];
  const mpqn=Math.round(60000000/bpm);events.push({tick:0,bytes:[0xff,0x51,0x03,(mpqn>>16)&255,(mpqn>>8)&255,mpqn&255],order:0});events.push({tick:0,bytes:[0xc0,0x00],order:1});
  for(const n of state.notes){const on=Math.max(0,Math.round(n.start*bpm/60*ppq));const off=Math.max(on+1,Math.round((n.start+n.duration)*bpm/60*ppq));events.push({tick:on,bytes:[0x90,clamp(Math.round(n.midi),0,127),Math.round(55+45*n.confidence)],order:2});events.push({tick:off,bytes:[0x80,clamp(Math.round(n.midi),0,127),0],order:1});}
  events.sort((a,b)=>a.tick-b.tick||a.order-b.order);let last=0,track=[];for(const e of events){track.push(...vlq(e.tick-last),...e.bytes);last=e.tick;}track.push(0,0xff,0x2f,0);
  const u32=n=>[(n>>>24)&255,(n>>>16)&255,(n>>>8)&255,n&255],u16=n=>[(n>>>8)&255,n&255];const bytes=[...new TextEncoder().encode('MThd'),...u32(6),...u16(0),...u16(1),...u16(ppq),...new TextEncoder().encode('MTrk'),...u32(track.length),...track];
  const blob=new Blob([new Uint8Array(bytes)],{type:'audio/midi'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`${(state.file?.name||'melody').replace(/\.[^.]+$/,'')}-melody.mid`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function computeScorePages(){const bpm=clamp(Number(els.bpm.value)||90,40,220),beatsPerPage=16;const end=state.notes.length?Math.max(...state.notes.map(n=>(n.start+n.duration)*bpm/60)):0;state.scorePages=Math.max(1,Math.ceil(end/beatsPerPage));state.scorePage=clamp(state.scorePage,0,state.scorePages-1);}
function scorePageForTime(t){const bpm=clamp(Number(els.bpm.value)||90,40,220);return clamp(Math.floor((t*bpm/60)/16),0,Math.max(0,state.scorePages-1));}
els.bpm.addEventListener('change',()=>{computeScorePages();renderScore();});els.keySelect.addEventListener('change',renderScore);
document.querySelectorAll('.score-mode').forEach(b=>b.addEventListener('click',()=>{state.scoreMode=b.dataset.score;document.querySelectorAll('.score-mode').forEach(x=>x.classList.toggle('active',x===b));renderScore();}));
els.prevPage.addEventListener('click',()=>{state.scorePage=Math.max(0,state.scorePage-1);renderScore();});els.nextPage.addEventListener('click',()=>{state.scorePage=Math.min(state.scorePages-1,state.scorePage+1);renderScore();});

function renderScore(){
  const svg=els.scoreSvg;svg.innerHTML='';if(!state.notes.length){els.scoreEmpty.style.display='grid';return;}els.scoreEmpty.style.display='none';
  computeScorePages();els.pageLabel.textContent=`${state.scorePage+1} / ${state.scorePages}`;els.prevPage.disabled=state.scorePage<=0;els.nextPage.disabled=state.scorePage>=state.scorePages-1;
  if(state.scoreMode==='staff')renderStaff(svg);else renderNumberScore(svg);
  svg.querySelectorAll('[data-time]').forEach(g=>g.addEventListener('click',()=>{seekTo(Number(g.dataset.time));if(els.followScore.checked)updatePlayerVisuals(Number(g.dataset.time));}));
}
function svgEl(tag,attrs={},text=''){const e=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(text)e.textContent=text;return e;}
function renderStaff(svg){
  const bpm=clamp(Number(els.bpm.value)||90,40,220),startBeat=state.scorePage*16,endBeat=startBeat+16,left=90,right=1150,top=120,lineGap=16,bottom=top+lineGap*4;
  svg.appendChild(svgEl('text',{x:28,y:184,'font-size':64,'font-family':'serif',fill:'#171713'},'𝄞'));
  for(let i=0;i<5;i++)svg.appendChild(svgEl('line',{x1:left,y1:top+i*lineGap,x2:right,y2:top+i*lineGap,stroke:'#7a756b','stroke-width':1}));
  for(let b=0;b<=16;b+=4){const x=left+(b/16)*(right-left);svg.appendChild(svgEl('line',{x1:x,y1:top-8,x2:x,y2:bottom+8,stroke:b===0||b===16?'#37342f':'#b8b1a5','stroke-width':(b==0||b===16)?2:1}));svg.appendChild(svgEl('text',{x:x+5,y:top-16,'font-size':11,fill:'#9b9489'},`${state.scorePage*4+b/4+1}`));}
  const pageNotes=state.notes.filter(n=>{const beat=n.start*bpm/60;return beat>=startBeat&&beat<endBeat;});
  for(const n of pageNotes){const beat=n.start*bpm/60-startBeat,x=left+(beat/16)*(right-left),y=staffY(n.midi,top,lineGap),g=svgEl('g',{'data-time':n.start,style:'cursor:pointer'});g.appendChild(svgEl('ellipse',{cx:x,cy:y,rx:9,ry:6,fill:`rgba(23,23,19,${.45+.55*n.confidence})`,transform:`rotate(-18 ${x} ${y})`}));const stemUp=y>top+lineGap*2;g.appendChild(svgEl('line',{x1:x+(stemUp?8:-8),y1:y,x2:x+(stemUp?8:-8),y2:y+(stemUp?-42:42),stroke:'#171713','stroke-width':2}));
    const pc=((Math.round(n.midi)%12)+12)%12;if([1,3,6,8,10].includes(pc))g.appendChild(svgEl('text',{x:x-20,y:y+5,'font-size':16,fill:'#171713'},'♯'));
    if(y>bottom+1){for(let ly=bottom+lineGap;ly<=y+3;ly+=lineGap)g.appendChild(svgEl('line',{x1:x-13,y1:ly,x2:x+13,y2:ly,stroke:'#7a756b'}));}
    if(y<top-1){for(let ly=top-lineGap;ly>=y-3;ly-=lineGap)g.appendChild(svgEl('line',{x1:x-13,y1:ly,x2:x+13,y2:ly,stroke:'#7a756b'}));}
    g.appendChild(svgEl('title',{},`${midiName(n.midi)} · ${n.start.toFixed(2)}s`));svg.appendChild(g);
  }
  svg.appendChild(svgEl('text',{x:90,y:285,'font-size':12,fill:'#857f75'},`第 ${state.scorePage+1} 頁 · 4/4 · ${bpm} BPM · 點擊音符可定位播放`));
}
function staffY(midi,top,lineGap){const n=Math.round(midi),pc=((n%12)+12)%12,oct=Math.floor(n/12)-1;const pcToLetter={0:0,1:0,2:1,3:1,4:2,5:3,6:3,7:4,8:4,9:5,10:5,11:6};const dia=oct*7+pcToLetter[pc],e4=4*7+2,bottom=top+lineGap*4;return bottom-(dia-e4)*(lineGap/2);}
function renderNumberScore(svg){
  const bpm=clamp(Number(els.bpm.value)||90,40,220),startBeat=state.scorePage*16,endBeat=startBeat+16,left=65,right=1140,rootPc={C:0,D:2,E:4,F:5,G:7,A:9,B:11}[els.keySelect.value]||0;const rowsY=[150,280];
  for(let row=0;row<2;row++){const rowStart=startBeat+row*8;svg.appendChild(svgEl('line',{x1:left,y1:rowsY[row]+38,x2:right,y2:rowsY[row]+38,stroke:'#d5cec1'}));for(let b=0;b<=8;b+=4){const x=left+(b/8)*(right-left);svg.appendChild(svgEl('line',{x1:x,y1:rowsY[row]-40,x2:x,y2:rowsY[row]+52,stroke:'#c8c0b3'}));}}
  const scale=[0,2,4,5,7,9,11];
  for(const n of state.notes){const absBeat=n.start*bpm/60;if(absBeat<startBeat||absBeat>=endBeat)continue;const rel=absBeat-startBeat,row=Math.floor(rel/8),b=rel-row*8,x=left+(b/8)*(right-left),y=rowsY[row],pitch=Math.round(n.midi),relPc=(pitch-rootPc+120)%12;let degree=1,acc='';let best=99;for(let i=0;i<7;i++){let d=relPc-scale[i];if(d>6)d-=12;if(d<-6)d+=12;if(Math.abs(d)<Math.abs(best)){best=d;degree=i+1;}}if(best===1)acc='♯';else if(best===-1)acc='♭';
    const rootMidi=60+rootPc;const octave=Math.floor((pitch-rootMidi)/12);const g=svgEl('g',{'data-time':n.start,style:'cursor:pointer'});g.appendChild(svgEl('text',{x:x,y:y,'font-size':28,'font-weight':700,'text-anchor':'middle',fill:`rgba(23,23,19,${.45+.55*n.confidence})`},`${acc}${degree}`));
    if(octave>0)for(let d=0;d<Math.min(2,octave);d++)g.appendChild(svgEl('circle',{cx:x,cy:y-25-d*8,r:2.5,fill:'#171713'}));if(octave<0)for(let d=0;d<Math.min(2,-octave);d++)g.appendChild(svgEl('circle',{cx:x,cy:y+22+d*8,r:2.5,fill:'#171713'}));
    const beatDur=n.duration*bpm/60;if(beatDur<.75)g.appendChild(svgEl('line',{x1:x-10,y1:y+8,x2:x+10,y2:y+8,stroke:'#171713','stroke-width':2}));if(beatDur>=1.5)g.appendChild(svgEl('text',{x:x+18,y:y,'font-size':24,fill:'#171713'},'—'));g.appendChild(svgEl('title',{},`${midiName(n.midi)} · ${n.start.toFixed(2)}s`));svg.appendChild(g);
  }
  svg.appendChild(svgEl('text',{x:65,y:405,'font-size':12,fill:'#857f75'},`簡譜 1 = ${els.keySelect.value} · ${bpm} BPM · 上下點代表八度，底線代表較短音值`));
}

window.addEventListener('resize',()=>{drawPiano();drawFalling(Number(els.seek.value)||0);});
window.addEventListener('beforeunload',()=>{cleanupObjectUrl('fileUrl');cleanupObjectUrl('vocalUrl');});

drawPiano();drawFalling(0);updateAnalyzeButton();configureAudioMode();window.__VOICEKEYS_READY__=true;setStatus('程式已就緒，請選擇歌曲或使用範例旋律。',0);
