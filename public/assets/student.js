"use strict";
(() => {
  const $=id=>document.getElementById(id);
  const form=$("post-form"), part=$("part"), textarea=$("post-text"), feedback=$("feedback");
  let type="help";
  function setType(next){
    type=next;
    $("choose-help").classList.toggle("active",type==="help");
    $("choose-display").classList.toggle("active",type==="display");
    $("choose-help").setAttribute("aria-pressed",String(type==="help"));
    $("choose-display").setAttribute("aria-pressed",String(type==="display"));
    textarea.maxLength=type==="help"?1500:4000;
    $("editor-title").textContent=type==="help"?"I need help with — what error do you see?":"I display — paste your C# code";
    textarea.placeholder=type==="help"?"Example: Add-Migration fails with 'Unable to create a DbContext…'\nWhat I tried: ...":"public class Book\n{\n    public int BookID { get; set; }\n}";
    $("prompt-hint").textContent=type==="help"?"Include the exact error message if possible.":"Paste a useful C# snippet. Do not include credentials.";
    updateCounter();
  }
  function updateCounter(){$("counter").textContent=textarea.value.length+" / "+textarea.maxLength;}
  function notice(message,good){feedback.textContent=message;feedback.className="notice show "+(good?"ok":"bad");}
  $("choose-help").addEventListener("click",()=>setType("help"));
  $("choose-display").addEventListener("click",()=>setType("display"));
  textarea.addEventListener("input",updateCounter);
  const requested=new URLSearchParams(location.search).get("part");
  if(["design","models","connect","migration"].includes(requested))part.value=requested;
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    if(!textarea.value.trim()){notice("Please paste an error or code before submitting.",false);return;}
    $("submit").disabled=true;$("submit").textContent="Sending…";feedback.className="notice";
    try{
      const response=await fetch("/api/posts",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({part:part.value,type,text:textarea.value})});
      const body=await response.json();
      if(!response.ok)throw new Error(body.error||"Submission failed.");
      textarea.value="";updateCounter();
      notice("Sent! Your anonymous message will appear on the classroom board.",true);
    }catch(e){notice("Not sent: "+e.message+" Please try again.",false);}
    finally{$("submit").disabled=false;$("submit").textContent="Send to classroom board →";}
  });
})();