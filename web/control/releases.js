const $ = (id) => document.getElementById(id);

function esc(value){return String(value??"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#039;")}
function short(value,left=14,right=8){const text=String(value??"—");return text.length<=left+right+1?text:`${text.slice(0,left)}…${text.slice(-right)}`}
function date(value){const d=new Date(value);return Number.isNaN(d.getTime())?String(value??"—"):new Intl.DateTimeFormat("en-GB",{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false,timeZone:"UTC"}).format(d).replace(",","")+" UTC"}
function stateClass(value){return String(value).toLowerCase().replaceAll("-","_")}
function field(label,value){return `<div class="release-field"><span>${esc(label)}</span><code title="${esc(value)}">${esc(short(value,20,12))}</code></div>`}
function light(value){const v=String(value||"RED").toUpperCase();return v==="GREEN"||v==="AMBER"?v:"RED"}
function routeLight(health){const h=String(health||"").toUpperCase();if(h==="HEALTHY")return"GREEN";if(h==="RATE_LIMITED"||h==="DEGRADED")return"AMBER";return"RED"}
function healthCopy(health){const h=String(health||"UNKNOWN").toUpperCase();if(h==="HEALTHY")return"LIVE";if(h==="RATE_LIMITED")return"QUOTA";if(h==="AUTH_REQUIRED")return"AUTH";if(h==="UNAVAILABLE")return"OFFLINE";return h}

let latestReadiness=null;

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
    field("CANDIDATE SHA",current.candidateSha),field("ARTIFACT FP",current.artifactFp),field("RELEASE POLICY FP",current.releasePolicyFp),
    field("APPROVAL FP",current.approvalFp),field("SIGNED MANIFEST FP",current.releaseManifestFp),field("CHANGED",date(current.changedAt))
  ].join("");
}

function row(r){return `<tr class="${r.isCurrentProduction?"current-row":""}"><td><code title="${esc(r.releaseSha)}">${esc(short(r.releaseSha))}</code></td><td><span class="release-state ${stateClass(r.state)}">${esc(r.state)}</span></td><td>${esc(r.channel)}</td><td><code title="${esc(r.candidateSha)}">${esc(short(r.candidateSha))}</code></td><td><code title="${esc(r.artifactFp)}">${esc(short(r.artifactFp))}</code></td><td>${esc(date(r.changedAt))}</td><td class="${r.manifestIntegrity==="PASS"?"integrity-pass":"integrity-fail"}">${r.manifestIntegrity==="PASS"?"✓ PASS":"× FAIL"}</td></tr>`}

function renderChain(releases){const withPrevious=releases.filter(r=>r.previousProductionSha);if(!withPrevious.length){$("rollbackChain").innerHTML='<span class="activity-empty">No rollback links persisted.</span>';return}$("rollbackChain").innerHTML=withPrevious.slice(0,6).map(r=>`<span class="chain-node" title="${esc(r.previousProductionSha)}">${esc(short(r.previousProductionSha,8,6))}</span><span class="chain-arrow">→</span><span class="chain-node" title="${esc(r.releaseSha)}">${esc(short(r.releaseSha,8,6))}</span>`).join("")}
function activityIcon(state){const normalized=String(state??"").toUpperCase();if(normalized==="PRODUCTION")return"●";if(normalized==="CANARY")return"▷";if(normalized==="ROLLED_BACK")return"↶";return"◇"}
function renderActivity(releases){if(!releases.length){$("activityList").innerHTML='<div class="activity-empty">No persisted release activity yet.</div>';return}const sorted=[...releases].sort((a,b)=>new Date(b.changedAt).getTime()-new Date(a.changedAt).getTime()).slice(0,5);$("activityList").innerHTML=sorted.map(r=>`<div class="activity-item"><span class="activity-icon">${activityIcon(r.state)}</span><div class="activity-copy"><strong>${esc(r.state)} · ${esc(short(r.releaseSha,10,6))}</strong><small>${esc(r.channel)} · integrity ${esc(r.manifestIntegrity)}</small></div><span class="activity-time">${esc(date(r.changedAt))}</span></div>`).join("")}

function renderRelease(payload){
  $("countTotal").textContent=payload.counts.total;$("countCanary").textContent=payload.counts.canary;$("countProduction").textContent=payload.counts.production;$("countRolledBack").textContent=payload.counts.rolledBack;
  renderProduction(payload.currentProduction);$("releaseRows").innerHTML=payload.releases.map(row).join("");$("loadingState").classList.add("hidden");$("emptyState").classList.toggle("hidden",payload.releases.length!==0);
  $("lastUpdated").textContent=`Updated ${new Intl.DateTimeFormat("en-GB",{hour:"2-digit",minute:"2-digit",second:"2-digit",hour12:false}).format(new Date())}`;renderActivity(payload.releases);renderChain(payload.releases)
}

