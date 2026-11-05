/* 송쌤과학 GIF 스튜디오 V1.0 — 로컬 프레임 편집기 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const clamp = (x, a, b) => Math.max(a, Math.min(b, Number(x) || 0));
  const uid = () => crypto.randomUUID?.() || 'f' + Date.now() + Math.random().toString(36).slice(2);
  const clone = value => JSON.parse(JSON.stringify(value));
  const defaults = () => ({width:800,height:450,fit:'contain',matte:'#ffffff',colors:128,fps:10,direction:'forward',repeat:'infinite',count:3,dedupe:true});
  const names = {images:'이미지 불러오기',record:'화면·창 녹화',tab:'브라우저 탭 녹화',snapshot:'한 장씩 캡처',frames:'프레임 정리',playback:'시간·재생',crop:'자르기·크기',annotate:'글자·설명',export:'GIF 설정',region:'공유 화면 영역 녹화'};
  const descriptions = {images:'사진을 순서대로 연결해 움직이는 수업 자료를 만들어요.',record:'선택한 화면이나 프로그램 창을 짧게 기록해요.',tab:'열어 둔 실험 사이트의 탭을 직접 골라 녹화해요.',snapshot:'공유 화면의 중요한 순간을 한 장씩 담아요.',frames:'필요한 장면만 남기고 순서를 바꿔요.',playback:'중요한 장면은 오래, 반복 방식은 자유롭게.',crop:'수업에 필요한 영역만 남기고 크기를 맞춰요.',annotate:'한글 설명과 표시를 프레임에 더해요.',export:'품질과 용량을 고른 뒤 GIF로 저장해요.',region:'공유 화면에서 필요한 영역을 골라 움직임을 담아요.'};
  const sources = new Map();
  let state = {frames:[],out:defaults(),crop:null,title:'나의 수업 GIF'};
  let tool = 'images', cursor = 0, selected = new Set(), undo = [], redo = [];
  let dirty = false, busy = false, aborter = null, exporter = null, result = null;
  let toastTimer, playbackTimer, playing = false, playbackSequence = [], playPosition = 0, playBase = 0;
  let zoom = 1, viewFit = true, paintVersion = 0, bitmapCache = null, bitmapKey = null;
  let captureState = {state:'idle',mode:'record',elapsed:0,maxSeconds:15}, recording = null;
  let recordSettings = {countdown:3,maxSeconds:15}, extractSettings = {start:0,end:0};
  let captureRegion={x:0,y:0,w:1,h:1}, recordingRegion=null, regionPointer=null;
  let regionConfirmed=false, confirmedRegion=null, confirmedSourceSize=null, regionPreviewRequest=null;
  let overlayDraft = null, pointerDraft = null, annotationKind = 'text', modalReturn = null, progressReturn = null;
  try { const saved=JSON.parse(localStorage.getItem('ss.gif.options') || 'null'); if(saved){const d=defaults();for(const k of Object.keys(d))if(k in saved)d[k]=saved[k]; d.width=clamp(d.width,16,1280);d.height=clamp(d.height,16,1280);d.colors=[64,128,256].includes(d.colors)?d.colors:128;d.fps=[5,10,15,20].includes(d.fps)?d.fps:10;if(!/^#[0-9a-f]{6}$/i.test(d.matte))d.matte='#ffffff';state.out=d;} } catch {}
  const captureSupported = window.isSecureContext && !!navigator.mediaDevices?.getDisplayMedia;
  const recordSupported = captureSupported && typeof MediaRecorder !== 'undefined';
  const activeFrame = () => state.frames[cursor];
  const count = () => state.frames.length;
  const captureActive = () => ['selecting','ready','countdown','recording','paused','stopping','snapshot'].includes(captureState.state);
  const locked = () => busy || ['selecting','countdown','recording','paused','stopping'].includes(captureState.state);
  const time = ms => (ms / 1000).toLocaleString('ko-KR',{maximumFractionDigits:2}) + ' 초';
  const bytes = n => n < 1024*1024 ? (n/1024).toFixed(1)+' KB' : (n/1048576).toFixed(2)+' MB';
  const selectedFrames = () => state.frames.filter(f => selected.has(f.id));
  const frameSequence = () => { let list = [...state.frames]; if(state.out.direction==='reverse') list.reverse(); if(state.out.direction==='pingpong'&&list.length>2)list=list.concat(list.slice(1,-1).reverse()); return list; };
  const totalTime = () => frameSequence().reduce((sum,f)=>sum+f.delay,0);
  function cropPixels(){const {width:w,height:h}=state.out;const c=state.crop || {x:0,y:0,w:1,h:1};const x=Math.round(c.x*w),y=Math.round(c.y*h);return {x,y,w:Math.max(1,Math.min(w-x,Math.round(c.w*w))),h:Math.max(1,Math.min(h-y,Math.round(c.h*h)))};}
  function toast(message){clearTimeout(toastTimer);$('toast').textContent=message;$('toast').classList.add('show');toastTimer=setTimeout(()=>{$('toast').classList.remove('show');$('toast').textContent='';},3200);}
  function persist(){try{localStorage.setItem('ss.gif.options',JSON.stringify(state.out));}catch{}}
  function releaseResult(){if(result){URL.revokeObjectURL(result.url);result=null;}$('resultPanel').hidden=true;$('saveGif').disabled=true;}
  function collectSources(){const keep=new Set(state.frames.map(f=>f.source));for(const hist of [...undo,...redo])for(const f of hist.frames)keep.add(f.source);for(const [id,src] of sources)if(!keep.has(id)){URL.revokeObjectURL(src.url);URL.revokeObjectURL(src.thumb);sources.delete(id);}if(bitmapKey&&!keep.has(bitmapKey)){bitmapCache?.close?.();bitmapKey=null;bitmapCache=null;}}
  function snapshot(){return clone(state);}
  function commit(fn,message){if(locked()){toast('진행 중인 작업을 마친 뒤 편집해 주세요.');return;}stopPlayback();undo.push(snapshot());if(undo.length>50)undo.shift();redo=[];fn();dirty=true;releaseResult();persist();cursor=clamp(cursor,0,Math.max(0,count()-1));selected=new Set([...selected].filter(id=>state.frames.some(f=>f.id===id)));if(!selected.size&&activeFrame())selected.add(activeFrame().id);collectSources();render();if(message)toast(message);}
  function restore(direction){if(locked())return;const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;if(!from.length)return;stopPlayback();to.push(snapshot());state=from.pop();cursor=clamp(cursor,0,Math.max(0,count()-1));selected=new Set(activeFrame()?[activeFrame().id]:[]);dirty=true;releaseResult();persist();collectSources();render();}
  function setTool(next,force=false){if(busy&&!force)return;if(captureActive()&&next!==tool&&!force){toast('현재 도구에서 공유를 종료한 뒤 다른 도구를 선택해 주세요.');return;}if(overlayDraft)applyDraft();tool=next;renderSettings();renderStatus();renderCanvas();document.querySelectorAll('#rail [data-tool]').forEach(b=>{b.classList.toggle('active',b.dataset.tool===tool);b.setAttribute('aria-current',b.dataset.tool===tool?'page':'false');});}
  function setCurrent(index,multi=false,range=false){stopPlayback();const f=state.frames[index];if(!f)return;if(range){const start=Math.min(cursor,index),end=Math.max(cursor,index);selected=new Set(state.frames.slice(start,end+1).map(x=>x.id));}else if(multi){if(selected.has(f.id)&&selected.size>1)selected.delete(f.id);else selected.add(f.id);}else selected=new Set([f.id]);cursor=index;renderTimeline();renderStatus();renderSettings();renderCanvas();}
  function renderStatus(){const c=cropPixels();$('projectName').value=state.title;$('breadcrumbs').textContent=state.title+' / '+names[tool];$('statusPill').textContent=count()?`${count()} 프레임`+' · '+time(totalTime())+' · '+c.w+' × '+c.h:'이미지를 불러오세요';$('frameSummary').textContent=count()?`${cursor+1} / ${count()} 프레임 · ${time(activeFrame()?.delay||0)}`:'0 프레임 · 준비됐어요';$('undo').disabled=locked()||!undo.length;$('redo').disabled=locked()||!redo.length;$('makeGif').disabled=locked()||!count()||captureActive();$('makeGif').title=!count()?'이미지나 캡처 프레임을 먼저 추가해 주세요.':captureActive()?'화면 공유를 종료한 뒤 GIF를 만들 수 있어요.':'GIF 만들기 (Ctrl+Enter)';$('saveGif').disabled=!result||locked();$('prevFrame').disabled=!count()||locked();$('nextFrame').disabled=!count()||locked();$('play').disabled=!count()||locked();$('play').setAttribute('aria-label',playing?'미리보기 정지':'미리보기 재생');$('play').setAttribute('aria-pressed',String(playing));$('play').innerHTML=playing?'Ⅱ':'▶';$('newProject').disabled=locked();$('addImages').disabled=locked()||captureActive();$('projectName').disabled=locked();document.querySelectorAll('[data-action="record"],[data-action="tab"],[data-action="region"]').forEach(b=>{b.disabled=!recordSupported||busy||captureActive();b.title=recordSupported?'화면 공유 선택창 열기':'이 환경은 화면 녹화를 지원하지 않아요. PC의 Chrome·Edge와 HTTPS/localhost를 사용해 주세요.';});document.querySelectorAll('[data-action="snapshot"]').forEach(b=>{b.disabled=!captureSupported||busy||captureActive();b.title=captureSupported?'화면 공유 후 한 장씩 담기':'이 환경은 화면 공유를 지원하지 않아요.';});}
  function render(){renderStatus();renderSettings();renderTimeline();renderCanvas();}
  const btn=(action,label,disabled=false,cls='')=>`<button type="button" class="btn ${cls}" data-action="${action}" ${disabled?'disabled':''}>${label}</button>`;
  const field=(id,label,value,type='number',attrs='')=>`<label class="field" for="${id}"><span>${label}</span><input id="${id}" type="${type}" value="${esc(value)}" ${attrs}></label>`;
  const select=(id,label,options,current)=>`<label class="field" for="${id}"><span>${label}</span><select id="${id}">${options.map(([value,text])=>`<option value="${value}" ${String(value)===String(current)?'selected':''}>${text}</option>`).join('')}</select></label>`;
  const hint=(text,extra='')=>`<p class="hint ${extra}">${text}</p>`;
  const divider=()=>'<hr class="divider">';
  function renderSettings(){
    $('toolTitle').textContent=names[tool];if($('toolDescription'))$('toolDescription').textContent=descriptions[tool];if($('stageGuidance'))$('stageGuidance').textContent=tool==='crop'?'드래그하거나 숫자로 자르기 영역을 골라 주세요.':tool==='annotate'?'설명 위치를 고르고 적용할 범위를 확인해 주세요.':tool==='region'?'공유 화면에서 범위를 고르고 영역 확정을 눌러 주세요.':'사진을 끌어 놓거나 붙여 넣어 보세요.';const off=!count()||locked(), sel=selectedFrames(), o=state.out,c=cropPixels();let html='';
    if(tool==='images') html+=btn('pick','이미지 불러오기',locked()||captureActive(),'primary block')+hint('PNG · JPEG · 정지 WebP<br>여러 장 선택 · 끌어 놓기 · Ctrl+V')+divider()+`<p class="group-title">불러온 이미지</p><div class="meta"><span>프레임</span><strong>${count()} 장</strong></div><div class="meta"><span>재생 시간</span><strong>${time(totalTime())}</strong></div>`+btn('sort','파일 이름순 정렬',off)+hint('사진을 더 불러오면 마지막 프레임 뒤에 이어 붙여요. 애니메이션 GIF 가져오기는 다음 버전에서 제공해요.')+divider()+btn('demo','예제로 사용해 보기',locked()||captureActive())+hint('직접 생성한 실험 도식 4장을 실제 프레임으로 불러와요.');
    if(['record','tab','region','snapshot'].includes(tool)){
      const snap=tool==='snapshot', regionMode=tool==='region', supported=snap?captureSupported:recordSupported;
      html+=hint(regionMode?'먼저 브라우저 선택창에서 <strong>전체 화면·창·탭</strong> 중 하나를 공유해요. 다음으로 이 사이트의 미리보기에서 사각형 범위를 정하고 확정해요.':snap?'공유 화면에서 현재 모습을 한 장씩 추가해요.':'녹화할 화면을 열어 둔 뒤 브라우저 선택창에서 <strong>'+ (tool==='tab'?'해당 탭':'화면 또는 창')+'</strong>을 골라 주세요.');
      if(regionMode)html+=`<ol id="captureSteps" class="capture-steps" aria-label="영역 녹화 순서">${captureStepsHTML()}</ol>`;
      if(!supported)html+=hint('이 환경은 화면 '+(snap?'공유':'녹화')+'를 지원하지 않아요. PC Chrome·Edge에서 HTTPS 또는 localhost로 열어 주세요.','warn');
      html+=`<div class="capture-status" role="status"><span class="eyebrow">${captureState.state==='recording'?'RECORDING':captureState.state==='paused'?'PAUSED':'SCREEN CAPTURE'}</span><strong>${regionMode&&captureState.state==='ready'?regionReadyText():({idle:'화면을 선택해 주세요',selecting:'공유할 화면을 선택하는 중',ready:'녹화할 준비가 됐어요',countdown:`${captureState.remaining||0}초 뒤 시작해요`,recording:'녹화 중이에요',paused:'잠시 멈췄어요',stopping:'녹화를 마무리해요',recorded:'녹화가 완료됐어요',snapshot:'한 장씩 담을 준비가 됐어요'})[captureState.state]||'준비됐어요'}</strong><span>${time((captureState.elapsed||0)*1000)}</span></div>`;
      if(!captureActive())html+=btn('selectCapture',regionMode?'1. 공유할 화면 선택':snap?'캡처 화면 선택':'녹화 화면 선택',!supported||busy,'primary block');
      else if(captureState.state==='ready')html+=btn('startRecord',regionMode?'3. 선택 영역 녹화 시작':'녹화 시작',busy||regionMode&&(!regionConfirmed||!regionSourceSize().width),'primary block')+btn('closeCapture','공유 종료',false);
      else if(captureState.state==='snapshot')html+=btn('takeSnapshot','현재 화면 캡처',busy,'primary block')+btn('closeCapture','공유 종료',busy);
      else if(['recording','paused'].includes(captureState.state))html+=`<div class="row">${btn(captureState.state==='paused'?'resumeRecord':'pauseRecord',captureState.state==='paused'?'계속 녹화':'일시정지')}${btn('stopRecord','녹화 정지',false,'primary')}</div>`;
      else if(captureState.state==='countdown')html+=btn('stopRecord','시작 취소',false);
      if(regionMode)html+=regionSettingsHTML();
      if(!snap){html+=divider()+`<div class="row">${select('maxSeconds','최대 녹화',[['15','15 초'],['30','30 초']],recordSettings.maxSeconds)}${select('countdown','시작 대기',[['3','3 초'],['0','바로 시작']],recordSettings.countdown)}</div>`+select('captureFPS','추출 FPS',[[5,'5 FPS'],[10,'10 FPS'],[15,'15 FPS'],[20,'20 FPS']],o.fps)+hint('소리 없는 GIF로 만들어요. 정지 후 구간과 영역을 고를 수 있어요.');
        if(recording){html+=divider()+`<p class="group-title">녹화 구간 선택 · ${time(recording.duration*1000)}</p><div class="row">${field('extractStart','시작 (초)',extractSettings.start,'number','min="0" step="0.1"')}${field('extractEnd','끝 (초)',extractSettings.end,'number','min="0" step="0.1"')}</div>`+btn('extract',regionMode?'4. 선택 구간을 프레임으로 가져오기':'구간을 프레임으로 가져오기',busy||captureActive(),'primary block')+hint('선택 구간'+(recording.region?'과 녹화 영역':'')+'을 '+o.fps+' FPS로 추출한 뒤 자르기·설명을 편집해요. 기존 프레임 뒤에 추가돼요.');}}
      html+=hint('브라우저의 공유 중지로도 녹화를 마칠 수 있어요. 다른 앱에서 작동하는 전역 단축키는 사용하지 않아요.');
    }
    if(tool==='frames')html+=`<p class="group-title">${sel.length} 프레임 선택</p><div class="row">${btn('selectAll','전체 선택',off)}${btn('duplicate','복제',off)}</div><div class="row">${btn('moveEarlier','앞으로 이동',off)}${btn('moveLater','뒤로 이동',off)}</div>`+btn('delete','선택 프레임 삭제',off,'danger block')+divider()+hint('썸네일을 끌어 순서를 바꿔요.<br>Shift: 범위 선택 · Ctrl/Cmd: 여러 개 선택')+`<div class="row">${btn('trimBefore','현재 이전 지우기',off||cursor===0)}${btn('trimAfter','현재 이후 지우기',off||cursor===count()-1)}</div>`;
    if(tool==='playback')html+=field('frameDelay','표시 시간 (ms)',Math.round(sel[0]?.delay||500),'number','min="20" max="60000" step="10"')+`<div class="row">${btn('delaySelected','선택에 적용',off)}${btn('delayAll','전체에 적용',off)}</div>`+select('direction','재생 방향',[['forward','순서대로'],['reverse','거꾸로'],['pingpong','왕복 재생']],o.direction)+select('repeat','반복 방식',[['once','한 번'],['infinite','무한 반복'],['count','총 횟수 지정']],o.repeat)+(o.repeat==='count'?field('repeatCount','총 재생 횟수',o.count,'number','min="2" max="100" step="1"'):'')+divider()+`<div class="row">${btn('faster','2배 빠르게',off)}${btn('slower','2배 느리게',off)}</div>`+hint('표시 시간을 바꿔 실제 재생 속도를 조절해요. FPS는 녹화 영상의 프레임 추출에 사용해요.')+`<div class="meta"><span>한 순환의 길이</span><strong>${time(totalTime())}</strong></div>`;
    if(tool==='crop'){
      const d=overlayDraft?.type==='crop'?overlayDraft.crop:c;
      html+=`<p class="group-title">작업 캔버스 크기</p><div class="row">${field('outputWidth','가로 (px)',o.width,'number','min="16" max="1280" step="1"')}${field('outputHeight','세로 (px)',o.height,'number','min="16" max="1280" step="1"')}</div><label class="check"><input id="sizeLock" type="checkbox" checked> 비율 유지</label>`+select('sizePreset','가로 프리셋',[[480,'480 px'],[640,'640 px'],[800,'800 px'],[1024,'1024 px']],o.width)+select('fitMode','사진 맞추기',[['contain','비율 유지 + 여백'],['cover','비율 유지 + 채우기']],o.fit)+field('matte','여백·배경색',o.matte,'color')+divider()+`<p class="group-title">자르기 영역</p><div class="row">${field('cropX','X (px)',d.x,'number',`min="0" max="${o.width-1}"`)}${field('cropY','Y (px)',d.y,'number',`min="0" max="${o.height-1}"`)}</div><div class="row">${field('cropW','너비 (px)',d.w,'number',`min="1" max="${o.width}"`)}${field('cropH','높이 (px)',d.h,'number',`min="1" max="${o.height}"`)}</div><div class="row">${btn('applyCrop','영역 적용',off,'primary')}${btn('resetCrop','자르기 초기화',off||!state.crop)}</div>`+hint('무대에서 드래그하거나 숫자로 영역을 정해요. 크롭은 모든 프레임에 적용돼요.')+`<div class="meta"><span>저장 크기</span><strong>${c.w} × ${c.h} px</strong></div>`;
    }
    if(tool==='annotate') html+=select('annotationKind','설명 도구',[['text','한글 자막'],['arrow','화살표'],['rect','강조 사각형'],['mask','불투명 가리기']],annotationKind)+select('annotationScope','적용 범위',[['current','현재 프레임'],['selected','선택 프레임'],['all','모든 프레임']],'current')+(annotationKind==='text'?`<label class="field" for="captionText"><span>글자 내용</span><textarea id="captionText" rows="3" maxlength="300" placeholder="예: 시간이 지날수록 색이 변해요"></textarea></label>`:'')+`<div class="row">${field('annotationColor','글자·선·가리기 색','#332b1e','color')}${field('annotationSize',annotationKind==='text'?'글자 크기 (px)':'선 굵기 (px)',annotationKind==='text'?32:4,'number',annotationKind==='text'?'min="8" max="160"':'min="1" max="30"')}</div><div class="row">${field('annotationX','X (px)',Math.round(o.width*.08))}${field('annotationY','Y (px)',Math.round(o.height*.82))}</div>`+(annotationKind!=='text'?`<div class="row">${field('annotationW','너비 (px)',Math.round(o.width*.4))}${field('annotationH','높이 (px)',Math.round(o.height*.2))}</div>`:'')+btn('addAnnotation',annotationKind==='text'?'자막 추가':'표시 추가',off,'primary block')+hint(annotationKind==='text'?'숫자로 위치를 정하고 자막을 추가해요. 줄바꿈을 지원해요.':'무대에서 드래그하거나 숫자로 표시할 영역을 정해요. 가리기는 불투명하게 저장돼요.')+divider()+`<div class="row">${btn('clearAnnotations','현재 설명 지우기',off||!activeFrame()?.annotations.length)}${btn('clearAllAnnotations','모든 설명 지우기',off)}</div>`;
    if(tool==='export')html+=`<p class="group-title">품질 프리셋</p><div class="seg" role="group" aria-label="품질 프리셋">${btn('presetSmall','작은 용량',locked())}${btn('presetBalanced','균형',locked())}${btn('presetClear','선명함',locked())}</div>`+hint('작은 용량 480 px · 5 FPS · 64색<br>균형 800 px · 10 FPS · 128색<br>선명함 1024 px · 15 FPS · 256색<br>이미지 프레임의 표시 시간은 유지해요.')+divider()+select('colors','팔레트 색수',[[64,'64색'],[128,'128색'],[256,'256색']],o.colors)+select('exportFPS','다음 녹화 추출 FPS',[[5,'5 FPS'],[10,'10 FPS'],[15,'15 FPS'],[20,'20 FPS']],o.fps)+`<label class="check"><input id="dedupe" type="checkbox" ${o.dedupe?'checked':''}> 같은 연속 프레임 합치기</label>`+hint('프레임을 합칠 때 표시 시간을 더해 움직임의 길이를 유지해요. 반투명 이미지는 배경색에 합성해요.')+`<div class="meta"><span>크기</span><strong>${c.w} × ${c.h} px</strong></div><div class="meta"><span>재생 길이</span><strong>${time(totalTime())}</strong></div>`+btn('make','GIF 만들기',off||captureActive(),'primary block')+hint('실제 파일 용량은 GIF 생성 후 확인할 수 있어요.');
    $('settings').innerHTML=html;
    if($('sizePreset')&&![480,640,800,1024].includes(o.width))$('sizePreset').selectedIndex=-1;
    if(locked())$('settings').querySelectorAll('input,select,textarea').forEach(el=>el.disabled=true);
  }
  function renderTimeline(){const holder=$('timeline');holder.replaceChildren();for(const [index,f] of state.frames.entries()){const b=document.createElement('button');b.type='button';b.className='frame-item'+(selected.has(f.id)?' selected':'')+(index===cursor?' current':'');b.dataset.id=f.id;b.dataset.index=index;b.draggable=!locked();b.setAttribute('aria-pressed',String(selected.has(f.id)));b.setAttribute('aria-label','프레임 '+`${index+1}: ${f.name}, ${Math.round(f.delay)}ms`);b.title=f.name+' · '+Math.round(f.delay)+' ms';const image=document.createElement('img');image.src=sources.get(f.source)?.thumb||'';image.alt='';image.draggable=false;const text=document.createElement('span');text.className='frame-meta';text.textContent=String(index+1).padStart(2,'0')+' · '+Math.round(f.delay)+' ms';b.append(image,text);holder.append(b);}if(!count()){const p=document.createElement('p');p.className='timeline-empty';p.textContent='불러온 이미지와 캡처한 장면이 여기에 차곡차곡 놓여요.';holder.append(p);}}
  async function sourceImage(id){const src=sources.get(id);if(!src)throw new Error('원본 프레임을 읽을 수 없어요. 이미지를 다시 불러와 주세요.');let img;try{img=await createImageBitmap(src.blob,{imageOrientation:'from-image'});}catch{img=new Image();img.src=src.url;await img.decode();}return img;}
  async function compose(frame,raw=false){
    const image=await sourceImage(frame.source),o=state.out;const base=document.createElement('canvas');base.width=o.width;base.height=o.height;const ctx=base.getContext('2d',{willReadFrequently:true});ctx.fillStyle=o.matte;ctx.fillRect(0,0,o.width,o.height);const iw=image.width||image.naturalWidth,ih=image.height||image.naturalHeight;const scale=o.fit==='cover'?Math.max(o.width/iw,o.height/ih):Math.min(o.width/iw,o.height/ih);const w=iw*scale,h=ih*scale;ctx.drawImage(image,(o.width-w)/2,(o.height-h)/2,w,h);image.close?.();for(const a of frame.annotations)drawAnnotation(ctx,a,o.width,o.height);
    if(raw||!state.crop)return base;const c=cropPixels(),out=document.createElement('canvas');out.width=c.w;out.height=c.h;out.getContext('2d',{willReadFrequently:true}).drawImage(base,c.x,c.y,c.w,c.h,0,0,c.w,c.h);base.width=0;base.height=0;return out;
  }
  function drawAnnotation(ctx,a,w,h){ctx.save();ctx.fillStyle=a.color;ctx.strokeStyle=a.color;ctx.lineWidth=Math.max(1,a.size*w);ctx.lineJoin='round';ctx.lineCap='round';const x=a.x*w,y=a.y*h,aw=a.w*w,ah=a.h*h;if(a.type==='text'){ctx.font=`700 ${Math.max(8,a.size*w)}px "Pretendard Variable",Pretendard,Arial,sans-serif`;ctx.textBaseline='top';ctx.lineWidth=Math.max(2,a.size*w*.12);ctx.strokeStyle=a.color==='#ffffff'?'#332b1e':'#ffffff';for(const [i,line] of a.text.split('\n').entries()){ctx.strokeText(line,x,y+i*a.size*w*1.35);ctx.fillText(line,x,y+i*a.size*w*1.35);}}else if(a.type==='rect'){ctx.strokeRect(x,y,aw,ah);}else if(a.type==='mask'){ctx.fillRect(x,y,aw,ah);}else if(a.type==='arrow'){const x2=x+aw,y2=y+ah,angle=Math.atan2(ah,aw),head=Math.max(12,a.size*w*4);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x2,y2);ctx.moveTo(x2-head*Math.cos(angle-Math.PI/6),y2-head*Math.sin(angle-Math.PI/6));ctx.lineTo(x2,y2);ctx.lineTo(x2-head*Math.cos(angle+Math.PI/6),y2-head*Math.sin(angle+Math.PI/6));ctx.stroke();}ctx.restore();}
  async function renderCanvas(){
    const version=++paintVersion,canvas=$('stageCanvas'),video=$('stageVideo');renderRegionOverlay();if(captureActive()){canvas.hidden=true;$('stageEmpty').hidden=true;video.hidden=false;return;}if(recording&&['record','tab','region'].includes(tool)){canvas.hidden=true;$('stageEmpty').hidden=true;video.hidden=false;video.controls=true;if(video.getAttribute('src')!==recording.url){video.srcObject=null;video.src=recording.url;video.pause();}requestAnimationFrame(renderRegionOverlay);return;}video.hidden=true;
    if(!count()){canvas.hidden=true;$('stageEmpty').hidden=false;return;}$('stageEmpty').hidden=true;canvas.hidden=false;
    try{const frame=activeFrame();const raw=tool==='crop'||tool==='annotate';const rendered=await compose(frame,raw);if(version!==paintVersion){rendered.width=0;rendered.height=0;return;}canvas.width=rendered.width;canvas.height=rendered.height;const ctx=canvas.getContext('2d');ctx.drawImage(rendered,0,0);rendered.width=0;rendered.height=0;
      if(tool==='crop'){const r=overlayDraft?.type==='crop'?overlayDraft.crop:cropPixels();ctx.fillStyle='rgba(30,25,17,.48)';ctx.fillRect(0,0,canvas.width,r.y);ctx.fillRect(0,r.y,r.x,r.h);ctx.fillRect(r.x+r.w,r.y,canvas.width-r.x-r.w,r.h);ctx.fillRect(0,r.y+r.h,canvas.width,canvas.height-r.y-r.h);ctx.strokeStyle='#fff';ctx.lineWidth=Math.max(2,canvas.width/400);ctx.setLineDash([8,6]);ctx.strokeRect(r.x,r.y,r.w,r.h);}
      if(overlayDraft?.type==='annotation')drawAnnotation(ctx,overlayDraft.annotation,state.out.width,state.out.height);
      fitCanvas();canvas.style.cursor=tool==='crop'||tool==='annotate'?'crosshair':'default';
    }catch(error){if(version===paintVersion)toast(error.message);}
  }
  function fitCanvas(){const canvas=$('stageCanvas');if(canvas.hidden)return;const parent=$('stageWrap');const availableW=Math.max(160,parent.clientWidth-48),availableH=Math.max(180,parent.clientHeight-48);if(viewFit)zoom=Math.min(1,availableW/canvas.width,availableH/canvas.height);canvas.style.width=Math.max(1,canvas.width*zoom)+'px';canvas.style.height=Math.max(1,canvas.height*zoom)+'px';$('zoomLabel').textContent=Math.round(zoom*100)+'%';}
  function stopPlayback(){playing=false;clearTimeout(playbackTimer);renderStatus();}
  function playToggle(){if(playing){stopPlayback();return;}if(!count()||locked()||captureActive())return;if(overlayDraft)applyDraft();playbackSequence=frameSequence();playPosition=0;playing=true;playBase=performance.now();schedulePlayback();}
  function schedulePlayback(){if(!playing||!playbackSequence.length)return;const t=performance.now()-playBase,total=playbackSequence.reduce((s,f)=>s+f.delay,0);let elapsed=t;const limit=state.out.repeat==='once'?1:state.out.repeat==='count'?state.out.count:Infinity;if(t>=total*limit){stopPlayback();return;}elapsed%=total;let accum=0,index=0;for(;index<playbackSequence.length-1;index++){if(elapsed<accum+playbackSequence[index].delay)break;accum+=playbackSequence[index].delay;}const f=playbackSequence[index];cursor=state.frames.findIndex(x=>x.id===f.id);selected=new Set([f.id]);renderStatus();renderTimeline();renderCanvas();playbackTimer=setTimeout(schedulePlayback,Math.max(16,accum+f.delay-elapsed));}
  function canvasBlob(canvas,type='image/png'){return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('이미지 프레임을 만들 수 없어요. 출력 크기를 줄여 주세요.')),type));}
  async function prepareSource(blob,name){let image;try{image=await createImageBitmap(blob,{imageOrientation:'from-image'});}catch{const url=URL.createObjectURL(blob);try{image=new Image();image.src=url;await image.decode();}finally{URL.revokeObjectURL(url);}}const w=image.width||image.naturalWidth,h=image.height||image.naturalHeight;if(!w||!h)throw new Error('읽을 수 없는 이미지예요.');const thumbnail=document.createElement('canvas');thumbnail.width=160;thumbnail.height=90;const ctx=thumbnail.getContext('2d');ctx.fillStyle='#f3f0e8';ctx.fillRect(0,0,160,90);const scale=Math.min(160/w,90/h);ctx.drawImage(image,(160-w*scale)/2,(90-h*scale)/2,w*scale,h*scale);const thumb=await canvasBlob(thumbnail,'image/jpeg');image.close?.();thumbnail.width=0;const id=uid();sources.set(id,{blob,url:URL.createObjectURL(blob),thumb:URL.createObjectURL(thumb),w,h,name});return id;}
  function frameFromSource(id,delay=500){const src=sources.get(id);return {id:uid(),source:id,name:src.name,delay,annotations:[]};}
  function addPrepared(frames,label){const first=count()===0;undo.push(snapshot());if(undo.length>50)undo.shift();redo=[];state.frames.push(...frames);if(first&&frames.length){const src=sources.get(frames[0].source);state.out.height=Math.max(16,Math.round(state.out.width*src.h/src.w));if(state.out.height>1280){state.out.width=Math.round(state.out.width*1280/state.out.height);state.out.height=1280;}state.crop=null;}cursor=count()-frames.length;selected=new Set(frames.map(f=>f.id));dirty=true;releaseResult();persist();render();toast(label);}
  async function animatedImage(file){const buf=new Uint8Array(await file.arrayBuffer());if(file.type==='image/webp'||/\.webp$/i.test(file.name)){for(let i=12;i<buf.length-8;){const tag=String.fromCharCode(...buf.slice(i,i+4));if(tag==='ANIM'||tag==='ANMF')return true;const n=buf[i+4]|buf[i+5]<<8|buf[i+6]<<16|buf[i+7]<<24;if(n<0)break;i+=8+n+(n%2);}}if(file.type==='image/png'||/\.png$/i.test(file.name)){for(let i=8;i<buf.length-12;){const n=(buf[i]*16777216)+(buf[i+1]<<16)+(buf[i+2]<<8)+buf[i+3];const tag=String.fromCharCode(...buf.slice(i+4,i+8));if(tag==='acTL')return true;i+=12+n;}}return false;}
  function beginTask(title){busy=true;stopPlayback();aborter=new AbortController();progressReturn=document.activeElement;$('progressTitle').textContent=title;$('progressDetail').textContent='준비하고 있어요.';$('progressBar').value=0;$('progressOverlay').hidden=false;$('cancelTask').focus();renderStatus();return aborter.signal;}
  function progress(message,n,total){$('progressDetail').textContent=message;if(total){$('progressBar').value=n/total*100;$('progressBar').setAttribute('aria-valuetext',n+' / '+total);}else $('progressBar').removeAttribute('value');}
  function finishTask(){busy=false;aborter=null;exporter=null;$('progressOverlay').hidden=true;renderStatus();renderSettings();renderTimeline();if(!$('modalOverlay').hidden)$('modalClose').focus();else if(progressReturn?.isConnected)progressReturn.focus();}
  async function importFiles(files){if(locked()||captureActive())return;files=[...files];if(!files.length)return;const capacity=600-count();if(files.length>capacity){toast('최대600프레임까지 추가할 수 있어요. 일부 파일만 불러와요.');files=files.slice(0,capacity);}if(!files.length)return;const signal=beginTask('이미지를 불러와요'),prepared=[],errors=[];try{for(const [i,file] of files.entries()){if(signal.aborted)throw new DOMException('취소','AbortError');progress(`${i+1} / ${files.length} 이미지를 읽어요.`,i,files.length);if(!(/^image\/(png|jpeg|webp)$/.test(file.type)||/\.(png|jpe?g|webp)$/i.test(file.name))){errors.push(file.name+': PNG·JPEG·정지 WebP를 사용해 주세요.');continue;}if(file.size>50*1048576){errors.push(file.name+': 50 MB 이하 이미지를 사용해 주세요.');continue;}try{if(await animatedImage(file)){errors.push(file.name+': 움직이는 이미지의 전체 프레임 가져오기는 다음 버전에서 제공해요.');continue;}const id=await prepareSource(file,file.name||'붙여넣은 이미지.png');prepared.push(frameFromSource(id));}catch(err){errors.push(file.name+': 이미지를 읽을 수 없어요.');}}
      if(signal.aborted)throw new DOMException('취소','AbortError');if(prepared.length)addPrepared(prepared,prepared.length+'개 프레임을 불러왔어요.');if(errors.length)showModal('일부 파일을 불러오지 못했어요',`<p>정상 이미지는 그대로 추가했어요.</p><ul>${errors.map(err=>`<li>${esc(err)}</li>`).join('')}</ul>`);if(prepared.length)setTool('frames',true);
    }catch(error){if(error.name==='AbortError'){for(const f of prepared){const s=sources.get(f.source);if(s){URL.revokeObjectURL(s.url);URL.revokeObjectURL(s.thumb);sources.delete(f.source);}}toast('불러오기를 취소했어요. 기존 프레임은 유지돼요.');}else toast(error.message);}finally{finishTask();$('imageInput').value='';}}
  async function loadDemo(){if(locked()||captureActive())return;const signal=beginTask('실험 예제를 만들어요');const prepared=[];try{for(let i=0;i<4;i++){if(signal.aborted)throw new DOMException('취소','AbortError');const c=document.createElement('canvas');c.width=800;c.height=450;const x=c.getContext('2d');x.fillStyle='#f9f7f1';x.fillRect(0,0,800,450);x.fillStyle='#332b1e';x.font='700 30px sans-serif';x.fillText('물질의 확산 관찰',48,52);x.font='18px sans-serif';x.fillStyle='#716348';x.fillText('색소가 물 전체로 퍼지는 과정을 비교해요.',48,86);x.strokeStyle='#7f7767';x.lineWidth=3;x.beginPath();x.moveTo(275,125);x.lineTo(275,350);x.quadraticCurveTo(275,372,300,372);x.lineTo(500,372);x.quadraticCurveTo(525,372,525,350);x.lineTo(525,125);x.stroke();x.fillStyle=['#ece8ce','#e1ddb9','#d2c993','#bdb374'][i];x.fillRect(279,192,242,170);for(let j=0;j<45;j++){const spread=30+i*28;const px=400+Math.sin(j*17)*spread,py=220+Math.cos(j*11)*Math.min(110,35+i*24);x.fillStyle='#705537';x.beginPath();x.arc(px,py,3.5,0,Math.PI*2);x.fill();}x.font='700 20px sans-serif';x.fillStyle='#594022';x.fillText(['처음','잠시 후','더 시간이 지난 후','고르게 퍼진 상태'][i],48,409);x.fillStyle='#77684e';x.font='14px sans-serif';x.fillText('송쌤과학 · 개념을 설명하는 도식 예제',470,409);const id=await prepareSource(await canvasBlob(c),`확산 관찰 ${i+1}.png`);prepared.push(frameFromSource(id,800));progress((i+1)+' / 4 예제 프레임',i+1,4);}if(signal.aborted)throw new DOMException('취소','AbortError');addPrepared(prepared,'실제 예제4장을 불러왔어요. GIF를 만들어 보세요.');setTool('frames',true);}catch(e){collectSources();toast(e.name==='AbortError'?'예제 만들기를 취소했어요.':e.message);}finally{finishTask();}}
  function updateSize(width,height){width=Math.round(clamp(width,16,1280));height=Math.round(clamp(height,16,1280));commit(()=>{state.out.width=width;state.out.height=height;},'작업 크기를 바꿨어요.');}
  function setPreset(kind){const p={small:[480,5,64],balanced:[800,10,128],clear:[1024,15,256]}[kind];let h=Math.round(state.out.height*p[0]/state.out.width),w=p[0];if(h>1280){w=Math.round(w*1280/h);h=1280;}commit(()=>Object.assign(state.out,{width:w,height:Math.max(16,h),fps:p[1],colors:p[2]}),'출력 크기·색수와 다음 녹화 FPS를 바꿨어요.');}
  function changeDelay(scope,multiplier){const ids=new Set(scope==='all'?state.frames.map(f=>f.id):selected);let delay=$('frameDelay')?Number($('frameDelay').value):500;if(!multiplier&&(!Number.isFinite(delay)||delay<20||delay>60000)){toast('표시 시간은20~60,000ms로 입력해 주세요.');return;}commit(()=>{for(const f of state.frames)if(ids.has(f.id))f.delay=Math.round(clamp(multiplier?f.delay*multiplier:delay,20,60000)/10)*10;},'표시 시간을 적용했어요.');}
  function deleteSelected(){if(!selected.size)return;commit(()=>{state.frames=state.frames.filter(f=>!selected.has(f.id));},'선택 프레임을 지웠어요. Ctrl+Z로 되돌릴 수 있어요.');}
  function moveSelected(dir){commit(()=>{const f=state.frames;if(dir<0){for(let i=1;i<f.length;i++)if(selected.has(f[i].id)&&!selected.has(f[i-1].id))[f[i],f[i-1]]=[f[i-1],f[i]];}else{for(let i=f.length-2;i>=0;i--)if(selected.has(f[i].id)&&!selected.has(f[i+1].id))[f[i],f[i+1]]=[f[i+1],f[i]];}cursor=f.findIndex(x=>selected.has(x.id));});}
  function readCrop(){const o=state.out,x=Math.round(clamp($('cropX')?.value,0,o.width-1)),y=Math.round(clamp($('cropY')?.value,0,o.height-1));return {x,y,w:Math.round(clamp($('cropW')?.value,1,o.width-x)),h:Math.round(clamp($('cropH')?.value,1,o.height-y))};}
  function applyCrop(r){commit(()=>{state.crop={x:r.x/state.out.width,y:r.y/state.out.height,w:r.w/state.out.width,h:r.h/state.out.height};overlayDraft=null;},'모든 프레임에 자르기를 적용했어요.');}
  function readAnnotation(rect){const o=state.out,color=$('annotationColor')?.value||'#332b1e',size=clamp($('annotationSize')?.value,annotationKind==='text'?8:1,annotationKind==='text'?160:30)/o.width;const a={type:annotationKind,color,size,x:clamp(rect?.x??$('annotationX')?.value,0,o.width)/o.width,y:clamp(rect?.y??$('annotationY')?.value,0,o.height)/o.height,w:clamp(rect?.w??$('annotationW')?.value,-o.width,o.width)/o.width,h:clamp(rect?.h??$('annotationH')?.value,-o.height,o.height)/o.height,text:$('captionText')?.value?.trim()||''};if(annotationKind==='text'&&!a.text){toast('자막 내용을 입력해 주세요.');return null;}return a;}
  function addAnnotation(a){if(!a)return;const scope=$('annotationScope')?.value||'current',ids=new Set(scope==='all'?state.frames.map(f=>f.id):scope==='selected'?[...selected]:[activeFrame()?.id]);commit(()=>{for(const f of state.frames)if(ids.has(f.id))f.annotations.push(clone(a));overlayDraft=null;},'설명을 추가했어요.');}
  function applyDraft(){const d=overlayDraft;if(!d)return;overlayDraft=null;if(d.type==='crop')applyCrop(d.crop);else addAnnotation(d.annotation);toast('편집 내용을 적용했어요. Ctrl+Z로 되돌릴 수 있어요.');}
  function pointerPoint(event){const r=$('stageCanvas').getBoundingClientRect();return {x:clamp((event.clientX-r.left)/r.width*state.out.width,0,state.out.width),y:clamp((event.clientY-r.top)/r.height*state.out.height,0,state.out.height)};}
  $('stageCanvas').addEventListener('pointerdown',e=>{if(!count()||locked()||!['crop','annotate'].includes(tool))return;if(tool==='annotate'&&annotationKind==='text'){const p=pointerPoint(e);$('annotationX').value=Math.round(p.x);$('annotationY').value=Math.round(p.y);return;}stopPlayback();pointerDraft={start:pointerPoint(e),last:null};$('stageCanvas').setPointerCapture(e.pointerId);e.preventDefault();});
  $('stageCanvas').addEventListener('pointermove',e=>{if(!pointerDraft)return;const p=pointerPoint(e),s=pointerDraft.start;pointerDraft.last=p;const rect={x:Math.round(Math.min(s.x,p.x)),y:Math.round(Math.min(s.y,p.y)),w:Math.max(1,Math.round(Math.abs(p.x-s.x))),h:Math.max(1,Math.round(Math.abs(p.y-s.y)))};if(tool==='crop')overlayDraft={type:'crop',crop:rect};else{const arrow=annotationKind==='arrow'?{x:s.x,y:s.y,w:p.x-s.x,h:p.y-s.y}:rect;const a=readAnnotation(arrow);if(a)overlayDraft={type:'annotation',annotation:a};}renderCanvas();});
  $('stageCanvas').addEventListener('pointerup',e=>{if(!pointerDraft)return;pointerDraft=null;try{$('stageCanvas').releasePointerCapture(e.pointerId);}catch{}if(overlayDraft?.type==='crop'){const r=overlayDraft.crop;for(const [id,value] of [['cropX',r.x],['cropY',r.y],['cropW',r.w],['cropH',r.h]])if($(id))$(id).value=value;toast('영역을 골랐어요. 영역 적용을 눌러 주세요.');}else if(overlayDraft?.type==='annotation')applyDraft();});
  $('stageCanvas').addEventListener('pointercancel',()=>{pointerDraft=null;overlayDraft=null;renderCanvas();});
  function clearRecording(){if(recording?.url)URL.revokeObjectURL(recording.url);recording=null;}
  function regionSourceSize(){
    const v=$('stageVideo');
    return {width:v.videoWidth||recording?.width||captureState.sourceWidth||0,height:v.videoHeight||recording?.height||captureState.sourceHeight||0};
  }
  function regionPixels(region=captureRegion,size=regionSourceSize()){
    const {width:W,height:H}=size;
    const x=Math.floor(region.x*W+1e-7),y=Math.floor(region.y*H+1e-7);
    return {x,y,w:Math.max(1,Math.min(W,Math.ceil((region.x+region.w)*W-1e-7))-x),h:Math.max(1,Math.min(H,Math.ceil((region.y+region.h)*H-1e-7))-y)};
  }
  function regionSettingsHTML(){
    let html=hint('선택한 영역만 GIF로 만들어요. 녹화 중에는 브라우저에서 공유한 전체 화면을 이 기기에 임시 기록해요.');
    const size=regionSourceSize();
    if(!size.width||captureState.state==='selecting'||(!captureActive()&&!recording?.region))return html;
    const ready=captureState.state==='ready'&&!busy, r=regionPixels(recording?.region||captureRegion,size), disabled=ready?'':'disabled';
    const surface=({monitor:'전체 화면',window:'프로그램 창',browser:'브라우저 탭'})[captureState.selectedSurface]||'선택한 공유 화면';
    html+=divider()+`<span id="captureSourceInfo" class="capture-source">공유 대상: <strong>${surface}</strong> · ${size.width} × ${size.height} px</span><p class="group-title">2. 녹화 영역 · 원본 ${size.width} × ${size.height} px</p><div class="row">${field('captureRegionX','X (px)',r.x,'number',`min="0" max="${size.width-1}" step="1" ${disabled}`)}${field('captureRegionY','Y (px)',r.y,'number',`min="0" max="${size.height-1}" step="1" ${disabled}`)}</div><div class="row">${field('captureRegionW','너비 (px)',r.w,'number',`min="${Math.min(16,size.width)}" max="${size.width}" step="1" ${disabled}`)}${field('captureRegionH','높이 (px)',r.h,'number',`min="${Math.min(16,size.height)}" max="${size.height}" step="1" ${disabled}`)}</div>`;
    if(ready)html+=`<div class="row">${btn('regionApply','영역 확정',false,'primary')}${btn('regionFull','전체 영역')}</div>`+hint('최소16×16px. 드래그나 숫자로 범위를 고르고 ‘영역 확정’을 눌러 주세요. 범위를 바꾸면 다시 확정해야 해요.');
    else html+=hint('녹화 시작 때 지정한 영역을 유지해요. 다시 지정하려면 새 화면을 선택해 주세요.');
    return html+hint('녹화 중 공유 대상이나 창 크기를 바꾸면 영역이 달라질 수 있어요.');
  }
  function updateRegionFields(){
    const r=regionPixels();for(const [key,value] of [['X',r.x],['Y',r.y],['W',r.w],['H',r.h]])if($('captureRegion'+key))$('captureRegion'+key).value=value;
  }
  function setRegionPixels(r){
    const {width:W,height:H}=regionSourceSize();if(!W||!H)return false;
    if(![r.x,r.y,r.w,r.h].every(Number.isFinite)||r.w<=0||r.h<=0){toast('영역 너비와 높이는 양수로 입력해 주세요.');return false;}
    const minW=Math.min(16,W),minH=Math.min(16,H),x=Math.round(clamp(r.x,0,W-minW)),y=Math.round(clamp(r.y,0,H-minH));
    const w=Math.round(clamp(r.w,minW,W-x)),h=Math.round(clamp(r.h,minH,H-y));
    captureRegion={x:x/W,y:y/H,w:w/W,h:h/H};invalidateRegionConfirmation();updateRegionFields();renderRegionOverlay();return true;
  }
  function applyRegionInputs(){
    if(tool!=='region'||captureState.state!=='ready'||busy)return false;
    const values=['X','Y','W','H'].map(key=>Number($('captureRegion'+key)?.value));
    return setRegionPixels({x:values[0],y:values[1],w:values[2],h:values[3]});
  }
  function captureStepsHTML(){
    const s=captureState.state;
    const step=recording?.region?4:['countdown','recording','paused','stopping'].includes(s)||s==='ready'&&regionConfirmed?3:s==='ready'?2:1;
    return ['화면 공유','영역 확정','선택 영역 녹화','프레임 가져오기'].map((label,i)=>`<li class="capture-step ${i+1<step?'done':i+1===step?'active':''}" ${i+1===step?'aria-current="step"':''}><b>${i+1}</b>${label}</li>`).join('');
  }
  function regionReadyText(){return regionConfirmed?'3. 선택 영역을 녹화할 준비가 됐어요':'2. 범위를 고르고 영역을 확정해 주세요';}
  function updateRegionConfirmationUI(){
    if(tool!=='region')return;
    const b=$('settings').querySelector('[data-action="startRecord"]');if(b)b.disabled=busy||!regionConfirmed||!!regionPointer||!regionSourceSize().width;
    const status=$('settings').querySelector('.capture-status strong');if(status&&captureState.state==='ready')status.textContent=regionReadyText();
    if($('captureSteps'))$('captureSteps').innerHTML=captureStepsHTML();
    syncRegionPreview();
  }
  function invalidateRegionConfirmation(){regionConfirmed=false;confirmedRegion=null;confirmedSourceSize=null;updateRegionConfirmationUI();}
  function confirmCaptureRegion(){
    if(regionPointer){toast('드래그를 마친 뒤 영역을 확정해 주세요.');return;}
    if(!applyRegionInputs())return;
    confirmedRegion=clone(captureRegion);confirmedSourceSize=regionSourceSize();regionConfirmed=true;updateRegionConfirmationUI();toast('영역을 확정했어요. 선택 영역 녹화를 시작할 수 있어요.');
  }
  const regionPreview=document.createElement('section');regionPreview.id='regionOutputPreview';regionPreview.className='region-live-preview';regionPreview.hidden=true;
  regionPreview.innerHTML='<header class="region-preview-head"><h3 class="region-preview-title">선택 영역 미리보기</h3><span class="region-preview-meta" id="regionPreviewMeta"></span></header><canvas id="regionPreviewCanvas" aria-label="GIF에 담길 선택 영역 미리보기"></canvas><p class="region-preview-note" id="regionPreviewNote"></p>';
  document.querySelector('.stage-footer').after(regionPreview);
  function regionPreviewVisible(){const v=$('stageVideo');return tool==='region'&&!v.hidden&&v.videoWidth>0&&v.videoHeight>0&&(captureActive()||!!recording?.region)&&captureState.state!=='selecting';}
  function cancelRegionPreview(){if(!regionPreviewRequest)return;const v=$('stageVideo');if(regionPreviewRequest.kind==='video')v.cancelVideoFrameCallback?.(regionPreviewRequest.id);else cancelAnimationFrame(regionPreviewRequest.id);regionPreviewRequest=null;}
  function drawRegionPreview(){
    if(!regionPreviewVisible())return;
    const v=$('stageVideo'),p=regionPixels(recording?.region||captureRegion),canvas=$('regionPreviewCanvas'),scale=Math.min(360/p.w,180/p.h),w=Math.max(1,Math.round(p.w*scale)),h=Math.max(1,Math.round(p.h*scale));
    if(canvas.width!==w||canvas.height!==h){canvas.width=w;canvas.height=h;}
    if(v.readyState>=2){try{canvas.getContext('2d').drawImage(v,p.x,p.y,p.w,p.h,0,0,w,h);}catch{}}
    $('regionPreviewMeta').textContent=p.w+' × '+p.h+' px';
    $('regionPreviewNote').textContent=captureState.state==='ready'?(regionConfirmed?'확정한 범위예요. 이 부분만 GIF에 담겨요.':'범위를 확인한 뒤 ‘영역 확정’을 눌러 주세요.'):'녹화 시작 때 확정한 범위만 GIF에 담겨요.';
  }
  function scheduleRegionPreview(){
    const v=$('stageVideo');if(regionPreviewRequest||!regionPreviewVisible()||v.paused||v.ended)return;
    const tick=()=>{regionPreviewRequest=null;if(!regionPreviewVisible())return;drawRegionPreview();scheduleRegionPreview();};
    regionPreviewRequest=typeof v.requestVideoFrameCallback==='function'?{kind:'video',id:v.requestVideoFrameCallback(tick)}:{kind:'raf',id:requestAnimationFrame(tick)};
  }
  function syncRegionPreview(){regionPreview.hidden=!regionPreviewVisible();if(regionPreview.hidden){cancelRegionPreview();return;}drawRegionPreview();scheduleRegionPreview();}
  function renderRegionOverlay(){
    const overlay=$('captureRegionOverlay'),box=$('captureRegionBox'),v=$('stageVideo'),wrap=$('stageWrap');
    const show=tool==='region'&&!v.hidden&&v.videoWidth&&(captureActive()||recording?.region)&&captureState.state!=='selecting';
    overlay.hidden=!show;syncRegionPreview();if(!show)return;
    const vr=v.getBoundingClientRect(),wr=wrap.getBoundingClientRect();
    Object.assign(overlay.style,{left:vr.left-wr.left+wrap.scrollLeft+'px',top:vr.top-wr.top+wrap.scrollTop+'px',width:vr.width+'px',height:vr.height+'px'});
    const r=recording?.region||captureRegion;
    Object.assign(box.style,{left:r.x*vr.width+'px',top:r.y*vr.height+'px',width:r.w*vr.width+'px',height:r.h*vr.height+'px'});
    overlay.classList.toggle('passive',captureState.state!=='ready'||busy);
  }
  function regionPoint(e){const r=$('captureRegionOverlay').getBoundingClientRect();return {x:clamp((e.clientX-r.left)/r.width,0,1),y:clamp((e.clientY-r.top)/r.height,0,1)};}
  $('captureRegionOverlay').addEventListener('pointerdown',e=>{
    if(tool!=='region'||captureState.state!=='ready'||busy||e.button!==0)return;
    regionPointer={start:regionPoint(e),previous:clone(captureRegion)};invalidateRegionConfirmation();e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();
  });
  $('captureRegionOverlay').addEventListener('pointermove',e=>{
    if(!regionPointer)return;const p=regionPoint(e),s=regionPointer.start,size=regionSourceSize();
    setRegionPixels({x:Math.min(s.x,p.x)*size.width,y:Math.min(s.y,p.y)*size.height,w:Math.max(16,Math.abs(s.x-p.x)*size.width),h:Math.max(16,Math.abs(s.y-p.y)*size.height)});
  });
  $('captureRegionOverlay').addEventListener('pointerup',e=>{
    if(!regionPointer)return;regionPointer=null;try{e.currentTarget.releasePointerCapture(e.pointerId);}catch{}updateRegionConfirmationUI();toast('범위를 골랐어요. 영역 확정을 눌러 주세요.');
  });
  $('captureRegionOverlay').addEventListener('pointercancel',()=>{if(regionPointer)captureRegion=regionPointer.previous;regionPointer=null;updateRegionFields();renderRegionOverlay();});
  $('stageVideo').addEventListener('loadedmetadata',()=>{if(tool==='region'){renderSettings();renderRegionOverlay();}});
  $('stageVideo').addEventListener('resize',()=>{const size=regionSourceSize();if(confirmedSourceSize&&(size.width!==confirmedSourceSize.width||size.height!==confirmedSourceSize.height)&&captureState.state==='ready')invalidateRegionConfirmation();renderRegionOverlay();if(tool==='region'&&captureState.state==='ready')renderSettings();});
  for(const event of ['play','seeked','timeupdate'])$('stageVideo').addEventListener(event,syncRegionPreview);
  $('stageVideo').addEventListener('pause',()=>{cancelRegionPreview();drawRegionPreview();});
  $('stageWrap').addEventListener('scroll',renderRegionOverlay);
  async function startRecording(){
    if(tool==='region'){
      if(regionPointer){toast('영역 드래그를 마친 뒤 녹화를 시작해 주세요.');return;}
      const size=regionSourceSize();
      if(!regionConfirmed||!confirmedRegion){toast('녹화할 범위를 정하고 영역 확정을 먼저 눌러 주세요.');return;}
      if(size.width!==confirmedSourceSize?.width||size.height!==confirmedSourceSize?.height){invalidateRegionConfirmation();toast('공유 영상 크기가 바뀌었어요. 영역을 다시 확정해 주세요.');return;}
      recordingRegion=clone(confirmedRegion);
    }else recordingRegion=null;
    try{await capture.start(recordSettings);}catch(e){toast(e.message);}
  }

  const capture = new window.GifCapture({onState:info=>{const changed=info.state!==captureState.state||info.remaining!==captureState.remaining;captureState=info;if(info.result){clearRecording();recording={...info.result,region:info.mode==='region'?clone(recordingRegion||captureRegion):null,url:URL.createObjectURL(info.result.blob)};extractSettings={start:0,end:Math.round(Math.max(.02,Math.min(info.result.duration,info.maxSeconds||30))*100)/100};toast('녹화를 마쳤어요. 구간을 골라 프레임으로 가져오세요.');}renderStatus();if(changed&&['record','tab','region','snapshot'].includes(tool))renderSettings();const timer=$('settings').querySelector('.capture-status span:last-child');if(timer)timer.textContent=time((info.elapsed||0)*1000);if(changed||info.result)renderCanvas();},onPreview:stream=>{const v=$('stageVideo');v.removeAttribute('src');v.srcObject=stream;v.hidden=!stream;if(stream){v.controls=false;v.play().then(renderRegionOverlay).catch(()=>{});}else{v.pause();$('captureRegionOverlay').hidden=true;syncRegionPreview();}},onProgress:info=>{captureState={...captureState,...info};const el=$('settings').querySelector('.capture-status span:last-child');if(el)el.textContent=time((info.elapsed||0)*1000);if(info.message)toast(info.message);},onError:error=>toast(error.message||String(error))});
  async function selectCapture(mode){if(busy||captureActive()){toast('현재 공유를 종료한 뒤 새 화면을 선택해 주세요.');return;}if(recording)clearRecording();captureRegion={x:0,y:0,w:1,h:1};recordingRegion=null;regionPointer=null;invalidateRegionConfirmation();setTool(mode);try{await capture.select(mode==='snapshot'?'snapshot':mode==='tab'?'tab':mode==='region'?'region':'record');}catch(e){toast(e.message);}}
  async function importRecording(){if(!recording||busy||captureActive())return;const start=Number($('extractStart')?.value??0),end=Number($('extractEnd')?.value??recording.duration);if(!Number.isFinite(start)||!Number.isFinite(end)||start<0||end<=start||end>recording.duration+.15){toast('녹화 길이 안에서 시작보다 큰 끝 시간을 입력해 주세요.');return;}if(Math.ceil((end-start)*state.out.fps)>600-count()){toast('총600프레임 이내로 구간이나 FPS를 줄여 주세요.');return;}const signal=beginTask('녹화에서 프레임을 꺼내요'),prepared=[];try{const extracted=await window.extractGifFrames(recording.blob,{start,end,fps:state.out.fps,width:state.out.width,region:recording.region||undefined,maxFrames:600-count(),signal,onProgress:p=>progress(p.message||`${p.current||p.done||0} / ${p.total||0} 프레임 추출`,p.current||p.done||0,p.total||0)});for(const [i,f] of extracted.frames.entries()){if(signal.aborted)throw new DOMException('취소','AbortError');const id=await prepareSource(f.blob,`녹화 프레임 ${i+1}.png`);prepared.push(frameFromSource(id,f.delay));progress(`${i+1} / ${extracted.frames.length} 프레임 준비`,i+1,extracted.frames.length);}if(signal.aborted)throw new DOMException('취소','AbortError');addPrepared(prepared,prepared.length+'개 녹화 프레임을 추가했어요.');clearRecording();setTool('crop',true);}catch(e){collectSources();toast(e.name==='AbortError'?'프레임 추출을 취소했어요. 녹화는 다시 사용할 수 있어요.':e.message);}finally{finishTask();}}
  async function takeSnapshot(){if(busy)return;if(count()>=600){toast('최대600프레임까지 추가할 수 있어요.');return;}const signal=beginTask('현재 화면을 한 장 담아요');try{const f=await capture.snapshot();if(signal.aborted)throw new DOMException('취소','AbortError');const id=await prepareSource(f.blob,`화면 캡처 ${count()+1}.png`);if(signal.aborted||count()>=600){collectSources();throw new DOMException('취소','AbortError');}addPrepared([frameFromSource(id)],'현재 공유 화면을 한 장 담았어요.');}catch(e){toast(e.name==='AbortError'?'한 장 캡처를 취소했어요.':e.message);}finally{finishTask();}}
  async function makeGif(){if(locked()||!count()||captureActive())return;if(overlayDraft)applyDraft();const sequence=frameSequence();if(sequence.length>600){toast('재생 방향을 포함해 최대600프레임까지 만들 수 있어요. 프레임을 줄여 주세요.');return;}const signal=beginTask('GIF를 만들어요'),c=cropPixels(),started=performance.now();try{await document.fonts?.ready;exporter=new window.GifExport({onProgress:p=>{if(p.phase==='encoding')progress(`GIF 인코딩 ${p.done} / ${sequence.length}`,p.done,sequence.length);}});const repeat=state.out.repeat==='once'?-1:state.out.repeat==='infinite'?0:Math.max(1,state.out.count-1);await exporter.start({width:c.w,height:c.h,colors:state.out.colors,repeat,dedupe:state.out.dedupe,total:sequence.length,signal});for(const [i,frame] of sequence.entries()){if(signal.aborted)throw new DOMException('취소','AbortError');progress(`프레임 준비 ${i+1} / ${sequence.length}`,i,sequence.length);const rendered=await compose(frame);const rgba=rendered.getContext('2d',{willReadFrequently:true}).getImageData(0,0,rendered.width,rendered.height).data;await exporter.addFrame(rgba,frame.delay);rendered.width=0;rendered.height=0;}progress('GIF 파일을 마무리해요.');const encoded=await exporter.finish();if(signal.aborted)throw new DOMException('취소','AbortError');releaseResult();result={...encoded,url:URL.createObjectURL(encoded.blob),seconds:(performance.now()-started)/1000};dirty=false;showResult();toast('GIF가 완성됐어요. 저장해 주세요.');}catch(e){if(e.name==='AbortError'||signal.aborted)toast('GIF 만들기를 취소했어요. 편집한 프레임은 유지돼요.');else toast('GIF를 만들지 못했어요. '+e.message);}finally{exporter?.cancel();finishTask();}}
  function fileName(){const now=new Date();const stamp=[now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-');return (state.title.replace(/[\\/:*?"<>|\u0000-\u001f]/g,'_').trim().slice(0,80)||'송쌤과학_GIF')+'_'+stamp+'.gif';}
  function showResult(){
    const panel=$('resultPanel');panel.replaceChildren();panel.hidden=false;
    const reducedMotion=matchMedia('(prefers-reduced-motion:reduce)').matches;
    const head=document.createElement('div');head.className='result-heading';head.innerHTML='<span class="eyebrow">ALL DONE</span><h2>움직이는 수업 자료가 완성됐어요.</h2>';
    const img=document.createElement('img');img.id='resultPreview';img.alt='생성된 GIF 미리보기';img.className='result-preview';
    panel.append(head);
    if(reducedMotion){
      img.hidden=true;
      const previewUrl=result.url,previewButton=document.createElement('button');
      previewButton.id='resultPreviewToggle';previewButton.type='button';previewButton.className='btn';previewButton.textContent='GIF 미리보기 재생';previewButton.setAttribute('aria-controls',img.id);previewButton.setAttribute('aria-pressed','false');
      previewButton.addEventListener('click',()=>{
        const start=img.hidden;
        if(start){img.src=previewUrl;img.hidden=false;}
        else {img.removeAttribute('src');img.hidden=true;}
        previewButton.textContent=start?'GIF 미리보기 정지':'GIF 미리보기 재생';previewButton.setAttribute('aria-pressed',String(start));
      });
      panel.append(previewButton);
    }else img.src=result.url;
    const summary=document.createElement('p');summary.className='result-meta';summary.textContent=`${result.width} × ${result.height} px · ${result.frameCount} 프레임 · ${time(result.duration)} · ${bytes(result.blob.size)} · ${result.seconds.toFixed(1)} 초 소요`;
    const filename=document.createElement('p');filename.className='result-filename';filename.textContent=fileName();
    const actions=document.createElement('div');actions.className='row';actions.innerHTML=btn('download','GIF 저장',false,'primary')+btn('closeResult','설정 바꿔 다시 만들기');
    panel.append(img,summary,filename,actions);panel.scrollIntoView({behavior:reducedMotion?'instant':'smooth',block:'nearest'});
  }
  function download(){if(!result){toast('GIF를 먼저 만들어 주세요.');return;}const a=document.createElement('a');a.href=result.url;a.download=fileName();document.body.append(a);a.click();a.remove();toast('GIF 파일을 저장했어요.');}
  function showModal(title,html){modalReturn=document.activeElement;$('modalTitle').textContent=title;$('modalBody').innerHTML=html;$('modalOverlay').hidden=false;$('modalClose').focus();}
  function closeModal(){$('modalOverlay').hidden=true;if(modalReturn?.isConnected)modalReturn.focus();}
  function newProject(){if(locked())return;const reset=()=>{capture.close();captureRegion={x:0,y:0,w:1,h:1};recordingRegion=null;regionPointer=null;invalidateRegionConfirmation();stopPlayback();clearRecording();releaseResult();state={frames:[],out:defaults(),crop:null,title:'나의 수업 GIF'};undo=[];redo=[];selected.clear();cursor=0;dirty=false;overlayDraft=null;collectSources();tool='images';closeModal();render();setTool('images');};if(count()||recording){showModal('새 작업을 시작할까요?',`<p>현재 사진과 녹화는 페이지를 닫으면 사라져요. 필요한 결과를 GIF로 저장해 주세요.</p><div class="row">${btn('dismissModal','계속 편집')}${btn('confirmNew','새 작업 시작',false,'danger')}</div>`);$('modalBody').querySelector('[data-action="confirmNew"]').onclick=reset;}else reset();}
  function help(){showModal('GIF 스튜디오 사용 안내',`<h3>파일이 어디로 가나요?</h3><p>사진·화면 영상·자막은 이 브라우저 안에서만 처리해요. 서버 업로드·로그인·외부 변환 API가 없어요. Pretendard 글꼴을 읽을 때만 외부 요청이 발생하며, 글꼴이 없어도 만들 수 있어요.</p><h3>세 단계면 완성돼요</h3><ol><li>이미지를 불러오거나 공유 화면을 녹화해요.</li><li>프레임 순서·시간·영역을 다듬고 설명을 넣어요.</li><li>GIF 만들기 후 실제 결과를 확인하고 저장해요.</li></ol><p>녹화는 PC Chrome·Edge의 HTTPS/localhost를 권장해요. 브라우저 선택창에서 대상을 직접 고르고, macOS에서는 화면 녹화 권한이 필요할 수 있어요. 모바일에서 화면 공유 API가 없으면 이미지 제작만 사용할 수 있어요.</p><h3>공유 화면 영역 녹화</h3><p>Windows와 Mac에서 같은 웹 사이트를 사용해요. 브라우저 선택창에서 전체 화면·창·탭을 공유한 뒤, 사이트 미리보기에서 드래그하거나 X·Y·너비·높이로 범위를 정하고 ‘영역 확정’을 눌러요. 아래의 선택 영역 미리보기로 GIF에 담길 부분을 확인할 수 있어요. 범위를 바꾸면 다시 확정해야 해요. 선택 영역만 GIF로 만들며 공유 전체 영상은 이 기기에 임시 기록돼요. 녹화 시작 후 영역은 고정돼요.</p><h3>기본값과 한도</h3><p>녹화10FPS·가로800px·최대15초, 선택 시30초. 최대600프레임·출력 긴 쪽1280px·이미지당50MB·임시 녹화128MiB를 기준으로 해요. GIF는 소리가 없고 팔레트당 최대256색이에요. 매우 짧은 표시 시간은 재생 앱에서 보정될 수 있어요.</p><p>사진·녹화는 영구 저장되지 않아요. 새로고침하거나 창을 닫기 전에 결과를 저장해 주세요.</p><h3>단축키</h3><table><tbody><tr><td>이미지 열기</td><td>Ctrl/Cmd+O</td></tr><tr><td>실행 취소 · 다시 실행</td><td>Ctrl/Cmd+Z · Shift+Z / Ctrl+Y</td></tr><tr><td>GIF 만들기 · 저장</td><td>Ctrl/Cmd+Enter · S</td></tr><tr><td>재생 · 프레임 이동</td><td>Space · ← →</td></tr><tr><td>선택 삭제 · 도구 선택</td><td>Delete · 1~9 / 영역 녹화0</td></tr><tr><td>도움말 · 레일 접기</td><td>F1 · [</td></tr></tbody></table><p>단축키는 이 페이지가 활성화돼 있을 때만 동작해요.</p>`);}
  async function action(name){const actions={pick:()=>$('imageInput').click(),images:()=>{setTool('images');$('imageInput').click();},demo:loadDemo,record:()=>selectCapture('record'),tab:()=>selectCapture('tab'),region:()=>selectCapture('region'),regionApply:confirmCaptureRegion,regionFull:()=>{if(captureState.state==='ready'){captureRegion={x:0,y:0,w:1,h:1};invalidateRegionConfirmation();updateRegionFields();renderRegionOverlay();}},snapshot:()=>selectCapture('snapshot'),selectCapture:()=>selectCapture(tool),startRecord:startRecording,pauseRecord:()=>capture.pause(),resumeRecord:()=>capture.resume(),stopRecord:()=>capture.stop().catch(e=>toast(e.message)),closeCapture:()=>{capture.close();invalidateRegionConfirmation();renderCanvas();},takeSnapshot,extract:importRecording,sort:()=>commit(()=>{state.frames.sort((a,b)=>a.name.localeCompare(b.name,'ko',{numeric:true}));cursor=0;},'파일 이름순으로 정렬했어요.'),selectAll:()=>{selected=new Set(state.frames.map(f=>f.id));renderTimeline();renderSettings();},duplicate:()=>{if(count()+selected.size>600){toast('최대600프레임까지 추가할 수 있어요.');return;}commit(()=>{state.frames=state.frames.flatMap(f=>selected.has(f.id)?[f,{...clone(f),id:uid(),name:f.name+' 복제'}]:[f]);},'선택 프레임을 복제했어요.');},delete:deleteSelected,moveEarlier:()=>moveSelected(-1),moveLater:()=>moveSelected(1),trimBefore:()=>commit(()=>{state.frames=state.frames.slice(cursor);cursor=0;},'현재 프레임 이전을 지웠어요.'),trimAfter:()=>commit(()=>{state.frames=state.frames.slice(0,cursor+1);},'현재 프레임 이후를 지웠어요.'),delaySelected:()=>changeDelay('selected'),delayAll:()=>changeDelay('all'),faster:()=>changeDelay('all',.5),slower:()=>changeDelay('all',2),applyCrop:()=>applyCrop(readCrop()),resetCrop:()=>commit(()=>{state.crop=null;overlayDraft=null;},'자르기를 초기화했어요.'),addAnnotation:()=>addAnnotation(readAnnotation()),clearAnnotations:()=>commit(()=>{if(activeFrame())activeFrame().annotations=[];},'현재 프레임의 설명을 지웠어요.'),clearAllAnnotations:()=>commit(()=>{for(const f of state.frames)f.annotations=[];},'모든 설명을 지웠어요.'),presetSmall:()=>setPreset('small'),presetBalanced:()=>setPreset('balanced'),presetClear:()=>setPreset('clear'),make:makeGif,download,closeResult:()=>{$('resultPanel').hidden=true;setTool('export');},dismissModal:closeModal};try{if(actions[name])await actions[name]();}catch(e){toast(e.message||'작업을 완료하지 못했어요. 다시 시도해 주세요.');}}
  document.addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(b&&!b.disabled)action(b.dataset.action);});
  document.querySelectorAll('#rail [data-tool]').forEach(b=>b.addEventListener('click',()=>setTool(b.dataset.tool)));
  $('settings').addEventListener('input',e=>{if(/^captureRegion[XYWH]$/.test(e.target.id)&&captureState.state==='ready')invalidateRegionConfirmation();});
  $('settings').addEventListener('change',e=>{const el=e.target,id=el.id;if(locked())return;
    if(['direction','repeat','colors','dedupe'].includes(id))commit(()=>{state.out[id]=id==='colors'?Number(el.value):id==='dedupe'?el.checked:el.value;});
    if(id==='repeatCount')commit(()=>state.out.count=Math.round(clamp(el.value,2,100)));
    if(['captureFPS','exportFPS'].includes(id))commit(()=>state.out.fps=Number(el.value));
    if(['captureRegionX','captureRegionY','captureRegionW','captureRegionH'].includes(id)){applyRegionInputs();return;}
    if(id==='maxSeconds')recordSettings.maxSeconds=Number(el.value);if(id==='countdown')recordSettings.countdown=Number(el.value);
    if(id==='extractStart')extractSettings.start=Number(el.value);if(id==='extractEnd')extractSettings.end=Number(el.value);
    if(id==='fitMode')commit(()=>state.out.fit=el.value);if(id==='matte')commit(()=>state.out.matte=el.value);
    if(id==='outputWidth'||id==='outputHeight'){let w=Number($('outputWidth').value),h=Number($('outputHeight').value);if($('sizeLock').checked){if(id==='outputWidth'){w=clamp(w,16,1280);h=Math.round(state.out.height*w/state.out.width);}else{h=clamp(h,16,1280);w=Math.round(state.out.width*h/state.out.height);}const m=Math.max(w,h);if(m>1280){w=Math.round(w*1280/m);h=Math.round(h*1280/m);}}updateSize(w,h);}
    if(id==='sizePreset'){let w=Number(el.value),h=Math.round(state.out.height*w/state.out.width);if(h>1280){w=Math.round(w*1280/h);h=1280;}updateSize(w,h);}
    if(id==='annotationKind'){annotationKind=el.value;overlayDraft=null;renderSettings();renderCanvas();}
    if(['cropX','cropY','cropW','cropH'].includes(id)){overlayDraft={type:'crop',crop:readCrop()};renderCanvas();}
  });
  $('imageInput').addEventListener('change',e=>importFiles(e.target.files));
  $('addImages').onclick=()=>action('pick');$('newProject').onclick=newProject;$('undo').onclick=()=>restore('undo');$('redo').onclick=()=>restore('redo');$('makeGif').onclick=makeGif;$('saveGif').onclick=download;$('demoButton').onclick=loadDemo;$('helpButton').onclick=help;$('privacyButton').onclick=help;$('modalClose').onclick=closeModal;
  $('themeButton').onclick=()=>{const root=document.documentElement;root.dataset.theme=root.dataset.theme==='dark'?'light':'dark';try{localStorage.setItem('ss.theme',root.dataset.theme);}catch{}updateChromeLabels();};
  $('railToggle').onclick=()=>{document.documentElement.classList.toggle('rail-collapsed');try{localStorage.setItem('ss.rail',document.documentElement.classList.contains('rail-collapsed')?'collapsed':'expanded');}catch{}updateChromeLabels();setTimeout(fitCanvas,220);};
  $('projectName').addEventListener('change',e=>commit(()=>state.title=e.target.value.trim().slice(0,80)||'나의 수업 GIF'));
  $('prevFrame').onclick=()=>setCurrent((cursor-1+count())%count());$('nextFrame').onclick=()=>setCurrent((cursor+1)%count());$('play').onclick=playToggle;
  $('zoomOut').onclick=()=>{viewFit=false;zoom=clamp(zoom*.8,.1,3);fitCanvas();};$('zoomIn').onclick=()=>{viewFit=false;zoom=clamp(zoom*1.25,.1,3);fitCanvas();};$('fitView').onclick=()=>{viewFit=true;fitCanvas();};
  $('cancelTask').onclick=()=>{aborter?.abort();exporter?.cancel();};
  $('modalOverlay').addEventListener('click',e=>{if(e.target===$('modalOverlay'))closeModal();});
  $('timeline').addEventListener('click',e=>{const f=e.target.closest('[data-index]');if(f&&!locked())setCurrent(Number(f.dataset.index),e.ctrlKey||e.metaKey,e.shiftKey);});
  let dragId=null;$('timeline').addEventListener('dragstart',e=>{const b=e.target.closest('[data-id]');if(!b||locked())return;dragId=b.dataset.id;e.dataTransfer.setData('text/plain',dragId);e.dataTransfer.effectAllowed='move';});
  $('timeline').addEventListener('dragover',e=>{if(dragId){e.preventDefault();e.dataTransfer.dropEffect='move';}});
  $('timeline').addEventListener('drop',e=>{if(!dragId)return;e.preventDefault();e.stopPropagation();const b=e.target.closest('[data-id]'),id=dragId;dragId=null;if(!b||b.dataset.id===id)return;const target=b.dataset.id;commit(()=>{const from=state.frames.findIndex(f=>f.id===id);const to=state.frames.findIndex(f=>f.id===target);const [moving]=state.frames.splice(from,1);state.frames.splice(to,0,moving);cursor=to;selected=new Set([moving.id]);},'프레임 순서를 바꿨어요.');});
  $('timeline').addEventListener('dragend',()=>dragId=null);
  document.addEventListener('dragover',e=>{if(e.dataTransfer.types.includes('Files')){e.preventDefault();$('stageWrap').classList.add('drag-over');}});document.addEventListener('dragleave',e=>{if(!e.relatedTarget)$('stageWrap').classList.remove('drag-over');});document.addEventListener('drop',e=>{if(e.dataTransfer.files.length){e.preventDefault();$('stageWrap').classList.remove('drag-over');importFiles(e.dataTransfer.files);}});
  document.addEventListener('paste',e=>{if(e.target.closest('input,textarea,[contenteditable]'))return;const files=[...e.clipboardData.items].filter(x=>x.kind==='file'&&x.type.startsWith('image/')).map(x=>x.getAsFile()).filter(Boolean);if(files.length){e.preventDefault();importFiles(files);}});
  document.addEventListener('keydown',e=>{
    const openModal=!$('modalOverlay').hidden,openProgress=!$('progressOverlay').hidden;
    if(openModal||openProgress){const overlay=openProgress?$('progressOverlay'):$('modalOverlay');if(e.key==='Tab'){const nodes=[...overlay.querySelectorAll('button,input,select,textarea,a[href]')].filter(x=>!x.disabled&&!x.hidden);const first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}if(e.key==='Escape'){e.preventDefault();if(openProgress)$('cancelTask').click();else closeModal();}return;}
    const typing=e.target.closest('input,textarea,select,[contenteditable]'),mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(mod&&key==='o'){e.preventDefault();if(!locked()&&!captureActive())$('imageInput').click();return;}
    if(mod&&key==='s'){e.preventDefault();download();return;}
    if(typing)return;
    if(mod&&key==='z'){e.preventDefault();restore(e.shiftKey?'redo':'undo');}
    else if(mod&&key==='y'){e.preventDefault();restore('redo');}
    else if(mod&&key==='enter'){e.preventDefault();makeGif();}
    else if(key===' '){e.preventDefault();playToggle();}
    else if(key==='delete'||key==='backspace'){e.preventDefault();if(!locked())deleteSelected();}
    else if(key==='arrowleft'){e.preventDefault();if(!locked())setCurrent(Math.max(0,cursor-1),false,e.shiftKey);}
    else if(key==='arrowright'){e.preventDefault();if(!locked())setCurrent(Math.min(count()-1,cursor+1),false,e.shiftKey);}
    else if(key==='f1'){e.preventDefault();help();}
    else if(key==='['){e.preventDefault();$('railToggle').click();}
    else if(key==='escape'){overlayDraft=null;pointerDraft=null;if(regionPointer){captureRegion=regionPointer.previous;regionPointer=null;updateRegionFields();updateRegionConfirmationUI();}stopPlayback();renderCanvas();}
    else if(key==='enter'&&overlayDraft){e.preventDefault();applyDraft();}
    else if(/^[0-9]$/.test(key))setTool(Object.keys(names)[key==='0'?9:Number(key)-1]);
  });
  addEventListener('beforeunload',e=>{if((dirty&&count())||captureActive()||recording){e.preventDefault();e.returnValue='';}});
  addEventListener('pagehide',()=>{cancelRegionPreview();capture.close();exporter?.cancel();});
  const layoutChanged=()=>{fitCanvas();renderRegionOverlay();};addEventListener('resize',layoutChanged);new ResizeObserver(layoutChanged).observe($('stageWrap'));
  if($('today'))$('today').textContent=new Date().toLocaleDateString('ko-KR',{month:'long',day:'numeric',weekday:'long'});
  function updateChromeLabels(){const dark=document.documentElement.dataset.theme==='dark';$('themeButton').setAttribute('aria-pressed',String(dark));$('themeButton').setAttribute('aria-label',dark?'밝은 화면으로 전환':'어두운 화면으로 전환');$('themeButton').title=dark?'밝은 화면으로 전환':'어두운 화면으로 전환';const collapsed=document.documentElement.classList.contains('rail-collapsed');$('railToggle').setAttribute('aria-expanded',String(!collapsed));$('railToggle').setAttribute('aria-label',collapsed?'도구 레일 펼치기':'도구 레일 접기');}
  updateChromeLabels();render();setTool('images');
  window.GifStudio={getState:()=>clone(state),getCaptureRegion:()=>clone(recording?.region||captureRegion),getResult:()=>result?{width:result.width,height:result.height,frameCount:result.frameCount,duration:result.duration,size:result.blob.size}:null};
})();
