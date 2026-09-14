const token = new URLSearchParams(location.search).get('token') || '';
const $ = (id) => document.getElementById(id);
const statusLabels = { planned:'待生成', rendered:'技术待处理', auto_passed:'技术暂定通过', pending_review:'待试听', approved:'已通过', rejected:'已拒绝', superseded:'已失效' };
const routeLabels = { annotation:'音频标注会话', 'voice-cards':'音色卡制作会话', recording:'音频录制与质检会话', manager:'制作总控' };
let state;
let items = [];
let index = 0;

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers:{ 'X-Review-Token':token, ...(options.body ? {'Content-Type':'application/json'} : {}), ...options.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body;
}
const shortHash = (value) => value ? `${value.slice(0,10)}…${value.slice(-6)}` : '—';
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function audioUrl(target, kind) { return `/api/audio/${encodeURIComponent(target.reviewKey)}?kind=${kind}&token=${encodeURIComponent(token)}`; }

function rebuildFilters() {
  const targets = state.plan.targets;
  const fill = (id, values, label) => {
    const select=$(id), current=select.value; select.innerHTML=`<option value="">全部</option>`;
    for (const value of [...new Set(values.filter(Boolean))]) select.insertAdjacentHTML('beforeend',`<option value="${esc(value)}">${esc(label(value))}</option>`);
    select.value=current;
  };
  fill('status-filter', targets.map(x=>x.effectiveStatus), x=>statusLabels[x]||x);
  fill('speaker-filter', targets.map(x=>x.speakerRef), x=>x);
  fill('issue-filter', Object.keys(state.policy.issueTypes), x=>state.policy.issueTypes[x].label);
  const issue=$('issue-type'), current=issue.value; issue.innerHTML='<option value="">请选择（拒绝/重录必填）</option>';
  for (const [value,meta] of Object.entries(state.policy.issueTypes)) issue.insertAdjacentHTML('beforeend',`<option value="${value}">${esc(meta.label)} → ${esc(routeLabels[meta.route])}</option>`);
  issue.value=current;
}

function applyFilters(keepKey) {
  const status=$('status-filter').value, speaker=$('speaker-filter').value, issue=$('issue-filter').value, remaining=$('remaining-only').checked;
  items=state.plan.targets.filter(x => (!status||x.effectiveStatus===status) && (!speaker||x.speakerRef===speaker) && (!remaining||x.effectiveStatus!=='approved') && (!issue||x.decision?.issueType===issue));
  const found=keepKey ? items.findIndex(x=>x.reviewKey===keepKey) : -1; index=found>=0?found:Math.min(index,Math.max(0,items.length-1)); render();
}

function renderSummary() {
  const s=state.status, c=s.counts.byStatus;
  $('summary').innerHTML=`<div class="metric"><strong>${s.counts.dialogueTargets}</strong><span>对白单元</span></div><div class="metric"><strong>${c.pending_review||0}</strong><span>待试听</span></div><div class="metric"><strong>${c.approved||0}</strong><span>已通过</span></div><div class="metric"><strong>${c.rejected||0}</strong><span>已拒绝</span></div><div class="metric gate ${s.gates.formalSceneCompositionAllowed?'ok':'blocked'}"><strong>${s.gates.formalSceneCompositionAllowed?'门禁已开':'门禁阻塞'}</strong><span>${esc(s.blockers.join('；')||'允许正式场景合成')}</span></div>`;
}