function routeCard(route){
  const l=routeLight(route.health);const model=route.model&&route.model!=="-"?route.model:"no live model";
  return `<article class="route-card ${l.toLowerCase()}"><div class="route-title"><span class="lamp ${l.toLowerCase()}"></span><strong>${esc(route.label||route.family)}</strong><b>${esc(healthCopy(route.health))}</b></div><code>${esc(model)}</code><p>${esc(route.detail||"")}</p><small>${esc(route.connectAction||"")}</small></article>`
}
function renderRoutes(fabric){const routes=Array.isArray(fabric?.omniRoutes)?fabric.omniRoutes:[];$("routeMatrix").innerHTML=routes.length?routes.map(routeCard).join(""):'<div class="readiness-loading">No OmniRoute routes reported.</div>';return routes}

function derivedReadiness(health,routes){
  const healthy=routes.filter(r=>String(r.health).toUpperCase()==="HEALTHY");
  const connected=routes.filter(r=>r.model&&r.model!=="-"&&String(r.health).toUpperCase()!=="UNAVAILABLE");
  const primary=health?.chatDefaultModel||healthy[0]?.model||null;
  const primaryRoute=routes.find(r=>r.model===primary)||healthy[0]||routes.find(r=>["RATE_LIMITED","DEGRADED"].includes(String(r.health).toUpperCase()))||null;
  const ai=routeLight(primaryRoute?.health);
  const stages=[
    {id:"harmonia",order:1,label:"Harmonia · poznawanie",phase:"POZNAWANIE",light:ai,aiRequired:true,agent:"harmonia",worker:"in-process cognition",model:primary,detail:primaryRoute?`AI ${primaryRoute.health}: ${primaryRoute.model}`:"No executable AI route",blocking:true,action:ai==="GREEN"?null:"Restore a healthy AI route"},
    {id:"brain",order:2,label:"Mózg · plan i mapa",phase:"MYSLENIE",light:ai,aiRequired:true,agent:"brain",worker:"in-process roadmap writer",model:primary,detail:primaryRoute?`Planning through ${primaryRoute.model}`:"No planning route",blocking:true,action:ai==="GREEN"?null:"Restore planning route"},
    {id:"research",order:3,label:"Researcher · Hermes",phase:"RESEARCH",light:ai==="RED"?"RED":"AMBER",aiRequired:true,agent:"research",worker:"hermes",model:primary,detail:"Worker bridge exists; executable readiness needs server probe",blocking:true,action:"Check Hermes executable / terminal grant"},
    {id:"design",order:4,label:"Projektowanie · innovation",phase:"PROJEKTOWANIE",light:ai,aiRequired:true,agent:"planner",worker:"Koordynator route policy",model:primary,detail:"Design reasoning follows live AI health",blocking:true,action:ai==="GREEN"?null:"Restore reasoning route"},
    {id:"build",order:5,label:"Builder · OpenCode",phase:"TWORZENIE",light:ai==="RED"?"RED":"AMBER",aiRequired:true,agent:"code",worker:"opencode",model:primary,detail:"Worker bridge exists; executable readiness needs server probe",blocking:true,action:"Check OpenCode executable"},
    {id:"browser",order:6,label:"Frontend verify · Playwright",phase:"WERYFIKACJA",light:"AMBER",aiRequired:false,agent:"browser",worker:"playwright",model:null,detail:"Worker bridge exists; runtime binary not confirmed by fallback dashboard",blocking:true,action:"Check Playwright runtime"},
    {id:"audit",order:7,label:"Security / independent audit",phase:"WERYFIKACJA",light:"RED",aiRequired:false,agent:"audit",worker:"audit",model:null,detail:"Registry role exists but process bridge is not implemented",blocking:false,action:"Implement audit worker bridge"},
    {id:"deploy",order:8,label:"Release / deploy",phase:"GOTOWE",light:"RED",aiRequired:false,agent:"deploy",worker:"deploy",model:null,detail:"Registry role exists but process bridge is not implemented",blocking:false,action:"Implement deploy worker bridge"}
  ];
  const canMaterialise=false;
  const fullPipelineReady=false;
  const green=stages.filter(s=>s.light==="GREEN").length,amber=stages.filter(s=>s.light==="AMBER").length;
  return{overall:"RED",canMaterialise,fullPipelineReady,score:Math.round(((green+amber*.5)/stages.length)*100),creativePhase:stages.find(s=>s.light!=="GREEN")?.phase||"GOTOWE",creativeProgress:green/stages.length*100,primaryModel:primary,fallbackModels:health?.chatFallbackModels||[],healthyAiRoutes:healthy.length,connectedAiRoutes:connected.length,terminalGrant:false,stages,checkedAt:new Date().toISOString(),derived:true}
}

