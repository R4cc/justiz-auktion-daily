// Install the facade synchronously; route navigation can await the module loader.
(() => {
  const source=document.currentScript?.dataset.module||'/modules/page-assets.js';
  let pending;
  const ready=()=>pending||(pending=import(source).then(({createPageAssets})=>createPageAssets(document,location)).catch(error=>{pending=null;throw error;}));
  window.pageAssets={load:async path=>(await ready()).load(path),prefetch:async path=>(await ready()).prefetch(path)};
  void ready().catch(()=>{});
  for(const name of ['pointerover','focusin'])document.addEventListener(name,event=>{
    const link=event.target.closest?.('a[data-page]');
    if(!link||navigator.connection?.saveData)return;
    const url=new URL(link.href,location.href);
    if(url.origin===location.origin)void window.pageAssets.prefetch(url.pathname).catch(()=>{});
  });
})();
