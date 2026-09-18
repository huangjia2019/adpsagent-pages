import {normalize, safeReturnPath, counterpart, collectBlocks, validateDraft, errorText, publicLink} from "./core.mjs";

const zh = document.documentElement.lang.startsWith("zh");
const lang = zh ? "zh" : "en";
const T = zh ? {
 title:"讨论与修订", passage:"本段讨论", article:"全文讨论", mine:"我的贡献", review:"审核",
 login:"GitHub 登录", logout:"退出", suggest:"提出建议", close:"关闭", back:"返回讨论",
 empty:"暂无公开讨论。", loading:"正在读取…", noMine:"暂无投稿。", noReview:"暂无待审投稿。",
 quote:"引用原文", body:"建议或实践", kind:"类型", correction:"修改建议", experience:"实践补充", question:"问题", reply:"回复",
 consent:"同意审核后公开这条内容及我的 GitHub 用户名",
 submit:"提交", save:"提交新版本", onlyEditor:"未勾选时，仅你和维护者可见。",
 received:"已收到，等待审核。", source:"查看原文", share:"复制链接", copied:"链接已复制。",
 pending:"待审核", published:"已公开", needs_info:"待补充", declined:"暂不采纳", withdrawn:"已撤回",
 edit:"修改", withdraw:"撤回", withdrawAsk:"撤回后，公开记录和其回复也会隐藏。确认撤回？",
 response:"给投稿者的回复", publish:"批准公开", requestInfo:"请补充", decline:"暂不采纳", hide:"隐藏讨论",
 updated:"已更新。", old:"原文已修订，以下引用来自此前版本。",
 loginFirst:"请先登录。", all:"全部", more:"加载更多", private:"仅供编辑参考", public:"可审核公开",
 publicReply:"维护者回复", revision:"版本", openReview:"打开审核工作台", loginFail:"登录未完成，请重新登录。",
 draftSaved:"原草稿已恢复。", viewDiscussion:"查看讨论", applied:"正文修改", error:"连接暂不可用。",
 accounts:"当前账号", noPassage:"请从文章中的段落入口提交建议。", refresh:"刷新"
} : {
 title:"Discussion & revisions", passage:"Passage", article:"Article", mine:"My contributions", review:"Review",
 login:"Sign in with GitHub", logout:"Sign out", suggest:"Suggest a change", close:"Close", back:"Back to discussion",
 empty:"No public discussion yet.", loading:"Loading…", noMine:"No submissions yet.", noReview:"No pending submissions.",
 quote:"Quoted passage", body:"Suggestion or experience", kind:"Type", correction:"Correction", experience:"Experience", question:"Question", reply:"Reply",
 consent:"Allow publication of this content and my GitHub username after review",
 submit:"Submit", save:"Submit new revision", onlyEditor:"Leave unchecked to share with the editor only.",
 received:"Received and awaiting review.", source:"View source", share:"Copy link", copied:"Link copied.",
 pending:"Awaiting review", published:"Public", needs_info:"More information requested", declined:"Not accepted", withdrawn:"Withdrawn",
 edit:"Edit", withdraw:"Withdraw", withdrawAsk:"Withdraw this submission and hide its public discussion and replies?",
 response:"Response to contributor", publish:"Approve publication", requestInfo:"Request information", decline:"Not accepted", hide:"Hide discussion",
 updated:"Updated.", old:"The article has changed. This quotation comes from an earlier revision.",
 loginFirst:"Sign in to continue.", all:"All", more:"Load more", private:"For the editor only", public:"May be published after review",
 publicReply:"Editor's response", revision:"Revision", openReview:"Open review workspace", loginFail:"Sign-in did not finish. Please sign in again.",
 draftSaved:"Your earlier draft has been restored.", viewDiscussion:"View discussion", applied:"Article change", error:"The service is unavailable.",
 accounts:"Account", noPassage:"Open a passage in an article to submit a suggestion.", refresh:"Refresh"
};
T.join = zh ? "参与讨论" : "Join the discussion";
T.passageChoice = zh ? "建议涉及的内容" : "Passage to discuss";
T.choosePassage = zh ? "选择原文段落" : "Select a passage";
const openers = new Set();
let reviewLinks = {};
const rootPath = zh ? "/zh" : "";
const workspace = /\/(?:zh\/)?contribute\/$/.test(location.pathname);
const callback = location.pathname === "/auth/callback/";
let client, identity=null, manifest=null, selected=null, mode=workspace?"article":"passage", composing=false, editing=null;
let host, content, notice, tabs, account, dialog, trigger, more, records=[], busy=false, generation=0, offset=0;
const pageSize=30;
const blockMap = new Map();
const draftKey="adps.contribution.draft.v1";
const draftTTL=24*60*60*1000;
let reviewScope="pending";
let requestId=crypto.randomUUID();