function stageCard(stage){
  const l=light(stage.light);const model=stage.model?`<code>${esc(stage.model)}</code>:"";const action=stage.action?`<small class="stage-action">${esc(stage.action)}</small>`:"";
  return `<article class="agent-stage ${l.toLowerCase()}"><div class="stage-top"><span class="stage-order">${String(stage.order).padStart(2,"0")}</span><span class="lamp ${l.toLowerCase()}"></span><strong>${esc(stage.label)}</strong><b>${l}</b></div><div class="stage-meta"><span>${esc(stage.agent)}</span><span>→</span><span>${esc(stage.worker)}</span>${stage.aiRequired?'<span class="ai-needed">AI</span>':''}</div>${model}<p>${esc(stage.detail||"")}</p>${action}</article>`
}

function activeCreativeProcess(payload){
  const tasks=Array.isArray(payload?.tasks)?payload.tasks:[];
  const building=tasks.find(task=>String(task.state).toUpperCase()==="BUILDING");
  if(building)return{phase:"TWORZENIE",progress:68,taskId:building.taskId,state:"BUILDING"};
  const validating=tasks.find(task=>String(task.state).toUpperCase()==="VALIDATING");
  if(validating)return{phase:"WERYFIKACJA",progress:84,taskId:validating.taskId,state:"VALIDATING"};
  return null;
}

function renderCreative(readiness,process){
  const spectrum=$("creativeSpectrum");
  const glow=spectrum?.querySelector(".creative-glow");
  if(process){
    if(glow)glow.hidden=false;
    $("creativeState").textContent=`RUNNING · ${process.phase} · ${short(process.taskId,14,6)}`;
    $("creativeState").title=`${process.taskId} · ${process.state}`;
    spectrum.style.setProperty("--creative-progress",`${process.progress}%`);
    spectrum.dataset.active="true";
    spectrum.dataset.state="running";
    return;
  }
  if(glow)glow.hidden=true;
  const overall=light(readiness?.overall);
  const phase=readiness?.creativePhase||"POZNAWANIE";
  $("creativeState").textContent=`IDLE · readiness ${phase}`;
  $("creativeState").title="No BUILDING or VALIDATING task is active. Readiness remains visible in the gate cards below.";
  spectrum.style.setProperty("--creative-progress",`${Math.max(0,Math.min(100,Number(readiness?.creativeProgress)||0))}%`);
  spectrum.dataset.active="false";
  spectrum.dataset.state=overall.toLowerCase();
}

function renderReadiness(readiness,process=null){
  latestReadiness=readiness;
  $("materialiseNow").textContent=readiness.canMaterialise?"READY":"BLOCKED";$("materialiseNow").dataset.light=readiness.canMaterialise?"GREEN":"RED";$("materialiseHint").textContent=readiness.canMaterialise?"Core materialisation gates are executable now":readiness.derived?"Dedicated readiness probe unavailable: failing closed":"At least one blocking gate is not green";
  $("pipelineReady").textContent=readiness.fullPipelineReady?"READY":"INCOMPLETE";$("pipelineReady").dataset.light=readiness.fullPipelineReady?"GREEN":"AMBER";$("pipelineHint").textContent=readiness.fullPipelineReady?"All stages executable":"Audit/release or another stage still requires work";
  $("healthyRoutes").textContent=String(readiness.healthyAiRoutes??0);$("connectedRoutes").textContent=`${readiness.connectedAiRoutes??0} connected routes`;
  $("readinessScore").textContent=`${Math.max(0,Math.min(100,Math.round(Number(readiness.score)||0)))}%`;$("readinessPhase").textContent=readiness.creativePhase||"POZNAWANIE";
  renderCreative(readiness,process);
  $("agentReadinessGrid").innerHTML=Array.isArray(readiness.stages)&&readiness.stages.length?readiness.stages.map(stageCard).join(""):'<div class="readiness-loading">No readiness stages reported.</div>'
}

async function getJson(path){const r=await fetch(path,{headers:{accept:"application/json"},cache:"no-store"});if(!r.ok)throw Object.assign(new Error(`${path} HTTP ${r.status}`),{status:r.status});return r.json()}

async function refreshActiveProcess(){
  if(!latestReadiness)return;
  try{const tasks=await getJson("/api/tasks?status=all");renderCreative(latestReadiness,activeCreativeProcess(tasks))}catch{/* keep the last honest visual state */}
}

async function load(){
  $("refreshButton").classList.add("refreshing");
  try{
    const [health,releases,fabric,tasks]=await Promise.all([getJson("/api/health"),getJson("/api/releases"),getJson("/api/providers?refresh=1"),getJson("/api/tasks?status=all")]);
    renderHealth(health);renderRelease(releases);const routes=renderRoutes(fabric);
    let readiness;try{readiness=await getJson("/api/readiness/materialisation?refresh=1")}catch(error){readiness=derivedReadiness(health,routes)}
    renderReadiness(readiness,activeCreativeProcess(tasks));
  }catch(error){
    $("loadingState").classList.add("hidden");$("emptyState").classList.remove("hidden");$("emptyState").querySelector("strong").textContent="Control readiness unavailable";$("emptyState").querySelector(":scope > span").textContent=error instanceof Error?error.message:String(error);$("activityList").innerHTML='<div class="activity-empty">Control API is unavailable.</div>';$("routeMatrix").innerHTML='<div class="readiness-loading">Route fabric unavailable.</div>';$("agentReadinessGrid").innerHTML='<div class="readiness-loading">Readiness fabric unavailable.</div>';$("lastUpdated").textContent="Refresh failed"
  }finally{$("refreshButton").classList.remove("refreshing")}
}

$("refreshButton").addEventListener("click",load);$("emptyRefreshButton").addEventListener("click",load);load();
setInterval(()=>void refreshActiveProcess(),2000);
