const device=document.getElementById('device');
const slot=document.getElementById('device-slot');
const stage=document.getElementById('preview-stage');
const size=document.getElementById('device-size');
const zoom=document.getElementById('preview-zoom');
const sizes={standard:[390,844],large:[430,932],compact:[375,812]};
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
size.addEventListener('change',resizePreview);zoom.addEventListener('change',resizePreview);window.addEventListener('resize',resizePreview);resizePreview();
let feedbackTimer;
document.getElementById('copy-preview').addEventListener('click',async()=>{
  const feedback=document.getElementById('preview-feedback');
  const url=new URL('preview.html',location.href).href;
  try{await navigator.clipboard.writeText(url);feedback.textContent='Preview link copied.';}catch{feedback.textContent=`Copy this link: ${url}`;}
  feedback.hidden=false;clearTimeout(feedbackTimer);feedbackTimer=setTimeout(()=>{feedback.hidden=true;},6000);
});
