const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
const kw=new Set('abstract as async await base bool break byte case catch char checked class const continue decimal default delegate do double else enum event explicit extern false finally fixed float for foreach get global goto if implicit in int interface internal is lock long namespace new null object operator out override params partial private protected public readonly record ref required return sbyte sealed set short sizeof stackalloc static string struct switch this throw true try typeof uint ulong unchecked unsafe ushort using value var virtual void volatile where while yield IActionResult ActionResult Task List SelectList ViewBag model foreach if else await inject layout page'.split(' '));
export function highlightLine(src,lang='csharp'){
 const parts=[];let last=0;
 const rx=/(\/\/.*$|\/\*.*?\*\/|\"(?:\\.|[^\"\\])*\"|'(?:\\.|[^'\\])*'|<\/?[A-Za-z][^>]*>|@[A-Za-z_][\w.]*|\b[A-Za-z_]\w*\b|\b\d+(?:\.\d+)?\b)/gm;
 for(const m of src.matchAll(rx)){
  if(m.index<last)continue;
  parts.push(esc(src.slice(last,m.index)));const v=m[0];let kind='';
  if(v.startsWith('//')||v.startsWith('/*'))kind='comment';
  else if(v.startsWith('"')||v.startsWith("'"))kind='string';
  else if(v[0]==='<')kind='markup';
  else if(v[0]==='@')kind='directive';
  else if(/^\d/.test(v))kind='number';
  else if(kw.has(v))kind='keyword';
  else if(lang==='sql'&&/^(select|from|where|join|on|and|or|order|by|group|insert|update|delete|into)$/i.test(v))kind='keyword';
  parts.push(kind?'<span class="tok-'+kind+'">'+esc(v)+'</span>':esc(v));last=m.index+v.length;
 }
 parts.push(esc(src.slice(last)));return parts.join('');
}
export function renderCode(target,source,lang='csharp',highlighted=[]){
 target.replaceChildren();const marked=new Set(highlighted);
 for(const [i,raw] of String(source||'').replaceAll('\r\n','\n').split('\n').entries()){
  const line=document.createElement('div');line.className='code-line'+(marked.has(i+1)?' flagged':'');
  const num=document.createElement('span');num.className='line-num';num.textContent=String(i+1);
  const text=document.createElement('span');text.className='line-source';text.innerHTML=highlightLine(raw,lang)||' ';
  line.append(num,text);target.append(line);
 }
}