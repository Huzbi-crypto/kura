(() => {
  const clean = (t) => String(t||'')
    .replace(/\s*[|·—-]\s*(read|chapter|ch\.?|vol\.?|manga|online|free).*$/i,'')
    .replace(/\s*(chapter|ch\.?)\s*[0-9]+(\.[0-9]+)?/gi,'')
    .replace(/\s*[-–—:|]\s*$/g,'').trim();
  const og = (p) => document.querySelector(`meta[property="${p}"], meta[name="${p}"]`)?.content || '';
  const title = clean(og('og:title') || document.title);
  const m = (document.title + ' ' + location.pathname + ' ' + document.body.innerText.slice(0,4000)).match(/(?:chapter|chap|ch\.?|episode)\s*[-_/ ]?\s*([0-9]+(?:\.[0-9]+)?)/i);
  return JSON.stringify({
    docTitle: document.title, ogTitle: og('og:title'), series: title, chapter: m ? m[1] : null,
    crumb: (document.querySelector('nav[aria-label*="read" i], .breadcrumb, nav')?.innerText || '').slice(0,120).replace(/\n+/g,' | '),
    h1: [...document.querySelectorAll('h1')].map(h=>h.innerText.trim()).slice(0,3),
    path: location.pathname
  });
})()