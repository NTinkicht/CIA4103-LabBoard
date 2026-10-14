"use strict";
(()=>{
  const $=id=>document.getElementById(id);
  const labels={design:"1 · Design the data",models:"2 · C# entity models",connect:"3 · EF Core configuration",migration:"4 · Migration and verification"};
  let posts=[],loading=false;
  function time(value){return new Date(value).toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});}
  function issue(message){$("err").textContent=message;$("err").classList.toggle("hidden",!message);}
  function zoom(post){
    $("zoom-title").textContent=post.type==="help"?"I need help with":"I display";
    $("zoom-part").textContent=labels[post.part]||post.part;
    $("zoom-code").textContent=post.text;
    $("zoom-time").textContent="Submitted at "+new Date(post.submittedAt).toLocaleString();
    $("zoom").classList.remove("hidden");$("zoom-close").focus();
  }
  function close(){$("zoom").classList.add("hidden");}
  $("zoom-close").addEventListener("click",close);
  $("zoom").addEventListener("click",event=>{if(event.target===$("zoom"))close();});
  document.addEventListener("keydown",event=>{if(event.key==="Escape")close();});
  function renderColumn(target,records,emptyText){
    const box=$(target);box.replaceChildren();
    if(!records.length){const empty=document.createElement("div");empty.className="empty";empty.textContent=emptyText;box.append(empty);return;}
    for(const post of records){
      const card=document.createElement("button");card.type="button";card.className="post";
      const header=document.createElement("div");header.className="post-top";
      const badge=document.createElement("span");badge.className="part-tag";badge.textContent=labels[post.part]||post.part;
      const timestamp=document.createElement("time");timestamp.className="time-tag";timestamp.dateTime=post.submittedAt;timestamp.textContent=time(post.submittedAt);
      const text=document.createElement("div");text.className="post-text";text.textContent=post.text;
      header.append(badge,timestamp);card.append(header,text);
      card.addEventListener("click",()=>zoom(post));box.append(card);
    }
  }
  function render(){
    const help=posts.filter(p=>p.type==="help"),display=posts.filter(p=>p.type==="display");
    $("total").textContent=posts.length;$("help-count").textContent=help.length;$("display-count").textContent=display.length;
    $("help-badge").textContent=help.length;$("display-badge").textContent=display.length;
    renderColumn("help-posts",help,"No help requests yet. New posts appear here.");
    renderColumn("display-posts",display,"No code shared yet. New posts appear here.");
  }
  async function refresh(){
    if(loading||!$("zoom").classList.contains("hidden"))return;
    loading=true;
    try{
      const search=new URLSearchParams({part:$("filter-part").value,since:$("filter-time").value});
      const response=await fetch("/api/posts?"+search.toString(),{cache:"no-store"});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Unable to load messages.");
      posts=Array.isArray(body.posts)?body.posts:[];render();issue("");
      $("updated").textContent="Updated "+new Date().toLocaleTimeString([],{hour:"2-digit",minute:"2-digit",second:"2-digit"});
    }catch(e){issue("Could not load posts: "+e.message+" Check deployment and refresh.");}
    finally{loading=false;}
  }
  $("refresh").addEventListener("click",refresh);
  $("filter-part").addEventListener("change",refresh);
  $("filter-time").addEventListener("change",refresh);
  $("csv").addEventListener("click",()=>{
    const query=new URLSearchParams({part:$("filter-part").value,since:$("filter-time").value,format:"csv"});
    location.href="/api/posts?"+query.toString();
  });
  $("present").addEventListener("click",async()=>{
    const active=document.body.classList.toggle("projector");
    $("present").textContent=active?"Exit presentation mode":"Presentation mode";
    if(active&&document.documentElement.requestFullscreen){try{await document.documentElement.requestFullscreen();}catch{}}
    if(!active&&document.fullscreenElement&&document.exitFullscreen){try{await document.exitFullscreen();}catch{}}
  });
  refresh();setInterval(refresh,5000);
})();