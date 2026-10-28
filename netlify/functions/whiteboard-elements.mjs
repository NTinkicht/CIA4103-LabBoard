// All shared objects use the existing 1000x600 logical canvas.
// Only validated, serializable and bounded values are saved in Netlify Blobs.
export const COLORS=['#24374f','#1976bd','#169b83','#dc8743','#c54b58','#ffffff'];
export const SHAPES=['rectangle','ellipse','line','arrow'];
const integer=(n,a,b)=>Number.isInteger(n)&&n>=a&&n<=b;
export const cleanCell=value=>typeof value==='string'&&value.length<=60&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)?value:null;
export function validateElement(input){
 if(!input||typeof input!=='object'||Array.isArray(input))return null;
 const {type,x,y,w,h,color}=input;
 if(!['shape','text','table'].includes(type)||!integer(x,0,1000)||!integer(y,0,600)||
   !integer(w,0,1000)||!integer(h,0,600)||x+w>1000||y+h>600)return null;
 if(!COLORS.includes(color))return null;
 if(type==='shape'){
  if(!SHAPES.includes(input.shape)||!integer(input.width,2,14))return null;
  if(['rectangle','ellipse'].includes(input.shape)&& (w<8||h<8))return null;
  if(['line','arrow'].includes(input.shape)&&Math.hypot(w,h)<8)return null;
  return {type,x,y,w,h,color,shape:input.shape,width:input.width};
 }
 if(type==='text'){
  if(w<90||h<35||w>750||h>400||!integer(input.fontSize,14,36)||
    typeof input.text!=='string'||!input.text.trim()||input.text.length>500||
    input.text.split('\n').length>12||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(input.text))return null;
  return {type,x,y,w,h,color,fontSize:input.fontSize,text:input.text.trim()};
 }
 if(!integer(input.rows,1,8)||!integer(input.cols,1,8)||w<120||h<70||
   w>850||h>480||w/input.cols<36||h/input.rows<25||
   !Array.isArray(input.cells)||input.cells.length!==input.rows*input.cols||
   input.cells.some(value=>cleanCell(value)===null))return null;
 return {type,x,y,w,h,color,rows:input.rows,cols:input.cols,cells:[...input.cells]};
}
export function validateUpdate(element,updates){
 if(!element||!updates||typeof updates!=='object'||Array.isArray(updates))return null;
 if(element.type==='text'){
  if(Object.keys(updates).some(key=>key!=='text'))return null;
  return validateElement({...element,text:updates.text});
 }
 if(element.type==='table'){
  if(Object.keys(updates).some(key=>key!=='cells'))return null;
  return validateElement({...element,cells:updates.cells});
 }
 return null;
}
export function validateMoved(element,x,y){
 if(!element||!integer(x,0,1000)||!integer(y,0,600))return null;
 return validateElement({...element,x,y});
}
