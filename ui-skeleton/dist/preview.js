const device=document.getElementById('device');
const slot=document.getElementById('device-slot');
const stage=document.getElementById('preview-stage');
const size=document.getElementById('device-size');
const zoom=document.getElementById('preview-zoom');
const sizes={standard:[390,844],large:[430,932],compact:[375,812]};
const initialParams=new URLSearchParams(location.search);
if(Object.hasOwn(sizes,initialParams.get('device')))size.value=initialParams.get('device');
if(['fit','1','0.75','0.5'].includes(initialParams.get('zoom')))zoom.value=initialParams.get('zoom');
function previewUrl(){
  const url=new URL('preview.html',location.href);
  if(size.value!=='standard')url.searchParams.set('device',size.value);
  if(zoom.value!=='fit')url.searchParams.set('zoom',zoom.value);
  return url;
}
function resizePreview(){
  const [w,h]=sizes[size.value];
  const width=w+24,height=h+24;
  const toolbar=document.querySelector('.preview-toolbar').getBoundingClientRect().height;
  const freeWidth=Math.max(160,stage.clientWidth-(innerWidth>1050?520:40));
  const freeHeight=Math.max(240,innerHeight-toolbar-95);
  const scale=zoom.value==='fit'?Math.min(1,freeWidth/width,freeHeight/height):Number(zoom.value);
  device.style.width=`${width}px`;device.style.height=`${height}px`;device.style.transform=`scale(${scale})`;
  slot.style.width=`${width*scale}px`;slot.style.height=`${height*scale}px`;
}
function updatePreview(){resizePreview();history.replaceState(null,'',previewUrl());}
size.addEventListener('change',updatePreview);zoom.addEventListener('change',updatePreview);window.addEventListener('resize',resizePreview);resizePreview();
let feedbackTimer;
document.getElementById('copy-preview').addEventListener('click',async()=>{
  const feedback=document.getElementById('preview-feedback');
  const url=previewUrl().href;
  try{await navigator.clipboard.writeText(url);feedback.textContent='Preview link copied.';}catch{feedback.textContent=`Copy this link: ${url}`;}
  feedback.hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>{feedback.hidden=true;},6000);
});