function el(tag, attrs={}, ...children) {
 const node=document.createElement(tag);
 for(const [key,value] of Object.entries(attrs)) {
  if(key==="text") node.textContent=value;
  else if(key.startsWith("on")) node.addEventListener(key.slice(2),value);
  else if(value !== null && value !== undefined) node.setAttribute(key,String(value));
 }
 for(const child of children.flat()) if(child!==null && child!==undefined) node.append(child.nodeType?child:document.createTextNode(String(child)));
 return node;
}
function icon(name) { return el("i",{"data-lucide":name,"aria-hidden":"true"}); }
function icons() { window.lucide?.createIcons(); }
function button(label, glyph, action, text=false) {
 return el("button",{type:"button",class:text?"adps-command":"adps-icon",title:label,"aria-label":label,onclick:action},icon(glyph),text?el("span",{text:label}):null);
}
function message(text, bad=false) { notice.textContent=text; notice.className="adps-notice"+(bad?" is-error":""); }
function script(asset) {
 return new Promise((resolve,reject)=>{
  const s=el("script",{src:asset.url,integrity:asset.integrity,crossorigin:"anonymous"});
  s.onload=resolve;s.onerror=reject;document.head.append(s);
 });
}
async function rpc(name,args={}) {
 const {data,error}=await client.rpc(name,args);
 if(error) throw error;
 return data;
}
function safeStore(key,value) { try { sessionStorage.setItem(key,value); } catch {} }
function stored(key) { try { return sessionStorage.getItem(key); } catch { return null; } }
function clearDraft() { try { sessionStorage.removeItem(draftKey); } catch {} }
function getDraft() {
 try {
  const draft=JSON.parse(stored(draftKey));
  if(!draft || Date.now()-draft.saved_at>draftTTL) return null;
  if(safeReturnPath(draft.document_path,location.origin)!==draft.document_path) return null;
  return draft;
 } catch { return null; }
}
function draftValue(body,consent,kind) {
 return {...selected,body,publish_consent:consent,kind,request_id:requestId,saved_at:Date.now(),editing};
}
async function signIn() {
 safeStore("adps.return",safeReturnPath(location.pathname+location.hash,location.origin));
 const {error}=await client.auth.signInWithOAuth({
  provider:"github",options:{redirectTo:location.origin+"/auth/callback/",scopes:"read:user"}
 });
 if(error) message(errorText(error,lang),true);
}
async function refreshIdentity() {
 const {data:{session}}=await client.auth.getSession();
 identity=null;
 if(session) {
  try { identity=await rpc("adps_me"); }
  catch(error) { message(errorText(error,lang),true); }
 }
 renderAccount();renderTabs();
}
function renderAccount() {
 account.replaceChildren();
 if(identity) {
  account.append(el("a",{href:"https://github.com/"+identity.login,target:"_blank",rel:"noopener noreferrer",text:"@"+identity.login}),
   button(T.logout,"log-out",async()=>{await client.auth.signOut();identity=null;renderAccount();renderTabs();await load(true);}));
 } else account.append(button(T.login,"log-in",signIn,true));
 icons();
}
function renderTabs() {
 tabs.replaceChildren();
 const modes=workspace?["article","mine"]:["passage","article","mine"];
 if(identity?.moderator)modes.push("review");
 if(mode==="review"&&!identity?.moderator)mode="article";
 for(const value of modes) {
  const b=el("button",{type:"button",role:"tab","aria-selected":String(mode===value),text:workspace&&value==="article"?(zh?"公开讨论":"Public discussion"):T[value],
    onclick:()=>{mode=value;composing=false;editing=null;renderTabs();load(true);}});
  tabs.append(b);
 }
}
function makeHost() {
 if(workspace||callback) {
  host=el("section",{class:"adps-workspace adps-widget"});
  document.querySelector("#adps-contributions").append(host);
 } else {
  dialog=el("dialog",{id:"adps-discussion-panel",class:"adps-panel adps-widget","aria-labelledby":"adps-discussion-title"});
  document.body.append(dialog);host=dialog;
  dialog.addEventListener("close",()=>setExpanded(false));
 }
 const head=el("div",{class:"adps-panel-head"},
  el("h2",{id:"adps-discussion-title",text:T.title}),
  !workspace&&!callback?button(T.close,"x",()=>dialog.close()):null);
 account=el("div",{class:"adps-account"});
 tabs=el("div",{class:"adps-tabs",role:"tablist","aria-label":T.title});
 notice=el("p",{class:"adps-notice",role:"status","aria-live":"polite"});
 content=el("div",{class:"adps-panel-content"});
 host.append(head,account,tabs,notice,content);
 if(!workspace&&!callback) {
  trigger=button(T.title,"messages-square",openArticle,true);
  trigger.classList.add("adps-launch");registerOpener(trigger);
  document.body.append(trigger);
 }
 renderAccount();renderTabs();
}
function setExpanded(value) {
 for(const opener of openers)opener.setAttribute("aria-expanded",String(value));
}
function registerOpener(opener) {
 opener.setAttribute("aria-controls","adps-discussion-panel");
 opener.setAttribute("aria-haspopup","dialog");
 opener.setAttribute("aria-expanded","false");
 openers.add(opener);
}
function openArticle() {
 selected=null;editing=null;mode="article";composing=false;show();
}
function attachEntrances(article) {
 if(!article || !blockMap.size)return;
 const invitation=article.querySelector("[data-adps-open-discussion]");
 if(invitation) {
  registerOpener(invitation);
  invitation.addEventListener("click",event=>{event.preventDefault();openArticle();});
 } else {
  const heading=article.querySelector("h1");
  if(heading&&!article.querySelector(".adps-title-entry")) {
   const entry=el("div",{class:"adps-title-entry adps-widget"});
   const opener=button(T.join,"messages-square",openArticle,true);
   registerOpener(opener);entry.append(opener);heading.after(entry);
  }
 }
 icons();
}
function discussionComposer() {
 const group=el("div",{class:"adps-passage-picker"});
 const choose=el("select",{id:"adps-passage-choice"});
 choose.append(el("option",{value:"",text:T.choosePassage}));
 for(const {record} of blockMap.values())
  choose.append(el("option",{value:record.block_id,text:record.quote.slice(0,100)+(record.quote.length>100?"…":"")}));
 choose.value=selected?.block_id||"";
 const propose=button(T.suggest,"square-pen",()=>{
  selected={...blockMap.get(choose.value).record};
  requestId=crypto.randomUUID();editing=null;composing=true;renderForm();
 },true);
 propose.disabled=!choose.value;
 choose.addEventListener("change",()=>{propose.disabled=!choose.value;});
 group.append(el("label",{for:"adps-passage-choice",text:T.passageChoice}),choose,propose);
 return group;
}
function show() {
 if(dialog&&!dialog.open)dialog.showModal();
 setExpanded(true);
 renderTabs();load(true);
}
function sourceLink(record) {
 const path=safeReturnPath(record.document_path,location.origin);
 return el("a",{href:path+"#"+record.block_id,text:T.source,onclick:()=>{
  if(record.document_path===location.pathname) dialog?.close();
 }});
}
function card(record,review=false,mine=false) {
 const item=el("section",{class:"adps-record",id:"discussion-"+(record.proposal_id||record.id)});
 const heading=el("div",{class:"adps-record-meta"},
  el("a",{href:"https://github.com/"+record.github_login,target:"_blank",rel:"noopener noreferrer",text:"@"+record.github_login}),
  el("span",{text:mine||review?T[record.status]:T[record.kind]}),
  el("time",{datetime:record.created_at||record.published_at,text:new Intl.DateTimeFormat(zh?"zh-CN":"en",{dateStyle:"medium"}).format(new Date(record.created_at||record.published_at))}));
 item.append(heading);
 if(record.parent_id)item.append(el("a",{href:record.document_path+"#discussion-"+record.parent_id,text:zh?"回复原讨论":"In reply to this discussion"}));
 item.append(el("blockquote",{text:record.quote}),el("p",{class:"adps-record-body",text:record.body}));
 if(record.response)item.append(el("div",{class:"adps-review-response"},
  el("strong",{text:T.publicReply}),el("p",{text:record.response})));
 if(record.document_path===location.pathname && !blockMap.has(record.block_id))
  item.append(el("p",{class:"adps-muted",text:T.old}));
 const actions=el("div",{class:"adps-actions"},sourceLink(record));
 const tracked=reviewLinks[record.proposal_id||record.id];
 if(tracked?.revision===record.revision && /^https:\/\/github\.com\/huangjia2019\/agent-design-patterns\/issues\/\d+$/.test(tracked.issue_url||"")) {
  actions.append(el("a",{href:tracked.issue_url,target:"_blank",rel:"noopener noreferrer",text:zh?"GitHub 评审进度":"Review on GitHub"}));
 }
 if(!mine&&!review){
  actions.append(button(T.share,"link",async()=>{
   try{await navigator.clipboard.writeText(location.origin+publicLink(record));message(T.copied);}
   catch{message(location.origin+publicLink(record));}
  }));
  if(record.kind!=="reply"&&record.document_path===location.pathname&&blockMap.has(record.block_id)) {
   actions.append(button(T.reply,"reply",()=>{
    selected={...blockMap.get(record.block_id).record,parent_id:record.proposal_id};
    requestId=crypto.randomUUID();editing=null;composing=true;renderForm();
   },true));
  }
  if(record.applied_url)actions.append(el("a",{href:safeReturnPath(record.applied_url,location.origin),text:T.applied}));
 }
 if(mine&&record.status!=="withdrawn"){
  actions.append(button(T.edit,"pencil",()=>{
   selected={document_path:record.document_path,block_id:record.block_id,block_revision:record.block_revision,quote:record.quote,parent_id:record.parent_id};
   editing={id:record.id,revision:record.revision};requestId=crypto.randomUUID();
   composing=true;renderForm(record);
  },true),button(T.withdraw,"undo-2",async()=>{
   if(!confirm(T.withdrawAsk))return;
   await action(async()=>{await rpc("adps_withdraw",{p_id:record.id});await load(true);message(T.updated);});
  },true));
 }
 item.append(actions);
 if(mine||review)item.append(el("p",{class:"adps-muted",text:T.revision+" "+record.revision+" · "+(record.publish_consent?T.public:T.private)}));
 if(review){
  const response=el("textarea",{rows:3,maxlength:6000,"aria-label":T.response,placeholder:T.response});
  response.value=record.response||"";
  const controls=el("div",{class:"adps-actions"});
  for(const [label,kind,glyph]of[[T.publish,"publish","check"],[T.requestInfo,"needs_info","message-square"],[T.decline,"decline","minus"],[T.hide,"hide","eye-off"]]){
   const b=button(label,glyph,()=>action(async()=>{
    await rpc("adps_review",{p_id:record.id,p_expected_revision:record.revision,p_action:kind,p_response:response.value});
    await load(true);message(T.updated);
   }),true);
   if(kind==="publish"&&!record.publish_consent)b.disabled=true;
   controls.append(b);
  }
  item.append(el("label",{text:T.response},response),controls);
 }
 return item;
}
async function action(fn) {
 if(busy)return;busy=true;host.setAttribute("aria-busy","true");
 const buttons=[...host.querySelectorAll("button:not(.adps-tabs button)")];
 const previous=buttons.map(b=>b.disabled);buttons.forEach(b=>b.disabled=true);
 try{await fn();}catch(error){message(errorText(error,lang),true);}
 finally{busy=false;host.removeAttribute("aria-busy");buttons.forEach((b,i)=>b.disabled=previous[i]);icons();}
}
async function load(reset=false) {
 if(composing){renderForm();return;}
 const run=++generation;
 if(reset){offset=0;records=[];content.replaceChildren(el("p",{class:"adps-muted",text:T.loading}));message("");}
 if((mode==="mine"||mode==="review")&&!identity) {
  content.replaceChildren(el("p",{text:T.loginFirst}),button(T.login,"log-in",signIn,true));icons();return;
 }
 let query;
 if(mode==="mine")query=client.from("adps_proposals").select("*").eq("author_id",identity.id).order("updated_at",{ascending:false}).order("id");
 else if(mode==="review") query=client.from("adps_proposals").select("*").in("status",reviewScope==="pending"?["pending","needs_info"]:reviewScope==="published"?["published"]:["pending","needs_info","published","declined","withdrawn"]).order("created_at").order("id");
 else {
  query=client.from("adps_discussions").select("*").order("published_at",{ascending:false}).order("proposal_id");
  if(!workspace)query=query.in("document_path",[location.pathname,counterpart(location.pathname)]);
  if(mode==="passage"&&selected)query=query.eq("document_path",selected.document_path).eq("block_id",selected.block_id);
 }
 const {data,error}=await query.range(offset,offset+pageSize-1);
 if(run!==generation)return;
 if(error){content.replaceChildren(button(T.refresh,"rotate-cw",()=>load(true),true));message(errorText(error,lang),true);icons();return;}
 records.push(...data);offset+=data.length;content.replaceChildren();
 if(mode==="review"){
  const filter=el("select",{"aria-label":zh?"审核状态":"Review status",onchange:event=>{reviewScope=event.target.value;load(true);}});
  for(const [value,label]of[["pending",zh?"待审与待补充":"Pending and needs information"],["published",zh?"已公开":"Published"],["all",zh?"全部状态":"All statuses"]])filter.append(el("option",{value,text:label}));
  filter.value=reviewScope;content.append(filter);
 }
 if(!workspace&&mode==="article"&&blockMap.size)content.append(discussionComposer());
 if(!workspace&&selected&&mode==="passage"){
  content.append(button(T.suggest,"square-pen",()=>{editing=null;composing=true;renderForm();},true));
 }
 if(!records.length)content.append(el("p",{class:"adps-empty",text:mode==="mine"?T.noMine:mode==="review"?T.noReview:T.empty}));
 records.forEach(r=>content.append(card(r,mode==="review",mode==="mine")));
 if(data.length===pageSize)content.append(button(T.more,"chevron-down",()=>load(false),true));
 if(!workspace)content.append(el("a",{class:"adps-workspace-link",href:rootPath+"/contribute/",text:T.title}));
 icons();
}
function renderForm(initial=null) {
 ++generation;
 if(!selected){composing=false;content.replaceChildren(el("p",{text:T.noPassage}));return;}
 const saved=getDraft();
 const same=saved&&saved.document_path===selected.document_path&&saved.block_id===selected.block_id
   &&saved.parent_id===selected.parent_id&&saved.editing?.id===editing?.id&&saved.editing?.revision===editing?.revision;
 const data=initial||(same?saved:{});
 if(same&&!initial)requestId=saved.request_id;
 const form=el("form",{class:"adps-form"});
 const body=el("textarea",{rows:8,maxlength:12000,required:"","aria-label":T.body});
 body.value=data.body||"";
 const kind=el("select",{"aria-label":T.kind});
 for(const k of["correction","experience","question"])kind.append(el("option",{value:k,text:T[k]}));
 kind.value=data.kind||"correction";
 if(selected.parent_id)kind.disabled=true;
 const consent=el("input",{type:"checkbox"});consent.checked=Boolean(data.publish_consent);
 const count=el("span",{class:"adps-muted",text:body.value.length+" / 12,000"});
 function save() {
  count.textContent=body.value.length+" / 12,000";
  safeStore(draftKey,JSON.stringify(draftValue(body.value,consent.checked,selected.parent_id?"reply":kind.value)));
 }
 body.addEventListener("input",save);consent.addEventListener("change",save);kind.addEventListener("change",save);
 form.append(button(T.back,"arrow-left",()=>{save();composing=false;editing=null;load(true);},true),
  el("label",{text:T.quote}),el("blockquote",{text:selected.quote}),
  el("label",{text:T.kind},kind),el("label",{text:T.body},body),count,
  el("label",{class:"adps-consent"},consent,el("span",{text:T.consent})),
  el("p",{class:"adps-muted",text:T.onlyEditor}));
 const submit=el("button",{type:"submit",class:"adps-command adps-primary"},icon(identity?"send":"log-in"),el("span",{text:identity?(editing?T.save:T.submit):T.login}));
 form.append(submit);
 form.addEventListener("submit",event=>{
  event.preventDefault();save();
  if(!identity){signIn();return;}
  const draft=draftValue(body.value,consent.checked,selected.parent_id?"reply":kind.value);
  const invalid=validateDraft(draft);
  if(invalid){message(errorText(invalid,lang),true);return;}
  action(async()=>{
   if(editing)await rpc("adps_edit",{p_id:editing.id,p_expected_revision:editing.revision,p_body:draft.body,p_publish_consent:draft.publish_consent});
   else await rpc("adps_submit",{p_document_path:draft.document_path,p_block_id:draft.block_id,p_block_revision:draft.block_revision,
    p_quote:draft.quote,p_body:draft.body,p_kind:draft.kind,p_publish_consent:draft.publish_consent,p_request_id:requestId,p_parent_id:draft.parent_id||null});
   clearDraft();requestId=crypto.randomUUID();composing=false;editing=null;mode="mine";renderTabs();await load(true);message(T.received);
  });
 });
 content.replaceChildren(form);icons();
}
async function attachPassages(article) {
 if(!article)return;
 const response=await fetch(location.pathname+"discussion-blocks.json",{cache:"no-cache"});
 if(!response.ok)return;
 manifest=await response.json();
 const queues=new Map();
 for(const record of manifest.blocks){
  const key=record.tag+"\n"+record.quote;
  if(!queues.has(key))queues.set(key,[]);
  queues.get(key).push(record);
 }
 for(const node of collectBlocks(article)){
  const record=queues.get(node.tagName.toLowerCase()+"\n"+normalize(node.textContent))?.shift();
  if(!record)continue;
  record.document_path=location.pathname;record.block_revision=record.revision;
  blockMap.set(record.block_id,{node,record});
  if(!node.id)node.id=record.block_id;
  else if(node.id!==record.block_id)node.before(el("span",{id:record.block_id,class:"adps-source-anchor","aria-hidden":"true"}));
  node.classList.add("adps-passage");
  const b=button(T.suggest,"message-square",()=>{
   selected={...record};requestId=crypto.randomUUID();editing=null;mode="passage";composing=true;show();
  });
  b.classList.add("adps-passage-button");node.append(b);
 }
 if(location.hash.startsWith("#discussion-")){
  const id=location.hash.slice("#discussion-".length);
  if(/^[0-9a-f-]{36}$/.test(id)){
   const {data}=await client.from("adps_discussions").select("*").eq("proposal_id",id).maybeSingle();
   if(data&&[location.pathname,counterpart(location.pathname)].includes(data.document_path)){
    selected=blockMap.get(data.block_id)?.record||null;mode="article";show();
    setTimeout(()=>{if(!document.getElementById("discussion-"+id))content.prepend(card(data));document.getElementById("discussion-"+id)?.scrollIntoView({block:"center"});icons();},700);
   }
  }
 }
 // Only published records contribute to passage badges.
 const {data:counts}=await client.rpc("adps_public_counts",{p_document_path:location.pathname});
 for(const row of counts||[]){
  const entry=blockMap.get(row.block_id);
  if(!entry)continue;
  const b=entry.node.querySelector(".adps-passage-button");
  b.classList.add("has-discussion");b.title=T.viewDiscussion+" ("+row.count+")";b.setAttribute("aria-label",b.title);
  b.onclick=null;
  const old=b.cloneNode(true);
  old.addEventListener("click",()=>{selected={...entry.record};mode="passage";composing=false;show();});b.replaceWith(old);
 }
 let selectionButton;
 document.addEventListener("selectionchange",()=>{
  selectionButton?.remove();selectionButton=null;
  const selection=getSelection();
  if(!selection||selection.isCollapsed||!selection.rangeCount)return;
  const range=selection.getRangeAt(0);
  const node=(range.commonAncestorContainer.nodeType===1?range.commonAncestorContainer:range.commonAncestorContainer.parentElement)?.closest(".adps-passage");
  if(!node)return;
  const entry=[...blockMap.values()].find(x=>x.node===node);
  const quote=normalize(selection.toString());
  if(!entry||!quote||!entry.record.quote.includes(quote))return;
  const box=range.getBoundingClientRect();
  const selectedRecord={...entry.record,quote};
  selectionButton=button(T.suggest,"square-pen",()=>{
   selected=selectedRecord;requestId=crypto.randomUUID();editing=null;mode="passage";composing=true;
   selectionButton?.remove();show();
  },true);
  selectionButton.classList.add("adps-selection");
  selectionButton.style.top=Math.max(8,box.top-42)+"px";
  selectionButton.style.left=Math.max(8,Math.min(innerWidth-180,box.left))+"px";
  selectionButton.addEventListener("mousedown",event=>event.preventDefault());
  document.body.append(selectionButton);icons();
 });
 icons();
}
async function start() {
 const response=await fetch("/js/contributions/config.json",{cache:"no-cache"});
 if(!response.ok)return;
 const config=await response.json();
 if(!config.enabled)return;
 try {
  const response=await fetch("/js/contributions/review-links.json",{cache:"no-cache"});
  if(response.ok)reviewLinks=await response.json();
 }catch{reviewLinks={};}
 const vendors=await (await fetch("/js/vendor/manifest.json")).json();
 await script(vendors["@supabase/supabase-js"]);await script(vendors.lucide);
 const css=el("link",{rel:"stylesheet",href:"/css/contributions.css"});document.head.append(css);
 client=window.supabase.createClient(config.url,config.publishableKey,{auth:{
  flowType:"pkce",detectSessionInUrl:false,persistSession:true,autoRefreshToken:true,storageKey:"adps.auth.v1"
 }});
 makeHost();
 if(callback){
  const url=new URL(location.href);
  const code=url.searchParams.get("code");
  history.replaceState(null,"",location.pathname);
  if(!code){message(T.loginFail,true);return;}
  const {error}=await client.auth.exchangeCodeForSession(code);
  if(error){message(T.loginFail,true);return;}
  location.replace(safeReturnPath(stored("adps.return"),location.origin));return;
 }
 await refreshIdentity();
 client.auth.onAuthStateChange(()=>setTimeout(refreshIdentity,0));
 if(!workspace) {
  const article=document.querySelector("[data-adps-discussion-root],article.essay");
  await attachPassages(article);attachEntrances(article);
 }
 const draft=getDraft();
 if(draft&&draft.document_path===location.pathname) {
  selected={...draft};editing=draft.editing;requestId=draft.request_id;composing=true;show();message(T.draftSaved);
 }else if(workspace)await load(true);
}
start().catch(()=>{
 const target=document.querySelector("#adps-contributions");
 if(target)target.textContent=T.error;
});
