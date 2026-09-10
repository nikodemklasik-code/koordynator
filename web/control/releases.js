const $ = (id) => document.getElementById(id);

function esc(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function short(value,left=14,right=8){const text=String(value??"—");return text.length<=left+right+1?text:`${text.slice(0,left)}…${text.slice(-right)}`}
function date(value){const d=new Date(value);return Number.isNaN(d.getTime())?String(value??"—"):new Intl.DateTimeFormat("en-GB",{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"UTC"}).format(d).replace(",","")+" UTC"}
function stateClass(value){return String(value).toLowerCase().replaceAll("-","_")}
function field(label,value){return `<div class="release-field"><span>${esc(label)}</span><code title="${esc(value)}">${esc(short(value,20,12))}</code></div>`}

function renderHealth(h){
  $("environmentLabel").textContent=h.environment;
  $("sidebarEnv").textContent=h.environment;
  $("operatorLabel").textContent=h.operator;
  $("regionLabel").textContent=h.region;
  $("zoneLabel").textContent=h.zone;
  $("versionLabel").textContent=`v${h.version}`;
  $("ciStatus").textContent=h.ciVerify;
  $("ciStatus").className=`status-badge ${h.ciVerify==="PASS"?"pass":h.ciVerify==="FAIL"?"fail":"neutral"}`;
  $("ciRing").className=`status-ring ${h.ciVerify==="PASS"?"pass":h.ciVerify==="FAIL"?"fail":""}`;
  $("ciRing").textContent=h.ciVerify==="FAIL"?"×":"✓";
}

function renderProduction(current){
  if(!current){
    $("productionSha").textContent="No production release";
    $("productionState").textContent="NONE";
    $("productionState").className="release-state";
    $("productionHint").textContent="Nothing is promoted to production yet.";
    $("productionGrid").innerHTML='<p class="muted">The release ledger has no current production pointer.</p>';
    return;
  }
  $("productionSha").textContent=short(current.releaseSha,28,16);
  $("productionSha").title=current.releaseSha;
  $("productionState").textContent=current.state;
  $("productionState").className=`release-state ${stateClass(current.state)}`;
  $("productionHint").textContent=`Changed ${date(current.changedAt)}`;
  $("productionGrid").innerHTML=[
    field("CANDIDATE SHA",current.candidateSha),
    field("ARTIFACT FP",current.artifactFp),
    field("RELEASE POLICY FP",current.releasePolicyFp),
    field("APPROVAL FP",current.approvalFp),
    field("SIGNED MANIFEST FP",current.releaseManifestFp),
    field("CHANGED",date(current.changedAt))
  ].join("");
}

function row(r){
  return `<tr class="${r.isCurrentProduction?"current-row":""}"><td><code title="${esc(r.releaseSha)}">${esc(short(r.releaseSha))}</code></td><td><span class="release-state ${stateClass(r.state)}">${esc(r.state)}</span></td><td>${esc(r.channel)}</td><td><code title="${esc(r.candidateSha)}">${esc(short(r.candidateSha))}</code></td><td><code title="${esc(r.artifactFp)}">${esc(short(r.artifactFp))}</code></td><td>${esc(date(r.changedAt))}</td><td class="${r.manifestIntegrity==="PASS"?"integrity-pass":"integrity-fail"}">${r.manifestIntegrity==="PASS"?"✓ PASS":"× FAIL"}</td></tr>`;
}

function renderChain(releases){
  const withPrevious=releases.filter(r=>r.previousProductionSha);
  if(!withPrevious.length){
    $("rollbackChain").innerHTML='<span class="activity-empty">No rollback links persisted.</span>';
    return;
  }
  $("rollbackChain").innerHTML=withPrevious.slice(0,6).map(r=>`<span class="chain-node" title="${esc(r.previousProductionSha)}">${esc(short(r.previousProductionSha,8,6))}</span><span class="chain-arrow">→</span><span class="chain-node" title="${esc(r.releaseSha)}">${esc(short(r.releaseSha,8,6))}</span>`).join("");
}

function activityIcon(state){
  const normalized=String(state??"").toUpperCase();
  if(normalized==="PRODUCTION")return "●";
  if(normalized==="CANARY")return "▷";
  if(normalized==="ROLLED_BACK")return "↶";
  return "◇";
}

function renderActivity(releases){
  if(!releases.length){
    $("activityList").innerHTML='<div class="activity-empty">No persisted release activity yet.</div>';
    return;
  }
  const sorted=[...releases].sort((a,b)=>new Date(b.changedAt).getTime()-new Date(a.changedAt).getTime()).slice(0,5);
  $("activityList").innerHTML=sorted.map(r=>`<div class="activity-item"><span class="activity-icon">${activityIcon(r.state)}</span><div class="activity-copy"><strong>${esc(r.state)} · ${esc(short(r.releaseSha,10,6))}</strong><small>${esc(r.channel)} · integrity ${esc(r.manifestIntegrity)}</small></div><span class="activity-time">${esc(date(r.changedAt))}</span></div>`).join("");
}

function render(payload){
  $("countTotal").textContent=payload.counts.total;
  $("countCanary").textContent=payload.counts.canary;
  $("countProduction").textContent=payload.counts.production;
  $("countRolledBack").textContent=payload.counts.rolledBack;
  renderProduction(payload.currentProduction);
  $("releaseRows").innerHTML=payload.releases.map(row).join("");
  $("loadingState").classList.add("hidden");
  $("emptyState").classList.toggle("hidden",payload.releases.length!==0);
  $("lastUpdated").textContent=`Updated ${new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())}`;
  renderActivity(payload.releases);
  renderChain(payload.releases);
}

async function load(){
  $("refreshButton").classList.add("refreshing");
  try{
    const [h,r]=await Promise.all([
      fetch("/api/health",{headers:{accept:"application/json"},cache:"no-store"}),
      fetch("/api/releases",{headers:{accept:"application/json"},cache:"no-store"})
    ]);
    if(!h.ok)throw new Error(`HEALTH_HTTP_${h.status}`);
    if(!r.ok)throw new Error(`RELEASES_HTTP_${r.status}`);
    renderHealth(await h.json());
    render(await r.json());
  }catch(error){
    $("loadingState").classList.add("hidden");
    $("emptyState").classList.remove("hidden");
    $("emptyState").querySelector("strong").textContent="Release ledger unavailable";
    $("emptyState").querySelector(":scope > span").textContent=error instanceof Error?error.message:String(error);
    $("activityList").innerHTML='<div class="activity-empty">Control API is unavailable.</div>';
    $("lastUpdated").textContent="Refresh failed";
  }finally{
    $("refreshButton").classList.remove("refreshing");
  }
}

$("refreshButton").addEventListener("click",load);
$("emptyRefreshButton").addEventListener("click",load);
load();
