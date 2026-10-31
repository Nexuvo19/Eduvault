/* ===================================================================
   EduVault — SCRIPTS.JS
   Vanilla JS: local course data, rendering, interactions, quizzes,
               role switching, persistence, modal, toasts.
   =================================================================== */
(async function(){
  "use strict";

  /* ---------------- Utilities ---------------- */
  const $  = (sel,ctx=document)=>ctx.querySelector(sel);
  const $$ = (sel,ctx=document)=>Array.from(ctx.querySelectorAll(sel));
  const el = (tag,attrs={},html="")=>{const e=document.createElement(tag);for(const k in attrs){if(k==="class")e.className=attrs[k];else if(k==="dataset")Object.assign(e.dataset,attrs[k]);else e.setAttribute(k,attrs[k]);}if(html)e.innerHTML=html;return e;};
  const esc = (s)=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const fmtDate = (d)=>new Date(d).toLocaleDateString("en-IN",{day:"2-digit",month:"short",year:"numeric"});
  const uid = ()=>Math.random().toString(36).slice(2,9);
  const documentAccept=".pdf,.doc,.docx,.odt,.rtf,.txt,.md,.html,.htm,.csv,.xls,.xlsx,.ods,.ppt,.pptx,.odp,.png,.jpg,.jpeg,.gif,.bmp,.tif,.tiff,.webp";
  const documentPdfUrl=id=>"/api/documents/"+encodeURIComponent(id)+"/pdf";
  const documentOriginalUrl=id=>"/api/documents/"+encodeURIComponent(id)+"/original";
  async function apiUploadDocument(file){
    const body=new FormData();body.append("file",file);
    let response;
    try{response=await fetch("/api/documents",{method:"POST",body});}
    catch(error){console.error("Unable to reach the EduVault Flask file service.",error);throw new Error("The Flask service is unavailable. Start EduVault with python3 app.py before uploading.");}
    let result;
    try{result=await response.json();}
    catch(error){console.error("The Flask file service returned an invalid response.",error);throw new Error("The file service returned an unreadable response.");}
    if(!response.ok)throw new Error(result.error||"The file could not be uploaded.");
    return result;
  }
  function renderFacultyTests(){
    const body=$("#facultyTestBody");
    body.innerHTML="";
    tests.forEach(test=>{
      const row=el("tr");
      row.innerHTML='<td>'+esc(test.title)+'</td><td>'+esc(subjectName(test.subject))+'</td><td>'+test.questions.length+'</td><td><div class="table-actions"><button class="icon-btn" data-test-edit="'+esc(test.id)+'" aria-label="Edit '+esc(test.title)+'">Edit</button><button class="icon-btn" data-test-delete="'+esc(test.id)+'" aria-label="Delete '+esc(test.title)+'">Delete</button></div></td>';
      body.appendChild(row);
    });
  }
  async function apiDeleteDocument(id){
    let response;
    try{response=await fetch("/api/documents/"+encodeURIComponent(id),{method:"DELETE"});}
    catch(error){console.error("Unable to reach the EduVault Flask file service.",error);throw new Error("The Flask service is unavailable, so the attached file was not removed.");}
    if(response.status===204)return;
    let result;
    try{result=await response.json();}
    catch(error){console.error("The Flask file service returned an invalid response.",error);throw new Error("The file service returned an unreadable response.");}
    throw new Error(result.error||"The attached file could not be removed.");
  }
  async function saveResources(updatedResources){
    const response=await fetch("/api/admin/resources",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(updatedResources)
    });
    let result={};
    try{result=await response.json();}catch(error){
      console.error("The resource service returned an invalid response.",error);
      throw new Error("The resource service returned an unreadable response.");
    }
    if(!response.ok)throw new Error(result.error||"The database could not save these resources.");
    resources=updatedResources;
    serverStoreData.resources=updatedResources;
    try{localStorage.setItem("eduvault_resources",JSON.stringify(updatedResources));}
    catch(error){console.warn("EduVault could not update the browser cache.",error);}
  }
  function bindActivation(element,callback){
    element.setAttribute("role","button");
    element.tabIndex=0;
    element.addEventListener("click",callback);
    element.addEventListener("keydown",event=>{
      if(event.key==="Enter"||event.key===" "){
        event.preventDefault();
        callback(event);
      }
    });
  }

  // Load authenticated account data and the shared academic catalogue from MySQL.
  let bootstrap;
  try{
    const response=await fetch("/api/bootstrap",{credentials:"same-origin"});
    if(response.status===401){window.location.replace("index.html");return;}
    if(!response.ok)throw new Error("EduVault could not load the database workspace.");
    bootstrap=await response.json();
  }catch(error){
    console.error("EduVault startup failed.",error);
    document.body.innerHTML='<main style="max-width:620px;margin:12vh auto;padding:24px;font:16px system-ui;color:#20263a"><h1>EduVault could not connect</h1><p>Start the Flask server and check the MySQL settings in your .env file, then reload this page.</p><p style="color:#667085">'+String(error.message||error).replace(/[&<>]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;"}[c]))+'</p><a href="index.html">Return to sign in</a></main>';
    return;
  }
  const session={role:bootstrap.user.role,identifier:bootstrap.user.identifier,fullName:bootstrap.user.fullName};
  const serverStoreData={...bootstrap.userData,resources:bootstrap.resources,tests:bootstrap.tests,assignments:bootstrap.assignments,announcements:bootstrap.announcements};
  const pendingWrites=new Map();
  const remoteCollections=new Set(["resources","tests","assignments","announcements"]);
  const Store = {
    get(key,fallback){
      return Object.prototype.hasOwnProperty.call(serverStoreData,key)?serverStoreData[key]:fallback;
    },
    set(key,val){
      serverStoreData[key]=val;
      try{localStorage.setItem("eduvault_"+key,JSON.stringify(val));}catch(e){console.warn("EduVault could not update the browser cache.",e);}
      const endpoint=remoteCollections.has(key)?"/api/admin/"+key:"/api/me/data/"+key;
      const payload=JSON.stringify(val);
      const previous=pendingWrites.get(key)||Promise.resolve();
      const write=previous.catch(()=>{}).then(async()=>{
        const response=await fetch(endpoint,{method:"PUT",credentials:"same-origin",headers:{"Content-Type":"application/json"},body:payload});
        if(!response.ok){let result={};try{result=await response.json();}catch(_){}throw new Error(result.error||"The database rejected this change.");}
      }).catch(error=>{
        console.error("EduVault database save failed for "+key,error);
        toast("Could not save changes to the database","error",error.message);
      });
      pendingWrites.set(key,write);
      return true;
    },
    remove(key){
      delete serverStoreData[key];
      try{localStorage.removeItem("eduvault_"+key);}catch(e){console.error("Unable to remove EduVault browser cache.",e);}
    },
    async clearAll(){
      await Promise.all([...pendingWrites.values()]);
      const response=await fetch("/api/me/data",{method:"DELETE",credentials:"same-origin"});
      if(!response.ok)throw new Error("Your saved preferences could not be cleared from the database.");
      Object.keys(serverStoreData).filter(key=>!remoteCollections.has(key)).forEach(key=>delete serverStoreData[key]);
      try{Object.keys(localStorage).filter(key=>key.startsWith("eduvault_")).forEach(key=>localStorage.removeItem(key));}catch(e){console.error("Unable to clear browser cache.",e);}
    }
  };

  /* ---------------- Workspace Data ---------------- */
  let subjects = bootstrap.subjects;
  const categories = ["Notes","Previous Papers","Model Papers","Laboratory Programs","Assignments","Reference Materials"];

  let resources = Store.get("resources", []);
  let assignments = Store.get("assignments", []);
  let announcements = Store.get("announcements", []);
  const quickAccess = [
    {label:"Notes",icon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5a2 2 0 012-2h7l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5z"/><path d="M13 3v5h5"/></svg>',color:"var(--indigo-400)",nav:"resources"},
    {label:"Previous Papers",icon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M6 3h9l5 5v13a1 1 0 01-1 1H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M14 3v6h6"/></svg>',color:"#e2574b",nav:"papers"},
    {label:"Model Papers",icon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 7h8M8 11h8M8 15h5"/></svg>',color:"var(--violet-500)",nav:"resources"},
    {label:"Lab Programs",icon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 3h6M10 3v6l-5 9a2 2 0 002 3h10a2 2 0 002-3l-5-9V3"/></svg>',color:"var(--success)",nav:"labs"},
    {label:"Assignments",icon:'<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 5h6M5 2h14v20l-7-4-7 4V2z"/></svg>',color:"var(--warning)",nav:"assignments"}
  ];

  /* ---- Database-backed practice tests ---- */
  let tests = Store.get("tests", []);

  const progressData = {testHistory:Store.get("testHistory",[])};

  /* ---------------- State ---------------- */
  let state = {
    role:session.role,
    currentView:session.role==="faculty"?"faculty":"overview",
    resourceLayout:Store.get("defaultView","grid"),
    bookmarks:Store.get("bookmarks",[]),
    asgStatuses:Store.get("asgStatuses",{}),
    annRead:Store.get("annRead",[]),
    notifRead:Store.get("notifRead",false),
    chat:Store.get("chat",[]),
    quiz:{active:false,test:null,answers:[],current:0,timer:null,remaining:0,submitted:false},
    preferences:Store.get("prefs",{compact:false,reducedMotion:false,defaultView:"grid"})
  };
  const accountLabel=(session.fullName||session.identifier).trim();
  const accountInitials=accountLabel.split(/[\s._@-]+/).filter(Boolean).slice(0,2).map(part=>part.charAt(0).toUpperCase()).join("")||"EV";

  /* ---------------- Toast ---------------- */
  function toast(message,type="info",subtitle){
    const stack=$("#toastStack");
    const icons={success:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12l5 5L20 7"/></svg>',warning:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 9v4M12 17h.01M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z"/></svg>',error:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>',info:'<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><path d="M12 8v4M12 16h.01"/></svg>'};
    const t=el("div",{class:"toast "+type});
    t.innerHTML='<span class="toast-ic">'+(icons[type]||icons.info)+'</span><div class="toast-body"><p>'+esc(message)+'</p>'+(subtitle?'<span>'+esc(subtitle)+'</span>':'')+'</div><button class="toast-close" aria-label="Dismiss">&times;</button>';
    stack.appendChild(t);
    const close=()=>{t.classList.add("out");setTimeout(()=>t.remove(),300);};
    t.querySelector(".toast-close").addEventListener("click",close);
    setTimeout(close,4000);
  }

  /* ---------------- Modal ---------------- */
  function modal(title,bodyHtml,footHtml){
    const m=$("#modal");
    $("#modalTitle").textContent=title;
    $("#modalBody").innerHTML=bodyHtml;
    $("#modalFoot").innerHTML=footHtml||"";
    m.hidden=false;
    document.body.style.overflow="hidden";
  }
  function closeModal(){
    $("#modal").hidden=true;
    $("#modalBody").innerHTML="";
    $("#modalFoot").innerHTML="";
    document.body.style.overflow="";
  }
  function confirmModal(title,message,onConfirm,confirmText="Confirm",danger=false){
    modal(title,"<p style='color:var(--ink-600)'>"+esc(message)+"</p>",
      "<button class='btn ghost' data-close>Cancel</button><button class='btn "+(danger?"danger-ghost":"primary")+"' data-confirm>"+esc(confirmText)+"</button>");
    $("[data-confirm]",$("#modalFoot")).addEventListener("click",()=>{closeModal();onConfirm();});
    $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
  }
  $("#modalClose").addEventListener("click",closeModal);
  $("#modalBackdrop").addEventListener("click",closeModal);
  document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!$("#modal").hidden)closeModal();});

  /* ---------------- Navigation ---------------- */
  const navMeta={
    overview:{title:"Overview",crumb:"Home / Overview"},
    resources:{title:"Study Resources",crumb:"Home / Study Resources"},
    papers:{title:"Previous Question Papers",crumb:"Home / Previous Papers"},
    labs:{title:"Laboratory Programs",crumb:"Home / Laboratory Programs"},
    assignments:{title:"Assignments",crumb:"Home / Assignments"},
    assistant:{title:"Study Assistant",crumb:"Home / Study Assistant"},
    tests:{title:"Practice Tests",crumb:"Home / Practice Tests"},
    progress:{title:"My Progress",crumb:"Home / My Progress"},
    announcements:{title:"Announcements",crumb:"Home / Announcements"},
    faculty:{title:"Faculty Console",crumb:"Home / Faculty Console"},
    help:{title:"Help & Support",crumb:"Home / Help & Support"},
    settings:{title:"Settings",crumb:"Home / Settings"}
  };

  function navigate(view){
    if(!navMeta[view])return;
    const allowedViews=state.role==="faculty"
      ?["faculty","announcements","help","settings"]
      :Object.keys(navMeta).filter(name=>name!=="faculty");
    if(!allowedViews.includes(view)){
      toast("That section is not available in this workspace.","warning");
      return;
    }
    state.currentView=view;
    $$(".nav-item").forEach(b=>b.classList.toggle("active",b.dataset.nav===view));
    $$(".view").forEach(s=>{s.hidden=s.id!=="view-"+view;s.classList.toggle("active",s.id==="view-"+view);});
    $("#pageTitle").textContent=navMeta[view].title;
    $("#pageBreadcrumb").textContent=navMeta[view].crumb;
    closeSidebar();
    window.scrollTo(0,0);
    if(view==="assistant")renderChat();
    if(view==="overview")renderOverview();
    if(view==="faculty")renderFacultyResources();
    if(view==="progress")renderProgress();
    if(view==="tests")renderTests();
    if(view==="announcements")renderAnnouncements();
  }

  $$(".nav-item").forEach(btn=>btn.addEventListener("click",()=>navigate(btn.dataset.nav)));
  $$("[data-nav]").forEach(b=>{if(b.classList.contains("nav-item"))return;b.addEventListener("click",e=>{e.preventDefault();navigate(b.dataset.nav);});});

  /* ---------------- Sidebar mobile ---------------- */
  function openSidebar(){$("#sidebar").classList.add("open");$("#sidebarBackdrop").hidden=false;$("#menuToggle").setAttribute("aria-expanded","true");}
  function closeSidebar(){$("#sidebar").classList.remove("open");$("#sidebarBackdrop").hidden=true;$("#menuToggle").setAttribute("aria-expanded","false");}
  $("#menuToggle").addEventListener("click",openSidebar);
  $("#sidebarClose").addEventListener("click",closeSidebar);
  $("#sidebarBackdrop").addEventListener("click",closeSidebar);

  /* ---------------- Overview ---------------- */
  function renderOverview(){
    const greetEl=$("#heroGreet");
    const hr=new Date().getHours();
    greetEl.textContent=(hr<12?"Good morning":hr<17?"Good afternoon":"Good evening")+", "+accountLabel;
    const now=new Date();
    const upcoming=assignments.filter(assignment=>{
      const status=state.asgStatuses[assignment.id]||assignment.status;
      return status!=="Completed"&&new Date(assignment.due)>=new Date(now.getFullYear(),now.getMonth(),now.getDate());
    }).length;
    const average=progressData.testHistory.length
      ?Math.round(progressData.testHistory.reduce((total,test)=>total+test.score,0)/progressData.testHistory.length)
      :null;
    $("#overviewResourceCount").textContent=resources.length;
    $("#overviewAssignmentCount").textContent=upcoming;
    $("#overviewTestCount").textContent=progressData.testHistory.length;
    $("#overviewAverageScore").textContent=average===null?"—":average+"%";

    const cl=$("#continueList");
    cl.innerHTML="";
    const savedResources=resources.filter(resource=>state.bookmarks.some(id=>String(id)===String(resource.id))).slice(0,4);
    if(!savedResources.length)cl.innerHTML='<p class="asg-empty">Bookmark a resource to keep it here.</p>';
    savedResources.forEach(resource=>{
      const item=el("div",{class:"continue-item",role:"button",tabindex:"0"});
      item.innerHTML='<span class="continue-thumb">'+esc(resource.title.charAt(0))+'</span><div class="continue-meta"><p>'+esc(resource.title)+'</p><p class="muted">'+esc(subjectName(resource.subject))+'</p></div>';
      bindActivation(item,()=>navigate("resources"));
      cl.appendChild(item);
    });

    const qa=$("#quickAccess");
    qa.innerHTML="";
    quickAccess.forEach(q=>{
      const b=el("button",{class:"quick-card"});
      b.innerHTML='<span class="quick-ic" style="background:'+q.color+'22;color:'+q.color+'">'+q.icon+'</span><span>'+esc(q.label)+'</span>';
      b.addEventListener("click",()=>navigate(q.nav));
      qa.appendChild(b);
    });

    const dl=$("#deadlineList");
    dl.innerHTML="";
    assignments.slice(0,4).forEach(a=>{
      const st=state.asgStatuses[a.id]||a.status;
      const overdue=st!=="Completed"&&new Date(a.due)<new Date();
      const item=el("div",{class:"row-item"});
      item.innerHTML='<div class="row-ic" style="background:'+(overdue?"var(--error-bg)":"var(--warning-bg)")+';color:'+(overdue?"var(--error)":"var(--warning)")+'"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></div><div class="row-main"><p class="t">'+esc(a.title)+'</p><p class="muted">'+esc(subjectName(a.subject))+' · Due '+fmtDate(a.due)+'</p></div><span class="row-tag '+(overdue?"tag-overdue":"tag-"+st.toLowerCase())+'">'+(overdue?"Overdue":st)+'</span>';
      bindActivation(item,()=>navigate("assignments"));
      dl.appendChild(item);
    });

    const ra=$("#recentAnnouncements");
    ra.innerHTML="";
    announcements.slice(0,3).forEach(a=>{
      const item=el("div",{class:"row-item"});
      item.innerHTML='<div class="row-ic" style="background:'+(a.priority==="Important"?"var(--error-bg)":"var(--indigo-400)")+'22;color:'+(a.priority==="Important"?"var(--error)":"var(--indigo-600)")+'"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l6-7v16l-6-7v-2zM14 8a5 5 0 010 8"/></svg></div><div class="row-main"><p class="t">'+esc(a.title)+'</p><p class="muted">'+esc(a.dept)+' · '+fmtDate(a.date)+'</p></div>'+(a.priority==="Important"?'<span class="row-tag tag-important">Important</span>':"");
      bindActivation(item,()=>navigate("announcements"));
      ra.appendChild(item);
    });

    const rec=$("#recommendedList");
    rec.innerHTML="";
    const recs=resources.filter(r=>r.category==="Notes"||r.category==="Reference Materials").slice(0,4);
    recs.forEach(r=>{
      const item=el("div",{class:"row-item"});
      item.innerHTML=resourceRowHtml(r);
      item.addEventListener("click",event=>{
        const view=event.target.closest("[data-view]");
        const download=event.target.closest("[data-dl]");
        const bookmark=event.target.closest("[data-bm]");
        if(view)openResourcePreview(r);
        else if(download)downloadResource(r);
        else if(bookmark)toggleBookmark(r.id,bookmark);
      });
      rec.appendChild(item);
    });

    const act=$("#recentActivity");
    act.innerHTML='<p class="asg-empty">Your recent activity will appear here.</p>';
  }

  /* ---------------- Resources ---------------- */
  function subjectName(id){return (subjects.find(s=>s.id===id)||{}).name||"—";}

  function resourceRowHtml(r){
    return '<div class="res-top">'+(r.fileId&&r.fileContentType&&r.fileContentType.startsWith("image/")?'<img class="resource-preview-img" src="'+esc(documentOriginalUrl(r.fileId))+'" alt="Preview of '+esc(r.fileName||r.title)+'" />':'')+'<div class="res-icon fmt-'+r.format+'">'+esc(r.format)+'</div><div><p class="res-title">'+esc(r.title)+'</p><p class="res-sub">'+esc(subjectName(r.subject))+'</p></div></div>'+
      '<div class="res-meta"><span>'+esc(r.category)+'</span><span>Sem '+r.sem.replace("sem","")+'</span><span>'+esc(r.format)+'</span><span>'+fmtDate(r.date)+'</span></div>'+
      '<div class="res-actions"><button class="icon-btn" data-view="'+r.id+'" aria-label="View"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg></button>'+
      '<button class="icon-btn" data-dl="'+esc(r.id)+'" aria-label="'+(r.fileId?"Download":"No file attached")+'" '+(r.fileId?"":"disabled")+'><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/></svg></button>'+
      '<button class="icon-btn bookmark-btn '+(state.bookmarks.includes(r.id)?"active":"")+'" data-bm="'+r.id+'" aria-label="Bookmark"><svg viewBox="0 0 24 24" width="18" height="18" fill="'+(state.bookmarks.includes(r.id)?"currentColor":"none")+'" stroke="currentColor" stroke-width="1.8"><path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/></svg></button></div>';
  }

  function renderResources(filterFn,container){
    const list=resources.filter(filterFn);
    container.innerHTML="";
    if(!list.length){
      const msg=el("div",{class:"empty-state"});
      msg.innerHTML='<div class="empty-ill"><svg viewBox="0 0 64 64" width="72" height="72" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="10" y="14" width="44" height="36" rx="4"/><path d="M10 22h44M18 32h20M18 40h14"/></svg></div><h3>No resources found</h3><p>Nothing here yet. Check back later.</p>';
      container.appendChild(msg);
      return;
    }
    list.forEach(r=>{
      const card=el("div",{class:"res-card"});
      card.innerHTML=resourceRowHtml(r);
      card.addEventListener("click",e=>{
        const v=e.target.closest("[data-view]"),d=e.target.closest("[data-dl]"),b=e.target.closest("[data-bm]");
        if(v)openResourcePreview(r);
        else if(d)downloadResource(r);
        else if(b)toggleBookmark(r.id,b);
      });
      container.appendChild(card);
    });
  }

  function renderAllResources(){
    const container=$("#resourceContainer");
    container.className="resource-container"+(state.resourceLayout==="list"?" list-view":"");
    const f=getResourceFilters();
    const list=resources.filter(r=>{
      if(f.branch&&r.branch!==f.branch)return false;
      if(f.year&&r.year!==f.year)return false;
      if(f.sem&&r.sem!==f.sem)return false;
      if(f.subject&&r.subject!==f.subject)return false;
      if(f.category&&r.category!==f.category)return false;
      if(f.search){const s=f.search.toLowerCase();if(!r.title.toLowerCase().includes(s)&&!subjectName(r.subject).toLowerCase().includes(s))return false;}
      return true;
    });
    container.innerHTML="";
    if(!list.length){
      $("#resEmpty").hidden=false;$("#resCount").textContent="0 resources";
      return;
    }
    $("#resEmpty").hidden=true;
    $("#resCount").textContent=list.length+" resource"+(list.length>1?"s":"");
    list.forEach(r=>{
      const card=el("div",{class:"res-card"});
      card.innerHTML=resourceRowHtml(r);
      card.addEventListener("click",e=>{
        const v=e.target.closest("[data-view]"),d=e.target.closest("[data-dl]"),b=e.target.closest("[data-bm]");
        if(v)openResourcePreview(r);
        else if(d)downloadResource(r);
        else if(b)toggleBookmark(r.id,b);
      });
      container.appendChild(card);
    });
  }

  function getResourceFilters(){
    return {branch:$("#fBranch").value,year:$("#fYear").value,sem:$("#fSem").value,subject:$("#fSubject").value,category:$("#fCategory").value,search:$("#fSearch").value.trim()};
  }

  function populateFilters(){
    const selected={branch:$("#fBranch").value,year:$("#fYear").value,sem:$("#fSem").value,subject:$("#fSubject").value,category:$("#fCategory").value,topSemester:$("#semesterSelect").value};
    const unique=(items)=>[...new Set(items.filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b)));
    const branches=unique(subjects.map(subject=>subject.branch).concat(resources.map(resource=>resource.branch)));
    const years=unique(subjects.map(subject=>subject.year).concat(resources.map(resource=>resource.year)));
    const semesters=unique(subjects.map(subject=>subject.sem).concat(resources.map(resource=>resource.sem)));
    const categoryValues=unique(categories.concat(resources.map(resource=>resource.category)));
    function fill(select,values,label){
      select.replaceChildren(el("option",{value:""},label));
      values.forEach(value=>{
        const option=el("option",{value});
        option.textContent=label==="All semesters"?"Semester "+String(value).replace(/^sem/i,""):value;
        select.appendChild(option);
      });
    }
    fill($("#fBranch"),branches,"All branches");
    fill($("#fYear"),years.map(String),"All years");
    fill($("#fSem"),semesters,"All semesters");
    fill($("#semesterSelect"),semesters,"All semesters");
    fill($("#fSubject"),subjects.map(subject=>subject.id),"All subjects");
    subjects.forEach(subject=>{
      const option=Array.from($("#fSubject").options).find(item=>item.value===subject.id);
      if(option)option.textContent=subject.name;
    });
    fill($("#fCategory"),categoryValues,"All categories");
    for(const [key,selector] of [["branch","#fBranch"],["year","#fYear"],["sem","#fSem"],["subject","#fSubject"],["category","#fCategory"],["topSemester","#semesterSelect"]]){
      if(Array.from($(selector).options).some(option=>option.value===selected[key]))$(selector).value=selected[key];
    }
  }

  function populateSubjectSelectors(){
    [$("#addResSubject"),$("#addAssignmentSubject"),$("#testSubject")].forEach(select=>{
      const selected=select.value;
      select.replaceChildren();
      subjects.forEach(subject=>{
        const option=el("option",{value:subject.id});
        option.textContent=subject.name+" · "+subject.code;
        select.appendChild(option);
      });
      if(subjects.some(subject=>subject.id===selected))select.value=selected;
    });
    const assistantSubject=$("#assistantSubject");
    const selected=assistantSubject.value;
    assistantSubject.replaceChildren(el("option",{value:""}));
    assistantSubject.options[0].textContent="All subjects";
    subjects.forEach(subject=>{
      const option=el("option",{value:subject.id});
      option.textContent=subject.name+" · "+subject.code;
      assistantSubject.appendChild(option);
    });
    if(subjects.some(subject=>subject.id===selected))assistantSubject.value=selected;
  }

  async function saveSubjects(updatedSubjects){
    const response=await fetch("/api/admin/subjects",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(updatedSubjects)
    });
    let result={};
    try{result=await response.json();}catch(error){
      console.error("The subject service returned an invalid response.",error);
      throw new Error("The subject service returned an unreadable response.");
    }
    if(!response.ok)throw new Error(result.error||"The database could not save these subjects.");
    subjects=updatedSubjects;
    populateFilters();
    populateSubjectSelectors();
    renderFacultyResources();
    renderAllResources();
    renderPapers();
    renderLabs();
  }

  async function saveTests(updatedTests){
    const response=await fetch("/api/admin/tests",{
      method:"PUT",credentials:"same-origin",
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify(updatedTests)
    });
    let result={};
    try{result=await response.json();}catch(error){
      console.error("The practice test service returned an invalid response.",error);
      throw new Error("The practice test service returned an unreadable response.");
    }
    if(!response.ok)throw new Error(result.error||"The database could not save these practice tests.");
    tests=updatedTests;
    serverStoreData.tests=updatedTests;
    renderTests();
    renderFacultyTests();
  }

  ["#fBranch","#fYear","#fSem","#fSubject","#fCategory"].forEach(selector=>$(selector).addEventListener("change",renderAllResources));
  $("#fSearch").addEventListener("input",renderAllResources);
  $("#fSem").addEventListener("change",()=>{
    $("#semesterSelect").value=$("#fSem").value;
    Store.set("semester",$("#fSem").value);
  });
  $("#semesterSelect").addEventListener("change",()=>{
    $("#fSem").value=$("#semesterSelect").value;
    Store.set("semester",$("#fSem").value);
    if(state.role==="student")navigate("resources");
    renderAllResources();
  });
  $("#clearFilters").addEventListener("click",()=>{
    ["#fBranch","#fYear","#fSem","#fSubject","#fCategory"].forEach(selector=>$(selector).value="");
    $("#fSearch").value="";
    $("#semesterSelect").value="";
    Store.set("semester","");
    renderAllResources();
  });
  $("#resEmptyClear").addEventListener("click",()=>$("#clearFilters").click());
  $$(".vt-btn").forEach(b=>b.addEventListener("click",()=>{
    $$(".vt-btn").forEach(x=>{x.classList.remove("active");x.setAttribute("aria-pressed","false");});
    b.classList.add("active");b.setAttribute("aria-pressed","true");
    state.resourceLayout=b.dataset.layout;Store.set("defaultView",state.resourceLayout);
    renderAllResources();
  }));

  function openResourcePreview(r){
    const filePreview=r.fileId
      ?'<div class="resource-file-preview">'+(r.fileContentType&&r.fileContentType.startsWith("image/")?'<img class="resource-preview-large" src="'+esc(documentOriginalUrl(r.fileId))+'" alt="Preview of '+esc(r.fileName||r.title)+'" />':'')+'<p>Attached file: '+esc(r.fileName||"Document")+'</p><a class="btn ghost" href="'+esc(documentPdfUrl(r.fileId))+'">Open converted PDF</a></div>'
      :'<div class="resource-file-preview">No course document is attached to this catalogue entry.</div>';
    modal("Resource details",
      '<div style="display:flex;flex-direction:column;gap:14px">'+
      '<div style="display:flex;align-items:center;gap:12px"><span class="res-icon fmt-'+r.format+'" style="width:48px;height:48px">'+esc(r.format)+'</span><div><p style="font-size:16px;font-weight:600">'+esc(r.title)+'</p><p class="muted">'+esc(subjectName(r.subject))+'</p></div></div>'+
      '<div style="display:flex;flex-wrap:wrap;gap:8px"><span class="res-meta" style="display:inline-block;font-size:12px;color:var(--ink-500);background:var(--gray-100);padding:4px 10px;border-radius:6px">'+esc(r.category)+'</span><span class="res-meta" style="display:inline-block;font-size:12px;color:var(--ink-500);background:var(--gray-100);padding:4px 10px;border-radius:6px">Semester '+r.sem.replace("sem","")+'</span><span class="res-meta" style="display:inline-block;font-size:12px;color:var(--ink-500);background:var(--gray-100);padding:4px 10px;border-radius:6px">'+esc(r.format)+'</span></div>'+
      '<p class="muted">Academic Resources Team · '+fmtDate(r.date)+'</p>'+filePreview+'</div>',
      '<button class="btn ghost" data-close>Close</button><button class="btn primary" data-dl-modal '+(r.fileId?"":"disabled")+'>'+(r.fileId?"Download PDF":"No file attached")+'</button>');
    $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
    if(r.fileId)$("[data-dl-modal]",$("#modalFoot")).addEventListener("click",()=>{closeModal();downloadResource(r);});
  }

  function downloadResource(r){
    if(!r.fileId){toast("This catalogue entry has no attached course file.","warning");return;}
    const link=el("a",{href:documentPdfUrl(r.fileId),download:(r.fileName||r.title).replace(/\.[^.]+$/,"")+".pdf"});
    document.body.appendChild(link);
    link.click();
    link.remove();
    toast("Converted PDF downloaded","success",r.fileName||r.title);
  }

  function toggleBookmark(id,btn){
    const i=state.bookmarks.indexOf(id);
    if(i>-1){state.bookmarks.splice(i,1);toast("Removed bookmark","info");}
    else{state.bookmarks.push(id);toast("Saved bookmark","success");}
    Store.set("bookmarks",state.bookmarks);
    if(btn){btn.classList.toggle("active");const svg=btn.querySelector("svg");svg.setAttribute("fill",btn.classList.contains("active")?"currentColor":"none");}
  }

  /* ---- Papers & Labs views ---- */
  function renderPapers(){renderResources(r=>r.category==="Previous Papers",$("#papersContainer"));}
  function renderLabs(){renderResources(r=>r.category==="Laboratory Programs",$("#labsContainer"));}

  /* ---------------- Assignments ---------------- */
  function renderAssignments(){
    const list=$("#assignmentList");
    const filter=$("#asgFilter").value,search=$("#asgSearch").value.trim().toLowerCase();
    const items=assignments.filter(a=>{
      const st=state.asgStatuses[a.id]||a.status;
      if(filter&&st!==filter)return false;
      if(search&&!a.title.toLowerCase().includes(search)&&!subjectName(a.subject).toLowerCase().includes(search))return false;
      return true;
    });
    list.innerHTML="";
    if(!items.length){list.innerHTML='<div class="asg-empty"><p>No assignments match your filters.</p></div>';return;}
    items.forEach(a=>{
      const st=state.asgStatuses[a.id]||a.status;
      const overdue=st!=="Completed"&&new Date(a.due)<new Date();
      const card=el("div",{class:"asg-card"});
      card.innerHTML=
        '<div class="asg-top"><div><h4>'+esc(a.title)+'</h4><p class="muted">'+esc(subjectName(a.subject))+'</p></div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px"><span class="row-tag '+(overdue?"tag-overdue":"tag-"+st.toLowerCase())+'">'+(overdue?"Overdue":st)+'</span><span class="muted" style="font-size:12px"><span class="priority-dot '+(a.priority==="high"?"pd-high":a.priority==="medium"?"pd-med":"pd-low")+'"></span>'+esc(a.priority)+' priority</span></div></div>'+
        '<p class="asg-desc">'+esc(a.desc)+'</p>'+
        '<div class="asg-meta"><span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg> Assigned '+fmtDate(a.assigned)+'</span><span><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg> Due '+fmtDate(a.due)+'</span></div>'+
        '<div class="asg-actions">'+
        (st==="Pending"?'<button class="btn ghost" data-asg-act="submit" data-id="'+a.id+'">Mark Submitted</button>':"")+
        (st!=="Completed"?'<button class="btn primary" data-asg-act="complete" data-id="'+a.id+'">Mark Completed</button>':"")+
        (st!=="Pending"?'<button class="btn ghost" data-asg-act="reset" data-id="'+a.id+'">Reset</button>':"")+
        '<button class="btn ghost" data-asg-act="view" data-id="'+a.id+'">View details</button></div>';
      list.appendChild(card);
    });
  }
  $("#assignmentList").addEventListener("click",e=>{
    const b=e.target.closest("[data-asg-act]");if(!b)return;
    const id=b.dataset.id,act=b.dataset.asgAct,a=assignments.find(x=>String(x.id)===id);
    if(!a)return;
    if(act==="view"){
      const st=state.asgStatuses[id]||a.status;
      modal(a.title,'<div style="display:flex;flex-direction:column;gap:10px"><p class="muted">'+esc(subjectName(a.subject))+'</p><p>'+esc(a.desc)+'</p><div style="display:flex;gap:10px;font-size:13px;color:var(--ink-500)"><span>Assigned: '+fmtDate(a.assigned)+'</span><span>Due: '+fmtDate(a.due)+'</span></div><p>Status: <strong>'+st+'</strong></p><p class="local-note">Status changes are saved to your account only and are not submitted to faculty.</p></div>','<button class="btn ghost" data-close>Close</button>');
      $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
    }else if(act==="submit"){state.asgStatuses[id]="Submitted";Store.set("asgStatuses",state.asgStatuses);renderAssignments();toast("Assignment marked submitted","success");}
    else if(act==="complete"){state.asgStatuses[id]="Completed";Store.set("asgStatuses",state.asgStatuses);renderAssignments();toast("Assignment marked completed","success");}
    else if(act==="reset"){delete state.asgStatuses[id];Store.set("asgStatuses",state.asgStatuses);renderAssignments();toast("Assignment reset","info");}
  });
  ["#asgFilter","#asgSearch"].forEach(s=>$(s).addEventListener("input",renderAssignments));

  /* ---------------- AI Assistant ---------------- */
  function renderChat(){
    const area=$("#chatArea");
    area.innerHTML="";
    if(!state.chat.length){
      const welcome=el("div",{class:"msg assistant"});
      welcome.innerHTML='<span class="msg-avatar">EV</span><div class="msg-bubble">Welcome to the EduVault AI study assistant. Ask a question about a course, or choose a subject above to ground the answer in its uploaded materials.</div>';
      area.appendChild(welcome);
      return;
    }
    state.chat.forEach(m=>appendMessage(m.role,m.text,m.source));
  }
  function appendMessage(role,text,source){
    const area=$("#chatArea");
    const msg=el("div",{class:"msg "+role});
    msg.innerHTML='<span class="msg-avatar">'+(role==="user"?"You":"AI")+'</span><div class="msg-bubble">'+esc(text).replace(/\n/g,"<br>")+'</div>';
    area.appendChild(msg);
    if(source){const s=el("div",{class:"msg-source"});s.textContent="Source: "+source;area.appendChild(s);}
    area.scrollTop=area.scrollHeight;
  }
  function showTyping(){
    const area=$("#chatArea");
    const t=el("div",{class:"typing"});t.innerHTML="<span></span><span></span><span></span>";t.id="typingIndicator";
    area.appendChild(t);area.scrollTop=area.scrollHeight;
  }
  function hideTyping(){const t=$("#typingIndicator");if(t)t.remove();}
  $("#chatForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const input=$("#chatInput");
    const q=input.value.trim();if(!q)return;
    input.value="";
    state.chat.push({role:"user",text:q});
    appendMessage("user",q);
    showTyping();
    $("#chatSend").disabled=true;
    try{
      const response=await fetch("/api/ai/agent",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"chat",message:q,subjectId:$("#assistantSubject").value||null})
      });
      let result={};
      try{result=await response.json();}catch(error){
        console.error("The AI assistant returned an unreadable response.",error);
        throw new Error("The AI assistant returned an unreadable response.");
      }
      if(!response.ok)throw new Error(result.error||"The AI assistant could not complete your request.");
      hideTyping();
      const source=result.sources?.length?"Course material: "+result.sources.join(", "):"No readable uploaded course material was available.";
      state.chat.push({role:"assistant",text:result.reply,source});
      appendMessage("assistant",result.reply,source);
      Store.set("chat",state.chat);
    }catch(error){
      hideTyping();
      console.error("The AI assistant request failed.",error);
      const message=error.message||"The AI assistant could not complete your request.";
      state.chat.push({role:"assistant",text:message});
      appendMessage("assistant",message);
      Store.set("chat",state.chat);
    }finally{
      $("#chatSend").disabled=false;
      input.focus();
    }
  });
  $("#assistantSuggest").addEventListener("click",e=>{const b=e.target.closest(".suggest-chip");if(!b)return;$("#chatInput").value=b.dataset.q;$("#chatInput").focus();});
  $("#clearChat").addEventListener("click",()=>{confirmModal("Clear chat","Remove all messages from this conversation?",()=>{state.chat=[];Store.set("chat",[]);renderChat();toast("Chat cleared","info");},"Clear",true);});

  /* ---------------- Practice Tests ---------------- */
  function renderTests(){
    if(state.quiz.active)return;
    const list=$("#testList");list.innerHTML="";
    if(!tests.length){
      list.innerHTML='<div class="asg-empty"><p>No practice tests are available yet.</p></div>';
      return;
    }
    tests.forEach(t=>{
      const card=el("div",{class:"test-card"});
      card.innerHTML='<div><h4>'+esc(t.title)+'</h4><p class="muted">'+esc(subjectName(t.subject))+'</p></div><div class="test-meta"><span>'+t.questions.length+' questions</span><span>'+Math.floor(t.duration/60)+' min</span><span class="diff-'+esc(t.difficulty)+'">'+esc(t.difficulty.charAt(0).toUpperCase()+t.difficulty.slice(1))+'</span></div><button class="btn primary" data-start="'+esc(t.id)+'">Start test</button>';
      list.appendChild(card);
    });
  }
  $("#testList").addEventListener("click",e=>{
    const b=e.target.closest("[data-start]");if(!b)return;
    startTest(b.dataset.start);
  });

  function startTest(id){
    const t=tests.find(x=>String(x.id)===String(id));if(!t)return;
    state.quiz={active:true,test:t,answers:new Array(t.questions.length).fill(null),current:0,timer:null,remaining:t.duration,submitted:false};
    $("#testList").hidden=true;$("#quizResult").hidden=true;$("#quizPanel").hidden=false;
    $("#quizTitle").textContent=t.title;$("#quizSub").textContent=subjectName(t.subject)+" · "+t.questions.length+" questions";
    state.quiz.timer=setInterval(tick,1000);
    renderQuestion();
  }
  function tick(){
    state.quiz.remaining--;
    updateTimer();
    if(state.quiz.remaining<=0){clearInterval(state.quiz.timer);submitTest(true);}
  }
  function updateTimer(){
    const m=Math.floor(Math.max(0,state.quiz.remaining)/60),s=Math.max(0,state.quiz.remaining)%60;
    $("#quizTimer").textContent=String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
    $("#quizTimer").classList.toggle("warn",state.quiz.remaining<=30);
  }
  function renderQuestion(){
    const q=state.quiz.test.questions[state.quiz.current];
    $("#quizProgressBar").style.width=((state.quiz.current+1)/state.quiz.test.questions.length*100)+"%";
    $("#quizCounter").textContent="Question "+(state.quiz.current+1)+" of "+state.quiz.test.questions.length;
    updateTimer();
    const body=$("#quizBody");
    body.innerHTML='<p class="quiz-q">'+esc(state.quiz.current+1+". "+q.q)+'</p>';
    q.opts.forEach((opt,i)=>{
      const b=el("button",{class:"quiz-opt"+(state.quiz.answers[state.quiz.current]===i?" selected":""),"data-opt":i});
      b.textContent=opt;
      b.addEventListener("click",()=>{state.quiz.answers[state.quiz.current]=i;renderQuestion();});
      body.appendChild(b);
    });
    $("#quizPrev").disabled=state.quiz.current===0;
    $("#quizNext").disabled=state.quiz.current===state.quiz.test.questions.length-1;
  }
  $("#quizPrev").addEventListener("click",()=>{if(state.quiz.current>0){state.quiz.current--;renderQuestion();}});
  $("#quizNext").addEventListener("click",()=>{if(state.quiz.current<state.quiz.test.questions.length-1){state.quiz.current++;renderQuestion();}});
  $("#quizSubmit").addEventListener("click",()=>{
    const unanswered=state.quiz.answers.filter(a=>a===null).length;
    if(unanswered>0){confirmModal("Submit test?","You have "+unanswered+" unanswered question"+(unanswered>1?"s":"")+". Submit anyway?",()=>submitTest(false),"Submit",true);}
    else{confirmModal("Submit test?","Submit your test and see results?",()=>submitTest(false),"Submit");}
  });
  $("#quizCancel").addEventListener("click",()=>{confirmModal("Exit test?","Your progress will be lost. Exit the test?",()=>{clearInterval(state.quiz.timer);endTest();},"Exit",true);});

  function submitTest(timedOut){
    if(state.quiz.submitted)return;
    state.quiz.submitted=true;
    clearInterval(state.quiz.timer);
    const t=state.quiz.test;
    let correct=0;const topicStats={};
    t.questions.forEach((q,i)=>{
      const ans=state.quiz.answers[i];
      const ok=ans===q.ans;
      if(ok)correct++;
      if(!topicStats[q.topic])topicStats[q.topic]={correct:0,total:0};
      topicStats[q.topic].total++;
      if(ok)topicStats[q.topic].correct++;
    });
    const pct=Math.round(correct/t.questions.length*100);
    showResult(t,correct,t.questions.length-correct,pct,topicStats,timedOut);
    updateProgress(t,pct,topicStats);
  }
  function showResult(t,correct,incorrect,pct,topics,timedOut){
    $("#quizPanel").hidden=true;
    const grade=pct>=85?"Excellent":pct>=70?"Good":pct>=50?"Fair":"Needs improvement";
    const r=$("#quizResult");
    r.hidden=false;
    let topicHtml=Object.keys(topics).map(tp=>{
      const s=Math.round(topics[tp].correct/topics[tp].total*100);
      const col=s>=70?"var(--success)":s>=50?"var(--warning)":"var(--error)";
      return '<div class="topic-row"><span>'+esc(tp)+'</span><div class="topic-bar"><span style="width:'+s+'%;background:'+col+'"></span></div><span class="topic-pct">'+s+'%</span></div>';
    }).join("");
    const weak=Object.keys(topics).filter(tp=>topics[tp].correct/topics[tp].total<0.7);
    const recs=weak.length?weak.map(w=>"<li>Review <strong>"+esc(w)+"</strong> — score below 70%.</li>").join(""):"<li>No weak topics — great work!</li>";
    r.innerHTML=
      '<div class="result-hero"><p class="muted">'+esc(t.title)+(timedOut?" · Time expired":"")+'</p><div class="result-score">'+pct+'%</div><div class="result-grade">'+grade+'</div></div>'+
      '<div class="result-stats"><div class="result-stat"><h4 style="color:var(--success)">'+correct+'</h4><p>Correct</p></div><div class="result-stat"><h4 style="color:var(--error)">'+incorrect+'</h4><p>Incorrect</p></div><div class="result-stat"><h4>'+t.questions.length+'</h4><p>Total</p></div></div>'+
      '<div class="card" style="margin:0;box-shadow:none;border:1px solid var(--gray-200)"><div class="card-head"><h3>Topic-wise performance</h3></div><div class="card-body">'+topicHtml+'</div></div>'+
      '<div class="card" style="margin-top:16px;box-shadow:none;border:1px solid var(--gray-200)"><div class="card-head"><h3>Suggested areas to revise</h3></div><div class="card-body"><ul style="padding-left:18px;font-size:13.5px;line-height:1.8">'+recs+'</ul></div></div>'+
      '<div style="text-align:center;margin-top:20px"><button class="btn primary" id="retakeBtn">Retake test</button> <button class="btn ghost" id="backTestsBtn">Back to tests</button></div>';
    $("#retakeBtn").addEventListener("click",()=>{endTest();startTest(t.id);});
    $("#backTestsBtn").addEventListener("click",endTest);
    toast("Test submitted — score: "+pct+"%","success");
  }
  function endTest(){
    state.quiz={active:false,test:null,answers:[],current:0,timer:null,remaining:0,submitted:false};
    $("#quizPanel").hidden=true;$("#quizResult").hidden=true;$("#testList").hidden=false;
    renderTests();
  }
  function updateProgress(test,score,topicStats){
    const topics=Object.entries(topicStats).map(([name,result])=>({
      name,
      score:Math.round(result.correct/result.total*100)
    }));
    progressData.testHistory.unshift({
      name:test.title,
      subject:subjectName(test.subject),
      score,
      topics,
      date:new Date().toISOString().slice(0,10)
    });
    progressData.testHistory=progressData.testHistory.slice(0,8);
    Store.set("testHistory",progressData.testHistory);
  }

  /* ---------------- Progress ---------------- */
  function renderProgress(){
    const history=progressData.testHistory;
    const avg=history.length?Math.round(history.reduce((sum,test)=>sum+test.score,0)/history.length):0;
    const trend=history.length>1?(history[0].score>=history[1].score?"↑ Improving":"↓ Declining"):"Not enough data";
    $("#progressStats").innerHTML=
      statCardHtml("Tests completed",history.length,"var(--indigo-600)","rgba(91,109,224,.12)","tst")+
      statCardHtml("Average score",avg+"%","var(--success)","var(--success-bg)","scr")+
      statCardHtml("Best score",(history.length?Math.max(...history.map(test=>test.score)):0)+"%","var(--violet-500)","rgba(123,108,255,.12)","res")+
      statCardHtml("Recent trend",trend,"var(--warning)","var(--warning-bg)","asg");

    const subjectsByName=new Map();
    const topicsByName=new Map();
    history.forEach(test=>{
      if(test.subject){
        const subject=subjectsByName.get(test.subject)||{total:0,count:0};
        subject.total+=test.score;subject.count++;subjectsByName.set(test.subject,subject);
      }
      (test.topics||[]).forEach(topic=>{
        const result=topicsByName.get(topic.name)||{total:0,count:0};
        result.total+=topic.score;result.count++;topicsByName.set(topic.name,result);
      });
    });
    const sp=$("#subjectPerf");sp.innerHTML="";
    if(!subjectsByName.size)sp.innerHTML='<p class="asg-empty">Complete a practice test to see subject performance.</p>';
    subjectsByName.forEach((result,name)=>{
      const score=Math.round(result.total/result.count);
      const row=el("div",{class:"perf-row"});
      const col=score>=80?"var(--success)":score>=60?"var(--warning)":"var(--error)";
      row.innerHTML='<div class="perf-top"><span>'+esc(name)+'</span><span>'+score+'%</span></div><div class="perf-bar"><span style="width:'+score+'%;background:'+col+'"></span></div>';
      sp.appendChild(row);
    });

    const tp=$("#topicPerf");tp.innerHTML="";
    if(!topicsByName.size)tp.innerHTML='<p class="asg-empty">Topic insights will appear after a practice test.</p>';
    topicsByName.forEach((result,name)=>{
      const score=Math.round(result.total/result.count);
      const item=el("div",{class:"topic-card"});
      const col=score>=80?"var(--success)":score>=50?"var(--warning)":"var(--error)";
      const strength=score>=70;
      item.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center"><h4>'+esc(name)+'</h4><span class="row-tag '+(strength?"tag-completed":"tag-overdue")+'">'+(strength?"Strength":"Improve")+'</span></div><div class="perf-bar" style="margin-top:8px"><span style="width:'+score+'%;background:'+col+'"></span></div><p class="muted" style="margin-top:6px">'+score+'% in recent tests</p>';
      tp.appendChild(item);
    });

    renderScoreChart();
    renderProgressRecs();
  }
  function statCardHtml(label,value,icColor,icBg,cls){
    return '<div class="stat-card"><div class="stat-icon '+cls+'" style="background:'+icBg+';color:'+icColor+'"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/></svg></div><div><p class="stat-label">'+label+'</p><p class="stat-value">'+value+'</p></div></div>';
  }
  function renderScoreChart(){
    const svg=$("#scoreChart");
    const pts=progressData.testHistory.slice(0,5).reverse();
    const w=320,h=160,pad=24;
    const max=100;
    let path="";
    pts.forEach((p,i)=>{
      const x=pts.length===1?w/2:pad+(i/(pts.length-1))*(w-pad*2);
      const y=h-pad-(p.score/max)*(h-pad*2);
      path+=(i===0?"M":"L")+x+","+y+" ";
    });
    svg.innerHTML=
      '<line x1="24" y1="136" x2="296" y2="136" stroke="var(--gray-200)"/>'+
      '<line x1="24" y1="24" x2="24" y2="136" stroke="var(--gray-200)"/>'+
      '<path d="'+path+'" fill="none" stroke="var(--indigo-600)" stroke-width="2.5"/>'+
      pts.map((p,i)=>{
        const x=pts.length===1?w/2:pad+(i/(pts.length-1))*(w-pad*2),y=h-pad-(p.score/max)*(h-pad*2);
        return '<circle cx="'+x+'" cy="'+y+'" r="3.5" fill="#fff" stroke="var(--indigo-600)" stroke-width="2"/>';
      }).join("");
  }
  function renderProgressRecs(){
    const rec=$("#progressRecs");rec.innerHTML="";
    const topicScores=new Map();
    progressData.testHistory.forEach(test=>(test.topics||[]).forEach(topic=>{
      const result=topicScores.get(topic.name)||{total:0,count:0};
      result.total+=topic.score;result.count++;topicScores.set(topic.name,result);
    }));
    const weak=[...topicScores].filter(([,result])=>result.total/result.count<70).map(([name])=>name);
    if(!weak.length){rec.innerHTML='<p class="asg-empty">Complete a practice test to receive resource recommendations.</p>';return;}
    const recs=resources.filter(r=>{
      const sub=subjectName(r.subject);
      return weak.some(topic=>sub.toLowerCase().includes("c")||sub.toLowerCase().includes("math")||sub.toLowerCase().includes("data")||r.title.toLowerCase().includes(topic.toLowerCase()));
    }).slice(0,4);
    if(!recs.length){rec.innerHTML='<p class="asg-empty">No recommendations yet.</p>';return;}
    recs.forEach(r=>{
      const item=el("div",{class:"row-item"});
      item.innerHTML=resourceRowHtml(r);
      item.addEventListener("click",event=>{
        const view=event.target.closest("[data-view]");
        const download=event.target.closest("[data-dl]");
        const bookmark=event.target.closest("[data-bm]");
        if(view)openResourcePreview(r);
        else if(download)downloadResource(r);
        else if(bookmark)toggleBookmark(r.id,bookmark);
      });
      rec.appendChild(item);
    });
  }

  /* ---------------- Announcements ---------------- */
  let annFilter="all";
  function renderAnnouncements(){
    const list=$("#annList");
    const items=announcements.filter(a=>{
      if(annFilter==="unread")return !state.annRead.some(id=>String(id)===String(a.id));
      if(annFilter==="important")return a.priority==="Important";
      return true;
    });
    list.innerHTML="";
    if(!items.length){list.innerHTML='<div class="asg-empty"><p>No announcements match this filter.</p></div>';return;}
    items.forEach(a=>{
      const isRead=state.annRead.some(id=>String(id)===String(a.id));
      const card=el("div",{class:"ann-card"+(isRead?"":" unread"),"data-ann":a.id});
      card.innerHTML='<div class="asg-top"><h4>'+esc(a.title)+'</h4><span class="row-tag '+(a.priority==="Important"?"tag-important":"tag-normal")+'">'+esc(a.priority)+'</span></div><p class="muted">'+esc(a.desc)+'</p><div class="ann-foot"><span class="row-tag '+(isRead?"tag-normal":"tag-unread")+'">'+(isRead?"Read":"Unread")+'</span><span class="muted" style="font-size:12px">'+esc(a.dept)+'</span><time>'+fmtDate(a.date)+'</time></div>';
      bindActivation(card,()=>markAnnouncementRead(a.id));
      list.appendChild(card);
    });
  }
  function markAnnouncementRead(id){
    const normalizedId=String(id);
    if(!state.annRead.some(readId=>String(readId)===normalizedId)){state.annRead.push(normalizedId);Store.set("annRead",state.annRead);renderAnnouncements();updateNotifDot();}
  }
  $$(".tab").forEach(t=>t.addEventListener("click",()=>{
    $$(".tab").forEach(x=>{x.classList.remove("active");x.setAttribute("aria-selected","false");});
    t.classList.add("active");t.setAttribute("aria-selected","true");
    annFilter=t.dataset.annFilter;renderAnnouncements();
  }));

  /* ---------------- Notifications ---------------- */
  function renderNotifications(){
    const list=$("#notifList");list.innerHTML="";
    if(state.notifRead){$("#notifEmpty").hidden=false;list.hidden=true;return;}
    $("#notifEmpty").hidden=true;list.hidden=false;
    if(!announcements.length){
      $("#notifEmpty").hidden=false;
      list.hidden=true;
      return;
    }
    announcements.slice(0,5).forEach(announcement=>{
      const n={id:String(announcement.id),icon:announcement.priority==="Important"?"warn":"info",
        text:announcement.title,time:fmtDate(announcement.date),annId:announcement.id};
      const li=el("li",{"data-notif":n.id});
      li.innerHTML='<div class="notif-ic '+n.icon+'"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg></div><div class="notif-body"><p>'+esc(n.text)+'</p><time>'+esc(n.time)+'</time></div>';
      if(n.annId)bindActivation(li,()=>{closeNotifPanel();markAnnouncementRead(n.annId);navigate("announcements");});
      list.appendChild(li);
    });
  }
  function updateNotifDot(){
    const unread=announcements.filter(a=>!state.annRead.some(id=>String(id)===String(a.id))).length;
    $("#notifDot").hidden=unread===0;
  }
  function openNotifPanel(){$("#notifPanel").hidden=false;$("#notifBtn").setAttribute("aria-expanded","true");renderNotifications();}
  function closeNotifPanel(){$("#notifPanel").hidden=true;$("#notifBtn").setAttribute("aria-expanded","false");}
  $("#notifBtn").addEventListener("click",e=>{e.stopPropagation();$("#notifPanel").hidden?openNotifPanel():closeNotifPanel();});
  $("#markAllRead").addEventListener("click",()=>{
    announcements.forEach(a=>{if(!state.annRead.some(id=>String(id)===String(a.id)))state.annRead.push(String(a.id));});
    Store.set("annRead",state.annRead);
    state.notifRead=true;Store.set("notifRead",true);
    renderNotifications();updateNotifDot();toast("All notifications marked read","success");
  });
  document.addEventListener("click",e=>{
    if(!$("#notifPanel").hidden&&!$("#notifPanel").contains(e.target)&&e.target!==$("#notifBtn")&&!$("#notifBtn").contains(e.target))closeNotifPanel();
    const pd=$("#profileDropdown");
    if(!pd.hidden&&!pd.contains(e.target)&&e.target!==$("#profileBtn")&&!$("#profileBtn").contains(e.target)){pd.hidden=true;$("#profileBtn").setAttribute("aria-expanded","false");}
  });
  $("#profileBtn").addEventListener("click",e=>{e.stopPropagation();const d=$("#profileDropdown");d.hidden=!d.hidden;$("#profileBtn").setAttribute("aria-expanded",!d.hidden);});
  $("#signOutBtn").addEventListener("click",async()=>{
    $("#profileDropdown").hidden=true;
    try{
      await Promise.all([...pendingWrites.values()]);
      await fetch("/api/auth/logout",{method:"POST",credentials:"same-origin"});
    }
    catch(error){console.error("EduVault logout request failed.",error);}
    window.location.assign("index.html");
  });

  /* ---------------- Faculty Console ---------------- */
  function renderFacultyResources(){
    $("#fResCount").textContent=resources.length;
    $("#fAsgCount").textContent=assignments.length;
    $("#fAnnCount").textContent=announcements.length;
    $("#fSubjectCount").textContent=subjects.length;
    const body=$("#facultyResBody");body.innerHTML="";
    resources.forEach(r=>{
      const tr=el("tr");
      tr.innerHTML='<td>'+esc(r.title)+'</td><td>'+esc(subjectName(r.subject))+'</td><td>'+esc(r.category)+'</td><td>'+esc(r.format)+'</td><td>'+fmtDate(r.date)+'</td><td>'+(r.fileId?'<a href="'+esc(documentPdfUrl(r.fileId))+'">PDF · '+esc(r.fileName||"Attached file")+'</a>':'—')+'</td><td><div class="table-actions"><button class="icon-btn" data-edit="'+esc(r.id)+'" aria-label="Edit '+esc(r.title)+'">Edit</button><button class="icon-btn" data-del="'+esc(r.id)+'" aria-label="Delete '+esc(r.title)+'">Delete</button></div></td>';
      body.appendChild(tr);
    });
    renderFacultySubjects();
    renderFacultyTests();
    renderFacultyAssignments();
    renderFacultyAnnouncements();
  }
  function renderFacultySubjects(){
    const body=$("#facultySubjectBody");
    body.innerHTML="";
    subjects.forEach(subject=>{
      const row=el("tr");
      row.innerHTML='<td>'+esc(subject.name)+'</td><td>'+esc(subject.code)+'</td><td>'+esc(subject.branch)+'</td><td>'+esc(subject.sem)+'</td><td><div class="table-actions"><button class="icon-btn" data-subject-edit="'+esc(subject.id)+'" aria-label="Edit '+esc(subject.name)+'">Edit</button><button class="icon-btn" data-subject-delete="'+esc(subject.id)+'" aria-label="Delete '+esc(subject.name)+'">Delete</button></div></td>';
      body.appendChild(row);
    });
  }
  function renderFacultyAssignments(){
    const body=$("#facultyAssignmentBody");body.innerHTML="";
    assignments.forEach(assignment=>{
      const row=el("tr");
      row.innerHTML='<td>'+esc(assignment.title)+'</td><td>'+esc(subjectName(assignment.subject))+'</td><td>'+fmtDate(assignment.due)+'</td><td><div class="table-actions"><button class="icon-btn" data-assignment-edit="'+esc(assignment.id)+'" aria-label="Edit '+esc(assignment.title)+'">Edit</button><button class="icon-btn" data-assignment-del="'+esc(assignment.id)+'" aria-label="Delete '+esc(assignment.title)+'">Delete</button></div></td>';
      body.appendChild(row);
    });
  }
  function renderFacultyAnnouncements(){
    const body=$("#facultyAnnouncementBody");body.innerHTML="";
    announcements.forEach(announcement=>{
      const row=el("tr");
      row.innerHTML='<td>'+esc(announcement.title)+'</td><td>'+esc(announcement.priority)+'</td><td>'+fmtDate(announcement.date)+'</td><td><div class="table-actions"><button class="icon-btn" data-ann-edit="'+esc(announcement.id)+'" aria-label="Edit '+esc(announcement.title)+'">Edit</button><button class="icon-btn" data-ann-del="'+esc(announcement.id)+'" aria-label="Delete '+esc(announcement.title)+'">Delete</button></div></td>';
      body.appendChild(row);
    });
  }
  $("#facultyResBody").addEventListener("click",e=>{
    const del=e.target.closest("[data-del]"),edit=e.target.closest("[data-edit]");
    if(del){
      const resource=resources.find(item=>String(item.id)===del.dataset.del);
      if(!resource)return;
      confirmModal("Delete resource","Delete \""+resource.title+"\"? This cannot be undone.",async()=>{
        const updatedResources=resources.filter(item=>String(item.id)!==del.dataset.del);
        const updatedBookmarks=state.bookmarks.filter(id=>String(id)!==del.dataset.del);
        try{await saveResources(updatedResources);}
        catch(error){
          console.error("Could not delete the resource.",error);
          toast(error.message,"error");
          return;
        }
        state.bookmarks=updatedBookmarks;
        Store.set("bookmarks",state.bookmarks);
        renderFacultyResources();renderAllResources();renderPapers();renderLabs();
        toast("Resource deleted","success");
        if(resource.fileId)apiDeleteDocument(resource.fileId).catch(error=>{console.error("The deleted resource's file could not be removed.",error);toast(error.message,"error");});
      },"Delete",true);
    }
    if(edit){
      const resource=resources.find(item=>String(item.id)===edit.dataset.edit);
      if(!resource)return;
      const subjectOptions=subjects.map(subject=>'<option value="'+esc(subject.id)+'" '+(subject.id===resource.subject?"selected":"")+'>'+esc(subject.name)+'</option>').join("");
      const categoryOptions=categories.map(category=>'<option '+(category===resource.category?"selected":"")+'>'+esc(category)+'</option>').join("");
      modal("Edit resource",
        '<form id="editResourceForm" class="form"><div class="form-row"><label>Title<input name="title" value="'+esc(resource.title)+'" required /></label></div><div class="form-row"><label>Subject<select name="subject" required>'+subjectOptions+'</select></label></div><div class="form-row"><label>Category<select name="category" required>'+categoryOptions+'</select></label></div><div class="form-row"><label>Format<select name="format" required>'+["PDF","DOCX","PPTX","LAB","MD"].map(format=>'<option '+(format===resource.format?"selected":"")+'>'+format+'</option>').join("")+'</select></label></div><div class="form-row"><label>Replace attached file<input type="file" name="file" accept="'+documentAccept+'" /><span class="muted">Supported files are converted to PDF before saving.</span></label></div>'+(resource.fileId?'<div class="form-row"><a href="'+esc(documentPdfUrl(resource.fileId))+'">Current PDF: '+esc(resource.fileName||"Attached file")+'</a><label><input type="checkbox" name="removeFile" /> Remove current attachment</label></div>':'')+'</form>',
        '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit" form="editResourceForm">Save changes</button>');
      $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
      $("#editResourceForm").addEventListener("submit",async event=>{
        event.preventDefault();
        const form=event.currentTarget;
        const formData=new FormData(form);
        const title=String(formData.get("title")||"").trim();
        if(!title){toast("A resource title is required.","error");return;}
        const subjectId=String(formData.get("subject"));
        const subject=subjects.find(item=>item.id===subjectId);
        const selectedFile=formData.get("file");
        const hasReplacement=selectedFile instanceof File&&selectedFile.name!=="";
        const removeAttachment=formData.get("removeFile")==="on";
        const submitButton=$("[form=editResourceForm]");
        submitButton.disabled=true;
        let uploaded=null;
        try{
          if(hasReplacement)uploaded=await apiUploadDocument(selectedFile);
        }catch(error){
          console.error("Could not replace the resource attachment.",error);
          toast(error.message,"error");
          submitButton.disabled=false;
          return;
        }
        const previous={...resource};
        Object.assign(resource,{
          title,
          subject:subjectId,
          sem:subject?.sem||resource.sem,
          branch:subject?.branch||resource.branch,
          year:subject?.year||resource.year,
          category:String(formData.get("category")),
          format:uploaded?"PDF":String(formData.get("format"))
        });
        if(uploaded){
          resource.fileId=uploaded.id;
          resource.fileName=uploaded.name;
          resource.fileContentType=uploaded.contentType;
        }else if(removeAttachment){
          delete resource.fileId;delete resource.fileName;delete resource.fileContentType;
        }
        try{await saveResources(resources);}
        catch(error){
          console.error("Could not update the resource.",error);
          toast(error.message,"error");
          Object.assign(resource,previous);
          for(const key of ["fileId","fileName","fileContentType"])if(!(key in previous))delete resource[key];
          if(uploaded)apiDeleteDocument(uploaded.id).catch(error=>{console.error("Could not remove an unsaved file upload.",error);toast(error.message,"error");});
          submitButton.disabled=false;
          return;
        }
        closeModal();renderFacultyResources();renderAllResources();renderPapers();renderLabs();
        toast("Resource updated","success");
        const replacedFile=uploaded||removeAttachment;
        if(replacedFile&&previous.fileId)apiDeleteDocument(previous.fileId).catch(error=>{console.error("The previous resource attachment could not be removed.",error);toast(error.message,"error");});
      });
    }
  });
  $("#facultyAssignmentBody").addEventListener("click",event=>{
    const editButton=event.target.closest("[data-assignment-edit]");
    const deleteButton=event.target.closest("[data-assignment-del]");
    if(editButton){
      const assignment=assignments.find(item=>String(item.id)===editButton.dataset.assignmentEdit);
      if(!assignment)return;
      const subjectOptions=subjects.map(subject=>'<option value="'+esc(subject.id)+'" '+(subject.id===assignment.subject?"selected":"")+'>'+esc(subject.name)+'</option>').join("");
      modal("Edit assignment",
        '<form id="editAssignmentForm" class="form"><div class="form-row"><label>Title<input name="title" value="'+esc(assignment.title)+'" required /></label></div><div class="form-row"><label>Subject<select name="subject" required>'+subjectOptions+'</select></label></div><div class="form-row"><label>Due date<input type="date" name="due" value="'+esc(assignment.due)+'" required /></label></div><div class="form-row"><label>Priority<select name="priority" required>'+["low","medium","high"].map(priority=>'<option value="'+priority+'" '+(priority===assignment.priority?"selected":"")+'>'+priority.charAt(0).toUpperCase()+priority.slice(1)+'</option>').join("")+'</select></label></div><div class="form-row"><label>Instructions<textarea name="desc" rows="4" required>'+esc(assignment.desc)+'</textarea></label></div></form>',
        '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit" form="editAssignmentForm">Save changes</button>');
      $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
      $("#editAssignmentForm").addEventListener("submit",event=>{
        event.preventDefault();
        const values=new FormData(event.currentTarget);
        const title=String(values.get("title")||"").trim();
        const desc=String(values.get("desc")||"").trim();
        const subjectId=String(values.get("subject")||"");
        const due=String(values.get("due")||"");
        if(!title||!desc||!subjectId||!due){toast("Complete all assignment fields.","error");return;}
        const original={...assignment};
        Object.assign(assignment,{title,desc,subject:subjectId,due,priority:String(values.get("priority"))});
        if(!Store.set("assignments",assignments)){Object.assign(assignment,original);return;}
        closeModal();renderFacultyResources();renderOverview();renderAssignments();
        toast("Assignment updated","success");
      });
      return;
    }
    if(!deleteButton)return;
    const id=deleteButton.dataset.assignmentDel;
    const assignment=assignments.find(item=>String(item.id)===id);
    if(!assignment)return;
    confirmModal("Delete assignment","Delete \""+assignment.title+"\"? This cannot be undone.",()=>{
      const updated=assignments.filter(item=>String(item.id)!==id);
      if(!Store.set("assignments",updated))return;
      assignments=updated;
      delete state.asgStatuses[id];
      Store.set("asgStatuses",state.asgStatuses);
      renderFacultyResources();renderOverview();renderAssignments();
      toast("Assignment deleted","success");
    },"Delete",true);
  });
  function resetTestForm(){
    $("#testForm").reset();
    delete $("#testForm").dataset.editId;
    $("#testFormHeading").textContent="Add a practice test";
    $("#saveTestBtn").textContent="Add test";
    $("#cancelTestEdit").hidden=true;
  }
  $("#cancelTestEdit").addEventListener("click",resetTestForm);
  $("#generateTestBtn").addEventListener("click",async()=>{
    const form=$("#testForm");
    const topic=form.elements.topic.value.trim();
    const subjectId=form.elements.subject.value;
    const difficulty=form.elements.difficulty.value;
    const questionCount=Number($("#aiQuestionCount").value);
    if(!subjectId||!topic||!Number.isInteger(questionCount)||questionCount<5||questionCount>20){
      toast("Choose a subject, enter a topic, and request 5–20 questions.","warning");
      return;
    }
    const button=$("#generateTestBtn");
    button.disabled=true;
    button.textContent="Generating…";
    try{
      const response=await fetch("/api/ai/agent",{
        method:"POST",credentials:"same-origin",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({action:"generate_test",subjectId,topic,difficulty,questionCount})
      });
      let result={};
      try{result=await response.json();}catch(error){
        console.error("The AI test generator returned an unreadable response.",error);
        throw new Error("The AI test generator returned an unreadable response.");
      }
      if(!response.ok)throw new Error(result.error||"The AI test could not be generated.");
      const draft=result.test;
      const questionPreview=draft.questions.map((question,index)=>
        "<li><strong>"+esc(question.q)+"</strong><ol type='A'>"+
        question.opts.map((option,optionIndex)=>"<li>"+esc(option)+(optionIndex===question.ans?" <strong>(correct)</strong>":"")+"</li>").join("")+
        "</ol></li>"
      ).join("");
      const sourceNote=result.sources?.length
        ?"<p class='local-note'>Based on uploaded course materials: "+esc(result.sources.join(", "))+"</p>"
        :"<p class='local-note'>No readable uploaded course file was available; this draft uses the subject and topic only.</p>";
      modal("Review AI-generated test",
        "<p><strong>"+esc(draft.title)+"</strong> · "+draft.questions.length+" questions · "+esc(difficulty)+"</p>"+
        sourceNote+"<ol class='ai-test-preview'>"+questionPreview+"</ol>"+
        "<p class='local-note'>AI content may contain errors. Review every question and answer before saving.</p>",
        "<button class='btn ghost' data-close>Discard draft</button><button class='btn primary' data-use-draft>Review in test form</button>");
      $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
      $("[data-use-draft]",$("#modalFoot")).addEventListener("click",()=>{
        resetTestForm();
        form.elements.title.value=draft.title;
        form.elements.subject.value=draft.subject;
        form.elements.topic.value=draft.topic;
        form.elements.durationMinutes.value=String(draft.duration/60);
        form.elements.difficulty.value=draft.difficulty;
        form.elements.questions.value=JSON.stringify(draft.questions,null,2);
        closeModal();
        toast("Draft loaded for review. Save it when you're ready.","success");
        form.scrollIntoView({behavior:"smooth",block:"center"});
      });
    }catch(error){
      console.error("Could not generate an AI test draft.",error);
      toast(error.message||"The AI test could not be generated.","error");
    }finally{
      button.disabled=false;
      button.textContent="Generate AI draft";
    }
  });
  $("#testForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const values=new FormData(form);
    let questions;
    try{questions=JSON.parse(String(values.get("questions")||""));}
    catch(error){
      console.error("The practice test question JSON is invalid.",error);
      toast("Questions must be valid JSON.","error");
      return;
    }
    const test={
      id:form.dataset.editId||"test_"+uid(),
      title:String(values.get("title")||"").trim(),
      subject:String(values.get("subject")||""),
      topic:String(values.get("topic")||"").trim(),
      duration:Number(values.get("durationMinutes"))*60,
      difficulty:String(values.get("difficulty")||"medium"),
      questions
    };
    if(!test.title||!test.subject||!test.topic||!Array.isArray(questions)||!questions.length){
      toast("Complete the test details and add at least one question.","error");
      return;
    }
    const updated=tests.some(item=>String(item.id)===String(test.id))
      ?tests.map(item=>String(item.id)===String(test.id)?test:item)
      :[...tests,test];
    const button=$("#saveTestBtn");
    button.disabled=true;
    try{
      await saveTests(updated);
      resetTestForm();
      toast("Practice test saved","success");
    }catch(error){
      console.error("Could not save the practice test.",error);
      toast(error.message,"error");
    }finally{
      button.disabled=false;
    }
  });
  $("#facultyTestBody").addEventListener("click",event=>{
    const edit=event.target.closest("[data-test-edit]");
    const remove=event.target.closest("[data-test-delete]");
    const id=edit?.dataset.testEdit||remove?.dataset.testDelete;
    if(!id)return;
    const test=tests.find(item=>String(item.id)===id);
    if(!test)return;
    if(edit){
      const form=$("#testForm");
      form.dataset.editId=test.id;
      form.elements.title.value=test.title;
      form.elements.subject.value=test.subject;
      form.elements.topic.value=test.topic;
      form.elements.durationMinutes.value=String(test.duration/60);
      form.elements.difficulty.value=test.difficulty;
      form.elements.questions.value=JSON.stringify(test.questions,null,2);
      $("#testFormHeading").textContent="Edit practice test";
      $("#saveTestBtn").textContent="Save test";
      $("#cancelTestEdit").hidden=false;
      form.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    confirmModal("Delete practice test","Delete \""+test.title+"\"? This cannot be undone.",async()=>{
      try{
        await saveTests(tests.filter(item=>String(item.id)!==id));
        toast("Practice test deleted","success");
      }catch(error){
        console.error("Could not delete the practice test.",error);
        toast(error.message,"error");
      }
    },"Delete",true);
  });
  $("#facultyAnnouncementBody").addEventListener("click",event=>{
    const editButton=event.target.closest("[data-ann-edit]");
    const deleteButton=event.target.closest("[data-ann-del]");
    if(editButton){
      const announcement=announcements.find(item=>String(item.id)===editButton.dataset.annEdit);
      if(!announcement)return;
      modal("Edit announcement",
        '<form id="editAnnouncementForm" class="form"><div class="form-row"><label>Title<input name="title" value="'+esc(announcement.title)+'" required /></label></div><div class="form-row"><label>Priority<select name="priority" required><option value="Normal" '+(announcement.priority==="Normal"?"selected":"")+'>Normal</option><option value="Important" '+(announcement.priority==="Important"?"selected":"")+'>Important</option></select></label></div><div class="form-row"><label>Description<textarea name="desc" rows="4" required>'+esc(announcement.desc)+'</textarea></label></div></form>',
        '<button class="btn ghost" data-close>Cancel</button><button class="btn primary" type="submit" form="editAnnouncementForm">Save changes</button>');
      $("[data-close]",$("#modalFoot")).addEventListener("click",closeModal);
      $("#editAnnouncementForm").addEventListener("submit",event=>{
        event.preventDefault();
        const values=new FormData(event.currentTarget);
        const title=String(values.get("title")||"").trim();
        const desc=String(values.get("desc")||"").trim();
        if(!title||!desc){toast("Complete all announcement fields.","error");return;}
        const original={...announcement};
        Object.assign(announcement,{title,desc,priority:String(values.get("priority"))});
        if(!Store.set("announcements",announcements)){Object.assign(announcement,original);return;}
        closeModal();renderAnnouncements();renderFacultyResources();renderOverview();updateNotifDot();
        toast("Announcement updated","success");
      });
      return;
    }
    if(!deleteButton)return;
    const id=deleteButton.dataset.annDel;
    const announcement=announcements.find(item=>String(item.id)===id);
    if(!announcement)return;
    confirmModal("Delete announcement","Delete \""+announcement.title+"\"? This cannot be undone.",()=>{
      const updated=announcements.filter(item=>String(item.id)!==id);
      if(!Store.set("announcements",updated))return;
      announcements=updated;
      state.annRead=state.annRead.filter(readId=>String(readId)!==id);
      Store.set("annRead",state.annRead);
      renderAnnouncements();renderFacultyResources();renderOverview();updateNotifDot();
      toast("Announcement deleted","success");
    },"Delete",true);
  });
  $("#reloadFacultyRes").addEventListener("click",()=>window.location.reload());
  function resetSubjectForm(){
    $("#subjectForm").reset();
    delete $("#subjectForm").dataset.editId;
    $("#subjectFormHeading").textContent="Add a subject";
    $("#saveSubjectBtn").textContent="Add subject";
    $("#cancelSubjectEdit").hidden=true;
  }
  $("#cancelSubjectEdit").addEventListener("click",resetSubjectForm);
  $("#subjectForm").addEventListener("submit",async event=>{
    event.preventDefault();
    const form=event.currentTarget;
    const values=new FormData(form);
    const id=form.dataset.editId||"subject_"+uid();
    const subject={
      id,name:String(values.get("name")||"").trim(),code:String(values.get("code")||"").trim(),
      branch:String(values.get("branch")||"").trim(),sem:String(values.get("sem")||"").trim(),
      year:String(values.get("year")||"").trim()
    };
    if(!subject.name||!subject.code||!subject.branch||!subject.sem||!subject.year){
      toast("Complete all subject fields.","error");
      return;
    }
    const updated=subjects.some(item=>item.id===id)
      ?subjects.map(item=>item.id===id?subject:item)
      :[...subjects,subject];
    const button=$("#saveSubjectBtn");
    button.disabled=true;
    try{
      await saveSubjects(updated);
      resetSubjectForm();
      toast("Subject saved","success");
    }catch(error){
      console.error("Could not save the subject.",error);
      toast(error.message,"error");
    }finally{
      button.disabled=false;
    }
  });
  $("#facultySubjectBody").addEventListener("click",event=>{
    const edit=event.target.closest("[data-subject-edit]");
    const remove=event.target.closest("[data-subject-delete]");
    const id=edit?.dataset.subjectEdit||remove?.dataset.subjectDelete;
    if(!id)return;
    const subject=subjects.find(item=>item.id===id);
    if(!subject)return;
    if(edit){
      const form=$("#subjectForm");
      form.dataset.editId=subject.id;
      for(const field of ["name","code","branch","sem","year"])form.elements[field].value=subject[field];
      $("#subjectFormHeading").textContent="Edit subject";
      $("#saveSubjectBtn").textContent="Save subject";
      $("#cancelSubjectEdit").hidden=false;
      form.scrollIntoView({behavior:"smooth",block:"center"});
      return;
    }
    if(resources.some(resource=>String(resource.subject)===id)
      ||assignments.some(assignment=>String(assignment.subject)===id)
      ||tests.some(test=>String(test.subject)===id)){
      toast("This subject is used by a resource, assignment or practice test and cannot be deleted.","error");
      return;
    }
    confirmModal("Delete subject","Delete \""+subject.name+"\"? This cannot be undone.",async()=>{
      try{
        await saveSubjects(subjects.filter(item=>item.id!==id));
        toast("Subject deleted","success");
      }catch(error){
        console.error("Could not delete the subject.",error);
        toast(error.message,"error");
      }
    },"Delete",true);
  });
  $("#addAssignmentForm").addEventListener("submit",event=>{
    event.preventDefault();
    const formData=new FormData(event.currentTarget);
    const title=String(formData.get("title")||"").trim();
    const desc=String(formData.get("desc")||"").trim();
    const subjectId=String(formData.get("subject")||"");
    const due=String(formData.get("due")||"");
    const priority=String(formData.get("priority")||"medium");
    if(!title||!desc||!subjectId||!due){toast("Complete all assignment fields.","error");return;}
    const assignment={id:uid(),title,subject:subjectId,desc,assigned:new Date().toISOString().slice(0,10),due,status:"Pending",priority};
    assignments.unshift(assignment);
    if(!Store.set("assignments",assignments)){assignments.shift();return;}
    event.currentTarget.reset();
    renderFacultyResources();renderOverview();renderAssignments();
    toast("Assignment published","success");
  });
  $("#addResForm").addEventListener("submit",async e=>{
    e.preventDefault();
    const form=e.currentTarget;
    const fd=new FormData(form);
    const title=String(fd.get("title")||"").trim();
    if(!title){toast("Title is required","error");return;}
    const file=fd.get("file");
    const hasFile=file instanceof File&&file.name!=="";
    if(!hasFile){toast("Attach a course file before adding this resource.","error");return;}
    const subject=subjects.find(item=>item.id===fd.get("subject"));
    const submitButton=form.querySelector('[type="submit"]');
    submitButton.disabled=true;
    let uploaded=null;
    try{
      if(hasFile)uploaded=await apiUploadDocument(file);
      const resource={
        id:uid(),
        title,
        subject:fd.get("subject"),
        sem:subject?.sem||"sem1",
        category:fd.get("category"),
        format:uploaded?"PDF":fd.get("format"),
        date:new Date().toISOString().slice(0,10),
        uploader:"Academic Resources Team",
        branch:subject?.branch||"",
        year:subject?.year||""
      };
      if(uploaded){
        resource.fileId=uploaded.id;
        resource.fileName=uploaded.name;
        resource.fileContentType=uploaded.contentType;
      }
      await saveResources([resource,...resources]);
      renderFacultyResources();renderAllResources();renderPapers();renderLabs();
      form.reset();
      toast("Resource added"+(uploaded?" and converted to PDF":""),"success");
    }catch(error){
      console.error("Could not save the resource.",error);
      toast(error.message,"error");
      if(uploaded){
        try{await apiDeleteDocument(uploaded.id);}
        catch(cleanupError){console.error("The unlinked upload could not be removed.",cleanupError);toast(cleanupError.message,"error");}
      }
    }finally{
      submitButton.disabled=false;
    }
  });
  $("#addAnnForm").addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    const title=fd.get("title").trim();
    const desc=String(fd.get("desc")||"").trim();
    if(!title||!desc){toast("Complete all announcement fields.","error");return;}
    const announcement={id:uid(),title,dept:"Academic Office",date:new Date().toISOString().slice(0,10),priority:fd.get("priority"),desc,read:false};
    announcements.unshift(announcement);
    if(!Store.set("announcements",announcements)){announcements.shift();return;}
    renderAnnouncements();renderFacultyResources();renderOverview();updateNotifDot();
    e.target.reset();toast("Announcement posted","success");
  });

  /* ---------------- Help ---------------- */
  const faqs=[
    {q:"How do I find study resources?",a:"Go to Study Resources in the sidebar and use the filters for branch, year, semester, subject and category. You can also use the global search in the top bar."},
    {q:"Can I upload or download course documents?",a:"Faculty can attach supported documents or images to a resource. The local Flask service converts them to PDF; download the converted PDF from the resource card or faculty console."},
    {q:"How does the Study Assistant work?",a:"The assistant uses Google Gemini to answer questions. If you choose a subject, it can use readable text from uploaded course PDFs. AI answers can be inaccurate. Faculty can generate test drafts, review every question, and save approved tests to the shared database. The AI service must be configured by the administrator."},
    {q:"Where are changes and uploads saved?",a:"Subjects, resources, practice tests, assignments and announcements are saved in the shared MySQL database. Your bookmarks, assignment status, progress and preferences are saved to your own account. Uploaded originals and converted PDFs are stored in MySQL."}
  ];
  (function(){
    const list=$("#faqList");
    faqs.forEach(f=>{
      const item=el("div",{class:"faq-item"});
      item.innerHTML='<button class="faq-q" aria-expanded="false">'+esc(f.q)+'<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg></button><div class="faq-a"><p>'+esc(f.a)+'</p></div>';
      item.querySelector(".faq-q").addEventListener("click",()=>{
        const open=item.classList.toggle("open");
        item.querySelector(".faq-q").setAttribute("aria-expanded",open);
      });
      list.appendChild(item);
    });
  })();
  $("#helpForm").addEventListener("submit",e=>{
    e.preventDefault();
    const fd=new FormData(e.target);
    if(!fd.get("subject").trim()||!fd.get("message").trim()){toast("Please fill in all fields","error");return;}
    const requests=Store.get("supportRequests",[]);
    requests.push({subject:String(fd.get("subject")).trim(),message:String(fd.get("message")).trim(),date:new Date().toISOString()});
    Store.set("supportRequests",requests);
    e.target.reset();toast("Support request saved to your account","success","No message was sent.");
  });

  /* ---------------- Settings ---------------- */
  function applyPrefs(){
    document.body.classList.toggle("compact",state.preferences.compact);
    document.body.classList.toggle("reduced-motion",state.preferences.reducedMotion);
    $("#setCompact").checked=state.preferences.compact;
    $("#setReducedMotion").checked=state.preferences.reducedMotion;
    $("#setDefaultView").value=state.preferences.defaultView;
  }
  $("#setCompact").addEventListener("change",e=>{state.preferences.compact=e.target.checked;Store.set("prefs",state.preferences);document.body.classList.toggle("compact",e.target.checked);});
  $("#setReducedMotion").addEventListener("change",e=>{state.preferences.reducedMotion=e.target.checked;Store.set("prefs",state.preferences);document.body.classList.toggle("reduced-motion",e.target.checked);});
  $("#setDefaultView").addEventListener("change",e=>{
    state.preferences.defaultView=e.target.value;
    state.resourceLayout=e.target.value;
    Store.set("prefs",state.preferences);
    Store.set("defaultView",state.resourceLayout);
    $$(".vt-btn").forEach(b=>{
      const active=b.dataset.layout===state.resourceLayout;
      b.classList.toggle("active",active);
      b.setAttribute("aria-pressed",active);
    });
    renderAllResources();
  });
  $("#clearData").addEventListener("click",()=>{confirmModal("Clear saved data","This removes your bookmarks, assignment statuses, practice history, chat and preferences from your account. Continue?",async()=>{try{await Store.clearAll();location.reload();}catch(error){toast(error.message,"error");}},"Clear data",true);});

  /* ---------------- Global search ---------------- */
  $("#globalSearch").addEventListener("input",e=>{
    const q=e.target.value.trim().toLowerCase();
    if(q&&state.currentView!=="resources"){navigate("resources");}
    $("#fSearch").value=q;renderAllResources();
  });
  document.addEventListener("keydown",e=>{
    if((e.metaKey||e.ctrlKey)&&e.key==="k"){e.preventDefault();$("#globalSearch").focus();}
  });

  /* ---------------- Init ---------------- */
  function init(){
    document.body.classList.toggle("is-faculty",state.role==="faculty");
    $("#userRoleIndicator").textContent=state.role==="faculty"?"Faculty":"Student";
    $("#userName").textContent=accountLabel;
    $(".profile-name").textContent=accountLabel;
    $(".user-name",$("#profileDropdown")).textContent=accountLabel;
    $(".user-email").textContent=accountLabel;
    $$(".avatar").forEach(avatar=>{avatar.textContent=accountInitials;});
    populateFilters();
    populateSubjectSelectors();
    const semester=Store.get("semester","");
    $("#semesterSelect").value=semester;
    $("#fSem").value=semester;
    state.resourceLayout=state.preferences.defaultView||"grid";
    applyPrefs();
    $$(".vt-btn").forEach(b=>{b.classList.toggle("active",b.dataset.layout===state.resourceLayout);b.setAttribute("aria-pressed",b.dataset.layout===state.resourceLayout);});
    if(state.role==="student")renderOverview();
    renderAllResources();
    renderPapers();
    renderLabs();
    renderAssignments();
    renderTests();
    renderAnnouncements();
    updateNotifDot();
    navigate(state.currentView);
  }
  init();

})();