function highlight(block, unit) {
  const at=block.indexOf(unit); if(at<0) return esc(block); return `${esc(block.slice(0,at))}<mark class="current-unit">${esc(unit)}</mark>${esc(block.slice(at+unit.length))}`;
}
function render() {
  renderSummary(); $('position').textContent=items.length?`${index+1} / ${items.length}`:'0 / 0'; $('review-card').hidden=!items.length; $('empty').hidden=!!items.length; $('previous').disabled=index<=0; $('next').disabled=index>=items.length-1;
  if(!items.length) return;
  const t=items[index], a=t.annotationSnapshot||{}, e=a.emotion||{}, event=t.decision?.history?.at(-1);
  $('identity').textContent=`${t.targetId} · 单元 ${(t.unitIndex??0)+1}`; $('speaker').textContent=t.kind==='scene_mix'?'整场试听':t.speakerRef;
  $('status-pill').textContent=statusLabels[t.effectiveStatus]||t.effectiveStatus; $('status-pill').className=`pill ${t.effectiveStatus}`;
  $('before').textContent=t.context?.previous?`前文｜${t.context.previous.text}`:''; $('block-text').innerHTML=highlight(t.blockText,t.unitText); $('after').textContent=t.context?.next?`后文｜${t.context.next.text}`:'';
  const chips=[`情绪 ${e.family||'—'} / ${e.variant||'—'} / ${e.intensity??'—'}`,`语速 ${a.pace||'—'}`,`音高 ${a.pitch||'—'}`,`力度 ${a.energy||'—'}`,`音质 ${(a.timbre||[]).join('、')||'—'}`,`修饰 ${(a.modifiers||[]).join('、')||'无'}`];
  $('semantics').innerHTML=chips.map(x=>`<span>${esc(x)}</span>`).join('');
  const performance=t.performance||{}; $('performance-note').textContent=[performance.speed?`合成速度 ${performance.speed}`:'',performance.instruction||''].filter(Boolean).join('｜'); $('performance-note').hidden=!$('performance-note').textContent;
  const fa=$('fragment-audio'), va=$('voice-audio'); fa.src=t.audio?audioUrl(t,'fragment'):''; fa.hidden=!t.audio; va.src=t.voiceCard?.cachePath?audioUrl(t,'voice-card'):''; va.hidden=!t.voiceCard?.cachePath;
  $('fragment-meta').innerHTML=t.audio?`时长 ${t.audio.durationSeconds??'—'}s · RMS ${t.audio.levels?.rmsDbfs??'—'} dBFS · 峰值 ${t.audio.levels?.peakDbfs??'—'} dBFS<br>render ${esc(shortHash(t.audio.renderHash))} · file ${esc(shortHash(t.audio.fileHash))}`:'尚无当前版本可试听文件';
  $('voice-meta').innerHTML=t.voiceCard?`${esc(t.voiceCard.label)} · ${esc(t.voiceCard.styleId||'—')}<br>file ${esc(shortHash(t.voiceCard.fileHash))}`:'无音色卡';
  const m=t.automaticCheck; $('machine-result').innerHTML=m?`<p>结构检查：${m.structuralPass?'通过':'未通过'} · 原始状态：${esc(m.rawStatus||'—')} · 相似度：${m.characterSimilarity??'—'}</p><p>转写：${esc(m.transcript||'—')}</p><p>${esc(m.note||'')}</p>`:'<p>尚无机器检查结果。</p>';
  $('note').value=t.decision?.note||event?.note||''; $('expected').value=t.decision?.expectedEffect||event?.expectedEffect||''; $('issue-type').value=t.decision?.issueType||event?.issueType||''; showRoute();
  const canDecide=Boolean(t.audio?.fileHash), canApprove=canDecide&&t.milestones?.autoPassed; $('approve').disabled=!canApprove; $('reject').disabled=!canDecide; $('rerecord').disabled=!canDecide;
}
function showRoute() { const type=$('issue-type').value, route=state?.policy.issueTypes[type]?.route; $('route').textContent=route?`此问题将写入：${routeLabels[route]}`:''; }
async function act(action) {
  const t=items[index], oldIndex=index; if(!t) return; $('save-state').textContent='正在保存…';
  try {
    state=await api('/api/action',{method:'POST',body:JSON.stringify({planHash:state.plan.planHash,reviewKey:t.reviewKey,action,issueType:$('issue-type').value,note:$('note').value,expectedEffect:$('expected').value})});
    $('save-state').textContent='已原子保存'; rebuildFilters(); index=action==='note'?oldIndex:action==='approve'?oldIndex:oldIndex+1; applyFilters(action==='note'?t.reviewKey:null);
  } catch(error) { $('save-state').innerHTML=`<span class="error">${esc(error.message)}</span>`; }
}
async function load(refresh=false) { $('save-state').textContent=refresh?'正在刷新计划…':'正在读取…'; try { state=await api(refresh?'/api/refresh':'/api/state',{method:refresh?'POST':'GET'}); rebuildFilters(); applyFilters(); $('save-state').textContent='状态已同步'; } catch(error) { $('save-state').innerHTML=`<span class="error">${esc(error.message)}</span>`; } }
for(const id of ['status-filter','speaker-filter','issue-filter','remaining-only']) $(id).addEventListener('change',()=>applyFilters(items[index]?.reviewKey));
$('issue-type').addEventListener('change',showRoute); $('previous').onclick=()=>{if(index>0){index--;render();}}; $('next').onclick=()=>{if(index<items.length-1){index++;render();}}; $('refresh').onclick=()=>load(true);
$('approve').onclick=()=>act('approve'); $('reject').onclick=()=>act('reject'); $('rerecord').onclick=()=>act('rerecord'); $('save-note').onclick=()=>act('note');
document.addEventListener('keydown',event=>{ const typing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName); if(event.ctrlKey&&event.key==='Enter'){event.preventDefault();act('note');return;} if(typing)return; const key=event.key.toLowerCase(); if(event.key===' '){event.preventDefault();const a=$('fragment-audio');a.paused?a.play():a.pause();} else if(event.key==='ArrowLeft')$('previous').click(); else if(event.key==='ArrowRight')$('next').click(); else if(key==='a')$('approve').click(); else if(key==='r')$('rerecord').click(); else if(key==='x')$('reject').click(); });
load();
