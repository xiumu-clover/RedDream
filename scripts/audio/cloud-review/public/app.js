const $ = (id) => document.getElementById(id);
let state;
let saving = false;
let retryDecision = null;

const fragment = new URLSearchParams(location.hash.slice(1));
const reviewerToken = fragment.get('key') || localStorage.getItem('honglou-review-key') || '';
if (fragment.get('key')) localStorage.setItem('honglou-review-key', fragment.get('key'));

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[character]);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials:'same-origin',
    headers:{
      ...(reviewerToken ? {Authorization:`Bearer ${reviewerToken}`} : {}),
      ...(options.body ? {'Content-Type':'application/json'} : {}),
      ...options.headers,
    },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `请求失败 ${response.status}`);
  return body;
}

function highlighted(block, unit) {
  const at = block.indexOf(unit);
  if (at < 0) return escapeHtml(block);
  return `${escapeHtml(block.slice(0,at))}<mark>${escapeHtml(unit)}</mark>${escapeHtml(block.slice(at+unit.length))}`;
}

function render() {
  $('error').hidden=true;
  $('progress').textContent=state.total ? `${state.completed + (state.target ? 1 : 0)} / ${state.total}` : '0 / 0';
  $('remaining').textContent=state.remaining ? `还剩 ${state.remaining} 条` : '本批已完成';
  $('card').hidden=!state.target;
  $('actions').hidden=!state.target;
  $('empty').hidden=Boolean(state.target);
  if (!state.target) {
    const waiting=state.summary?.waitingForRender || 0;
    $('empty-detail').textContent=waiting ? `另有 ${waiting} 条尚待生成，生成后会自动进入这里。` : '可以关闭页面。';
    return;
  }
  const target=state.target;
  $('chapter').textContent=`第${Number(state.manifest.chapter)}回`;
  $('speaker').textContent=target.kind==='scene_mix'?'整场试听':(target.speakerLabel||target.speakerRef);
  $('before').textContent=target.context?.previous?.text ? `前文｜${target.context.previous.text}` : '';
  $('text').innerHTML=highlighted(target.blockText,target.unitText);
  $('after').textContent=target.context?.next?.text ? `后文｜${target.context.next.text}` : '';
  $('audio').src=target.audio.url;
  $('audio').load();
  $('duration').textContent=target.audio.durationSeconds ? `约 ${target.audio.durationSeconds.toFixed(1)} 秒` : '';
  $('note').value='';
  $('note-error').textContent='';
}

async function load() {
  try {
    if(!reviewerToken)throw new Error('评审链接缺少访问密钥，请使用总控提供的完整网址。');
    state=await api('/api/review/state');
    render();
  } catch(error) {
    $('card').hidden=true;
    $('actions').hidden=true;
    $('empty').hidden=true;
    $('error').hidden=false;
    $('error-message').textContent=error.message;
  }
}

function decision(action,note='') {
  if (retryDecision?.action===action && retryDecision?.note===note
      && retryDecision?.reviewKey===state.target.reviewKey) return retryDecision;
  retryDecision={
    decisionId:crypto.randomUUID(),
    planHash:state.manifest.planHash,
    reviewKey:state.target.reviewKey,
    action,
    note,
  };
  return retryDecision;
}

async function submit(action,note='') {
  if (saving || !state?.target) return;
  saving=true;
  $('saving').hidden=false;
  $('approve').disabled=true;
  $('rerecord').disabled=true;
  try {
    state=await api('/api/review/decision',{method:'POST',body:JSON.stringify(decision(action,note))});
    retryDecision=null;
    $('rerecord-dialog').close();
    render();
    scrollTo({top:0,behavior:'smooth'});
  } catch(error) {
    $('error').hidden=false;
    $('error-message').textContent=`保存失败：${error.message}`;
  } finally {
    saving=false;
    $('saving').hidden=true;
    $('approve').disabled=false;
    $('rerecord').disabled=false;
  }
}

$('approve').addEventListener('click',()=>submit('approve'));
$('rerecord').addEventListener('click',()=>{$('rerecord-dialog').showModal();setTimeout(()=>$('note').focus(),50);});
$('submit-rerecord').addEventListener('click',()=>{
  const note=$('note').value.trim();
  if(!note){$('note-error').textContent='请写一句重录意见。';return;}
  $('note-error').textContent='';
  submit('rerecord',note);
});
$('retry').addEventListener('click',()=>retryDecision ? submit(retryDecision.action,retryDecision.note) : load());
load();
