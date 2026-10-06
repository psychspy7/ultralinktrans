(function(){
  'use strict';
  const P = window.UltraProtocol;
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const state = { signal:null, wavBlob:null, mp3Blob:null, audioUrl:null, selectedFile:null, mic:null, listening:false, chunks:[], chunkSamples:0, lastDecodeAt:0, liveBusy:false };

  const messageInput=$('#messageInput'), byteCounter=$('#byteCounter'), generateBtn=$('#generateBtn');
  const audioPlayer=$('#audioPlayer'), downloadMp3Btn=$('#downloadMp3Btn'), downloadWavBtn=$('#downloadWavBtn');
  const packetState=$('#packetState'), statBytes=$('#statBytes'), statDuration=$('#statDuration'), statCrc=$('#statCrc');
  const fileInput=$('#audioFileInput'), dropZone=$('#dropZone'), decodeBtn=$('#decodeBtn');
  const decodedText=$('#decodedText'), decodeStatus=$('#decodeStatus strong'), decodeIntegrity=$('#decodeIntegrity');
  const copyDecodedBtn=$('#copyDecodedBtn'), downloadTxtBtn=$('#downloadTxtBtn');
  const listenBtn=$('#listenBtn'), liveStatus=$('#liveStatus'), liveStatusDot=$('#liveStatusDot'), liveDecodedText=$('#liveDecodedText');
  const liveIntegrity=$('#liveIntegrity'), radarStage=$('#radarStage'), liveCoreText=$('#liveCoreText'), liveMeter=$('#liveMeter'), liveFreq=$('#liveFreq');
  const toastEl=$('#toast');

  function toast(msg, error=false){ toastEl.textContent=msg; toastEl.classList.toggle('error',error); toastEl.classList.add('show'); clearTimeout(toast._t); toast._t=setTimeout(()=>toastEl.classList.remove('show'),2600); }
  function fmtBytes(n){ if(n<1024)return `${n} B`; return `${(n/1024).toFixed(1)} KB`; }
  function fmtDuration(sec){ const m=Math.floor(sec/60),s=Math.round(sec%60); return m?`${m}m ${s}s`:`${sec.toFixed(sec<10?2:1)}s`; }
  function crcHex(n){return '0x'+n.toString(16).toUpperCase().padStart(4,'0')}
  function safeName(){ return `ultralink-${new Date().toISOString().replace(/[:.]/g,'-').slice(0,19)}`; }
  function download(blob,name){ const a=document.createElement('a'); const u=URL.createObjectURL(blob); a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500); }

  function updateBytes(){
    const bytes=new TextEncoder().encode(messageInput.value).length;
    byteCounter.textContent=`${bytes} / ${P.CFG.maxPayloadBytes} bytes`;
    byteCounter.style.color=bytes>P.CFG.maxPayloadBytes?'#ff765f':'';
    generateBtn.disabled=!bytes||bytes>P.CFG.maxPayloadBytes;
  }
  messageInput.addEventListener('input',updateBytes); updateBytes();

  function setTab(name){
    $$('.tab').forEach(b=>{const on=b.dataset.tab===name;b.classList.toggle('active',on);b.setAttribute('aria-selected',on)});
    $$('.panel').forEach(p=>{const on=p.dataset.panel===name;p.classList.toggle('active',on);p.hidden=!on});
    document.querySelector('.console').scrollIntoView({behavior:'smooth',block:'center'});
  }
  $$('.tab').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));
  $$('[data-jump]').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.jump)));

  function drawWave(canvas,samples){
    const rect=canvas.getBoundingClientRect(),dpr=Math.min(2,devicePixelRatio||1);canvas.width=rect.width*dpr;canvas.height=rect.height*dpr;
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height;ctx.clearRect(0,0,w,h);
    ctx.strokeStyle='rgba(255,255,255,.055)';ctx.lineWidth=1;for(let x=0;x<w;x+=w/12){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,h);ctx.stroke()}for(let y=0;y<h;y+=h/6){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}
    const N=Math.min(900,samples.length),step=samples.length/N;ctx.beginPath();ctx.lineWidth=1.25;ctx.strokeStyle='#ee3c1c';for(let i=0;i<N;i++){const x=i/(N-1)*w;let peak=0;const a=Math.floor(i*step),b=Math.min(samples.length,Math.floor((i+1)*step));for(let j=a;j<b;j++)peak=Math.max(peak,Math.abs(samples[j]));const y=h/2 + Math.sin(i*.57)*peak*h*.36;(i?ctx.lineTo(x,y):ctx.moveTo(x,y))}ctx.stroke();
    ctx.beginPath();ctx.strokeStyle='rgba(251,172,45,.38)';for(let i=0;i<N;i++){const x=i/(N-1)*w;const y=h/2+Math.sin(i*.11)*h*.09;(i?ctx.lineTo(x,y):ctx.moveTo(x,y))}ctx.stroke();
  }

  async function buildPacket(){
    try{
      generateBtn.disabled=true;packetState.textContent='BUILDING';
      const made=P.makeFrame(messageInput.value);const signal=P.makeSignal(made.frame);state.signal={...signal,...made};
      const wav=new Blob([P.wavArrayBuffer(signal.samples,signal.sampleRate)],{type:'audio/wav'});state.wavBlob=wav;
      if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);state.audioUrl=URL.createObjectURL(wav);audioPlayer.src=state.audioUrl;
      statBytes.textContent=`${made.payload.length} B`;statDuration.textContent=fmtDuration(signal.samples.length/signal.sampleRate);statCrc.textContent=crcHex(made.crc);
      downloadWavBtn.disabled=false;downloadMp3Btn.disabled=false;packetState.textContent='PACKET READY';drawWave($('#waveCanvas'),signal.samples);
      state.mp3Blob=null;
      toast('ULNK packet generated');
    }catch(e){packetState.textContent='ERROR';toast(e.message,true)}finally{updateBytes()}
  }
  generateBtn.addEventListener('click',buildPacket);
  downloadWavBtn.addEventListener('click',()=>state.wavBlob&&download(state.wavBlob,safeName()+'.wav'));

  let mp3LoaderPromise=null;
  function ensureMp3Encoder(){
    if(window.lamejs?.Mp3Encoder)return Promise.resolve();
    if(mp3LoaderPromise)return mp3LoaderPromise;
    const urls=['https://cdnjs.cloudflare.com/ajax/libs/lamejs/1.2.1/lame.min.js','https://cdn.jsdelivr.net/npm/lamejs@1.2.1/lame.min.js'];
    mp3LoaderPromise=new Promise((resolve,reject)=>{
      let index=0;
      const attempt=()=>{
        if(index>=urls.length){reject(new Error('MP3 encoder could not be loaded. Check your internet connection or download WAV instead.'));return}
        const script=document.createElement('script');let done=false;const timer=setTimeout(()=>finish(false),7000);
        const finish=ok=>{if(done)return;done=true;clearTimeout(timer);script.onload=script.onerror=null;if(ok&&window.lamejs?.Mp3Encoder)resolve();else{script.remove();index++;attempt()}};
        script.src=urls[index];script.async=true;script.referrerPolicy='no-referrer';script.onload=()=>finish(true);script.onerror=()=>finish(false);document.head.appendChild(script);
      };attempt();
    }).catch(e=>{mp3LoaderPromise=null;throw e});
    return mp3LoaderPromise;
  }
  downloadMp3Btn.addEventListener('click',async()=>{
    if(!state.signal)return;
    const prior=downloadMp3Btn.textContent;downloadMp3Btn.disabled=true;downloadMp3Btn.textContent='Preparing MP3…';
    try{await ensureMp3Encoder();if(!state.mp3Blob)state.mp3Blob=P.mp3Blob(state.signal.samples,state.signal.sampleRate,320);download(state.mp3Blob,safeName()+'.mp3');packetState.textContent='MP3 READY'}catch(e){toast(e.message,true)}finally{downloadMp3Btn.disabled=false;downloadMp3Btn.textContent=prior}
  });

  async function decodeAudioFile(file){
    const AudioCtx=window.AudioContext||window.webkitAudioContext;if(!AudioCtx)throw new Error('Web Audio is not supported by this browser.');
    const ctx=new AudioCtx({sampleRate:48000});
    try{const buf=await file.arrayBuffer();const audio=await ctx.decodeAudioData(buf.slice(0));const ch=audio.getChannelData(0);return P.decodeSamples(new Float32Array(ch),audio.sampleRate)}finally{await ctx.close().catch(()=>{})}
  }
  function chooseFile(file){
    if(!file)return;state.selectedFile=file;$('#decodeFileInfo').hidden=false;$('#decodeFileName').textContent=file.name;$('#decodeFileSize').textContent=fmtBytes(file.size);decodeBtn.disabled=false;decodedText.value='';decodeIntegrity.textContent='—';copyDecodedBtn.disabled=true;downloadTxtBtn.disabled=true;decodeStatus.textContent='File loaded — ready to decode';
  }
  fileInput.addEventListener('change',e=>chooseFile(e.target.files[0]));
  ['dragenter','dragover'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.add('drag')}));
  ['dragleave','drop'].forEach(ev=>dropZone.addEventListener(ev,e=>{e.preventDefault();dropZone.classList.remove('drag')}));
  dropZone.addEventListener('drop',e=>chooseFile(e.dataTransfer.files[0]));
  decodeBtn.addEventListener('click',async()=>{
    if(!state.selectedFile)return;decodeBtn.disabled=true;decodeStatus.textContent='Analyzing 18.0 / 19.4 kHz carriers…';decodeIntegrity.textContent='SCANNING';
    try{const r=await decodeAudioFile(state.selectedFile);decodedText.value=r.text;decodeIntegrity.textContent=`CRC OK · ${crcHex(r.crc)}`;decodeStatus.textContent=`Valid ULNK v1 packet · ${(r.confidence*100).toFixed(0)}% carrier confidence`;copyDecodedBtn.disabled=false;downloadTxtBtn.disabled=false;toast('Message recovered successfully')}
    catch(e){decodedText.value='';decodeIntegrity.textContent='NO VALID PACKET';decodeStatus.textContent=e.message;toast(e.message,true)}finally{decodeBtn.disabled=false}
  });
  copyDecodedBtn.addEventListener('click',async()=>{await navigator.clipboard.writeText(decodedText.value);toast('Copied to clipboard')});
  downloadTxtBtn.addEventListener('click',()=>download(new Blob([decodedText.value],{type:'text/plain;charset=utf-8'}),safeName()+'.txt'));

  function concatRecent(maxSeconds=28){
    const max=Math.floor((state.mic?.ctx.sampleRate||48000)*maxSeconds);let need=Math.min(max,state.chunkSamples);const out=new Float32Array(need);let write=need;
    for(let i=state.chunks.length-1;i>=0&&write>0;i--){const c=state.chunks[i];const take=Math.min(write,c.length);write-=take;out.set(c.subarray(c.length-take),write)}return out;
  }
  async function tryLiveDecode(){
    if(!state.listening||state.liveBusy||state.chunkSamples<48000*1.8)return;const now=performance.now();if(now-state.lastDecodeAt<1150)return;state.lastDecodeAt=now;state.liveBusy=true;
    try{const samples=concatRecent(28);const r=P.decodeSamples(samples,state.mic.ctx.sampleRate,{maxCandidates:10});liveDecodedText.value=r.text;liveIntegrity.textContent=`CRC OK · ${crcHex(r.crc)}`;liveStatus.textContent='Packet recovered — still listening';toast('Live ULNK message received');state.chunks=[];state.chunkSamples=0}
    catch(e){if(/signal found/i.test(e.message))liveStatus.textContent='Signal detected — waiting for a complete packet'}finally{state.liveBusy=false}
  }
  function stopMic(){
    if(!state.mic)return;state.listening=false;state.mic.stream.getTracks().forEach(t=>t.stop());state.mic.processor.disconnect();state.mic.source.disconnect();state.mic.gain.disconnect();state.mic.ctx.close().catch(()=>{});state.mic=null;listenBtn.innerHTML='Start listening <span>●</span>';liveStatus.textContent='Microphone is idle';liveCoreText.textContent='OFF';radarStage.classList.remove('live');liveStatusDot.style.background='';liveFreq.textContent='— kHz';liveMeter.style.width='0%';
  }
  listenBtn.addEventListener('click',async()=>{
    if(state.listening){stopMic();return}
    if(!navigator.mediaDevices?.getUserMedia){toast('Microphone API is not available in this browser.',true);return}
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false,channelCount:1},video:false});
      const AudioCtx=window.AudioContext||window.webkitAudioContext;const ctx=new AudioCtx({sampleRate:48000});await ctx.resume();
      const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();analyser.fftSize=4096;analyser.smoothingTimeConstant=.55;
      const processor=ctx.createScriptProcessor(2048,1,1);const gain=ctx.createGain();gain.gain.value=0;
      source.connect(analyser);source.connect(processor);processor.connect(gain);gain.connect(ctx.destination);
      state.mic={stream,ctx,source,processor,gain,analyser};state.listening=true;state.chunks=[];state.chunkSamples=0;
      processor.onaudioprocess=e=>{if(!state.listening)return;const copy=new Float32Array(e.inputBuffer.getChannelData(0));state.chunks.push(copy);state.chunkSamples+=copy.length;const max=Math.floor(ctx.sampleRate*30);while(state.chunkSamples>max&&state.chunks.length>1){state.chunkSamples-=state.chunks.shift().length}tryLiveDecode()};
      listenBtn.innerHTML='Stop listening <span>■</span>';liveStatus.textContent='Listening for ULNK pilot…';liveCoreText.textContent='LIVE';radarStage.classList.add('live');liveStatusDot.style.background='#9cff9a';visualizeMic();
    }catch(e){toast(e.name==='NotAllowedError'?'Microphone permission was denied.':`Could not start microphone: ${e.message}`,true);stopMic()}
  });
  $('#clearLiveBtn').addEventListener('click',()=>{state.chunks=[];state.chunkSamples=0;liveDecodedText.value='';liveIntegrity.textContent='—';liveStatus.textContent=state.listening?'Listening for ULNK pilot…':'Microphone is idle'});

  function visualizeMic(){
    if(!state.listening||!state.mic)return;const a=state.mic.analyser,n=a.frequencyBinCount,data=new Uint8Array(n);a.getByteFrequencyData(data);const sr=state.mic.ctx.sampleRate;
    const b0=Math.round(P.CFG.freq0/(sr/2)*(n-1)),b1=Math.round(P.CFG.freq1/(sr/2)*(n-1));let v0=0,v1=0;for(let d=-2;d<=2;d++){v0=Math.max(v0,data[Math.max(0,Math.min(n-1,b0+d))]);v1=Math.max(v1,data[Math.max(0,Math.min(n-1,b1+d))])}const peak=Math.max(v0,v1);liveMeter.style.width=`${Math.min(100,peak/255*115)}%`;liveFreq.textContent=peak<22?'— kHz':`${(v1>v0?P.CFG.freq1:P.CFG.freq0)/1000} kHz`;requestAnimationFrame(visualizeMic)
  }

  function initSecureBadge(){const secure=window.isSecureContext||location.hostname==='localhost'||location.hostname==='127.0.0.1';$('#secureBadge').textContent=secure?'SECURE CONTEXT':'HTTPS REQUIRED';$('#secureBadge').style.color=secure?'#9cff9a':'#ff765f'}initSecureBadge();

  // Procedural abstract system visual inspired by cyber-system motion language, not copied artwork.
  const hc=$('#systemCanvas'),hctx=hc.getContext('2d');let nodes=[];
  function resizeHero(){const r=hc.getBoundingClientRect(),d=Math.min(2,devicePixelRatio||1);hc.width=r.width*d;hc.height=r.height*d;hctx.setTransform(d,0,0,d,0,0);nodes=Array.from({length:78},(_,i)=>({x:(Math.random()-.5)*1.7,y:(Math.random()-.5)*1.25,z:Math.random()*1.4+.15,s:Math.random()*6+2,p:Math.random()*6.28}))}resizeHero();addEventListener('resize',resizeHero);
  function heroFrame(t){const r=hc.getBoundingClientRect(),w=r.width,h=r.height;hctx.clearRect(0,0,w,h);const cx=w*.52,cy=h*.5;hctx.save();hctx.translate(cx,cy);hctx.rotate(-.12);for(let i=0;i<11;i++){const yy=(i-5)*42;hctx.strokeStyle=`rgba(255,92,52,${.03+Math.max(0,1-Math.abs(i)/7)*.025})`;hctx.beginPath();hctx.moveTo(-w*.7,yy);hctx.lineTo(w*.7,yy);hctx.stroke()}for(let i=-8;i<=8;i++){hctx.strokeStyle='rgba(255,255,255,.025)';hctx.beginPath();hctx.moveTo(i*58,-h*.7);hctx.lineTo(i*58,h*.7);hctx.stroke()}hctx.restore();
    nodes.forEach((n,i)=>{const pulse=(Math.sin(t*.0017+n.p)+1)/2;const depth=1/(n.z+.65);const x=cx+n.x*w*.43*depth,y=cy+n.y*h*.46*depth;const size=n.s*(.65+depth*.7);hctx.fillStyle=i%9===0?`rgba(251,172,45,${.22+pulse*.28})`:`rgba(238,35,1,${.07+pulse*.16})`;hctx.fillRect(x-size/2,y-size/2,size,size*2.4);if(i%13===0){hctx.strokeStyle='rgba(255,126,85,.12)';hctx.beginPath();hctx.moveTo(x,y);hctx.lineTo(cx,cy);hctx.stroke()}n.z-=.0018;if(n.z<.12)n.z=1.55});requestAnimationFrame(heroFrame)}requestAnimationFrame(heroFrame);

  addEventListener('resize',()=>state.signal&&drawWave($('#waveCanvas'),state.signal.samples));
  window.addEventListener('beforeunload',()=>{if(state.audioUrl)URL.revokeObjectURL(state.audioUrl);if(state.listening)stopMic()});
  if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('./sw.js').catch(()=>{});
  buildPacket();
})();
