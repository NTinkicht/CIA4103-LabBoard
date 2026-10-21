// Dependency-free teaching aid; intentionally NOT a C# compiler.
const PARAMS = {
  '09a-1':['title'], '09a-2':['year'], '09a-3':['catid'],
  '09a-4':[], '09a-5':[], '09b-1':['minPrice','maxPrice'],
  '09b-2':['bkid'], '09b-3':[]
};
const MAX_ERRORS=15;
export const LABS = [
  {id:'09a-1',label:'Lab 09a · Task 1',title:'Title search',hint:'BookByTitle · name="title"'},
  {id:'09a-2',label:'Lab 09a · Task 2',title:'Year dropdown',hint:'BookByYear · name="year"'},
  {id:'09a-3',label:'Lab 09a · Task 3',title:'Dynamic category list',hint:'BookByCategory · name="catid"'},
  {id:'09a-4',label:'Lab 09a · Task 4',title:'Details hyperlink',hint:'asp-route-bkid'},
  {id:'09a-5',label:'Lab 09a · Task 5',title:'Details and reviews',hint:'Details action · Include()'},
  {id:'09b-1',label:'Lab 09b · Task 1',title:'Price search',hint:'minPrice and maxPrice'},
  {id:'09b-2',label:'Lab 09b · Task 2',title:'Dynamic review search',hint:'ReviewsByBook · bkid'},
  {id:'09b-3',label:'Lab 09b · Task 3',title:'Category links',hint:'asp-route-catid'}
];
export const LANGS=['csharp','razor','html','css','sql'];
export const labById=(id)=>LABS.find(x=>x.id===id);
function lineNumber(code,index){return code.slice(0,index).split('\n').length;}
export function inspect(code,lang='csharp',task='09a-1') {
  if (!code || !code.trim()) return {status:'no-code',issues:[],note:'Paste source code to check it.'};
  if (code.length>10000) return {status:'unsupported',issues:[],note:'Check snippets up to 10,000 characters.'};
  const issues=[];const add=(line,severity,message,rule)=>{
    if(issues.length<MAX_ERRORS && !issues.some(i=>i.line===line&&i.rule===rule))
      issues.push({line,severity,message,rule});
  };
  const htmlish=lang==='razor'||lang==='html';
  const lexical=lang==='csharp'||lang==='razor'||lang==='css';
  if(lexical){
    // C#/Razor fragments may contain HTML and incomplete blocks. Check only
    // obvious delimiter mistakes; never treat a missing project context as error.
    const stack=[];let quote=null,blockComment=false,lineComment=false,line=1;
    let htmlTag=false;
    for(let i=0;i<code.length;i++){
      const c=code[i],n=code[i+1];
      if(c==='\n'){line++;lineComment=false;continue;}
      if(lineComment)continue;
      if(blockComment){if(c==='*'&&n==='/'){blockComment=false;i++;}continue;}
      if(quote){
        if(quote==='"'&&c==='\\'){i++;continue;}
        if(quote==='"'&&c==='"'&&code[i+1]==='"'&&code[i-1]==='@'){i++;continue;}
        if(c===quote){quote=null;}continue;
      }
      if(htmlish){if(c==='<'&&/[A-Za-z/!]/.test(n||''))htmlTag=true;if(htmlTag){if(c==='>')htmlTag=false;continue;}}
      if(c==='/'&&n==='/'){lineComment=true;i++;continue;}
      if(c==='/'&&n==='*'){blockComment=true;i++;continue;}
      if(c==='"'||c==="'"){quote=c;continue;}
      if('([{'.includes(c)){stack.push({ch:c,line});continue;}
      if(')]}'.includes(c)){
        const top=stack.pop(),required={')':'(',']':'[','}':'{'}[c];
        if(!top || top.ch!==required){add(line,'error',`Unexpected or mismatched “${c}” delimiter.`,'delimiter');if(top)stack.push(top);}
      }
    }
    if(blockComment)add(line,'error','Block comment is not closed (missing */).','comment');
    if(quote)add(line,'hint','Possible unclosed string or character literal (snippets may be incomplete).','string');
    if(stack.length&&lang==='csharp'){
      const top=stack.at(-1);add(top.line,'hint','Possible unclosed delimiter “'+top.ch+'”. A partial snippet may be intentional.','unclosed');
    }
  }
  if(lang==='csharp'){
    const lines=code.split(/\r?\n/);
    lines.forEach((raw,i)=>{
      const line=raw.split('//')[0].trim();
      if(!line||line.endsWith(';')||line.endsWith('{')||line.endsWith('}')||line.endsWith(',')||line.endsWith('=>'))return;
      // Only report missing semicolon for standalone, complete-looking statements.
      if(/^(return\s+View\s*\([^;]*\)|(?:await\s+)?\w+\s*\.\s*(?:ToList|SaveChanges|ToListAsync|SaveChangesAsync)\s*\(\s*\))$/.test(line))
        add(i+1,'error','Likely missing semicolon (;) at the end of this statement.','semicolon');
      else if(/\.ToList(?:Async)?\s*\(\s*\)\s*$/.test(line) && i>0 && /^\s*\}/.test(lines.slice(i+1).find(x=>x.trim())||''))
        add(i+1,'hint','A completed LINQ statement usually ends with a semicolon.','semicolon');
    });
  }
  if(htmlish){
    const formOpen=[...code.matchAll(/<form\b([^>]*?)>/gi)];
    const formClosed=[...code.matchAll(/<\/form\s*>/gi)];
    if(formOpen.length>formClosed.length) add(lineNumber(code,formOpen.at(-1).index),'hint','A <form> appears to be missing its </form> closing tag.','form-close');
    const selectOpen=[...code.matchAll(/<select\b([^>]*?)>/gi)];
    const selectClosed=[...code.matchAll(/<\/select\s*>/gi)];
    if(selectOpen.length>selectClosed.length)add(lineNumber(code,selectOpen.at(-1).index),'hint','A <select> appears to be missing </select>.','select-close');
    if(/<form\b[^>]*method\s*=\s*['"]post['"]/i.test(code))
      add(lineNumber(code,code.search(/<form\b/i)),'hint','Search forms in Lab 09 use GET so the selected values appear in the query string.','get-method');
    const names=[...code.matchAll(/\bname\s*=\s*['"]([^'"]+)['"]/gi)].map(m=>({v:m[1],line:lineNumber(code,m.index)}));
    const expected=PARAMS[task]||[];
    if(expected.length && names.length){
      const submitted=names.filter(n=>!['__requestverificationtoken'].includes(n.v.toLowerCase()));
      const missing=expected.filter(p=>!submitted.some(n=>n.v.toLowerCase()===p.toLowerCase()));
      if(missing.length)add(submitted[0]?.line||1,'hint',`Check your form input names. ${task} expects: ${expected.join(', ')}. The controller parameters must match.`,'binding');
    }
    const route=/\basp-route-([\w-]+)\s*=/gi;
    for(const m of code.matchAll(route)){
      if((task==='09a-4'||task==='09b-3') && m[1].toLowerCase() !== (task==='09a-4'?'bkid':'catid'))
        add(lineNumber(code,m.index),'hint',`Check the route parameter. This task uses asp-route-${task==='09a-4'?'bkid':'catid'}.`,'route');
    }
    if((task==='09a-3'||task==='09b-2')&&selectOpen.length && !/asp-items\s*=/i.test(code))
      add(lineNumber(code,selectOpen[0].index),'hint','A database-driven dropdown normally uses asp-items and a SelectList.','selectlist');
  }
  issues.sort((a,b)=>a.line-b.line || (a.severity==='error'?-1:1));
  return {status:issues.some(i=>i.severity==='error')?'potential-errors':issues.length?'suggestions':'no-obvious-issues',issues,
    note:'Teaching aid only. This is not Roslyn, a project build or an ASP.NET runtime test; full compilation in Visual Studio is still required.'};
}

/** Best-effort language detection. It does NOT validate compilation. */
export function detectLanguage(source=''){
 const s=String(source||'').trim();
 if(!s)return 'csharp';
 if(/@(?:model|using|inject|foreach|if|\{)|\basp-(?:action|controller|route-|items)\b|<\/?(?:form|select|input|a)\b[\s\S]*?@[A-Za-z]/i.test(s))return 'razor';
 if(/<\/?[A-Za-z][^>]*>/.test(s))return 'html';
 if(/\b(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*?\b(?:FROM|INTO|SET|WHERE)\b/i.test(s))return 'sql';
 if(/^(?:\s*[.#]?[a-z][\w\s.#:>+~,-]*\s*\{[^}]+\}\s*)+$/i.test(s) && /(?:color|background|margin|padding|display|font|width|height)\s*:/i.test(s))return 'css';
 return 'csharp';
}
/** Retain Lab 09-specific hints when a student types a recognizable task. */
export function taskFromText(task=''){
 if(PARAMS[task])return task;
 const m=String(task).match(/(?:lab\s*)?0?9\s*([ab])\s*[-·,:]?\s*(?:task|exercise|ex|t)\s*#?\s*([1-5])\b/i);
 return m?'09'+m[1].toLowerCase()+'-'+m[2]:'';
}
