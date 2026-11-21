/*
 * The map page shown inside the app (a WebView on phones, an iframe on the web). MapLibre GL JS
 * draws the map; tiles and style come from OpenFreeMap by default: free, no account, no key,
 * commercial use allowed. Another MapLibre style (MapTiler, Mapbox) can replace it through
 * EXPO_PUBLIC_MAP_STYLE_URL. The library is loaded from a pinned version with an integrity hash,
 * so a changed file is refused.
 */
export const DEFAULT_MAP_STYLE = 'https://tiles.openfreemap.org/styles/positron';
export const MAPLIBRE = {
  script: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js',
  scriptIntegrity: 'sha384-SYKAG6cglRMN0RVvhNeBY0r3FYKNOJtznwA0v7B5Vp9tr31xAHsZC0DqkQ/pZDmj',
  style: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css',
  styleIntegrity: 'sha384-MinO0mNliZ3vwppuPOUnGa+iq619pfMhLVUXfC4LHwSCvF9H+6P/KO4Q7qBOYV5V',
} as const;

export interface MapMarker { id: number; latitude: number; longitude: number; label: string; name: string }

export function mapStyleUrl(value: string | undefined = process.env.EXPO_PUBLIC_MAP_STYLE_URL): string {
  const text = (value || '').trim();
  try { if (text && new URL(text).protocol === 'https:') return text; } catch { /* use the default */ }
  return DEFAULT_MAP_STYLE;
}

/** Only real coordinates become markers. */
export function validMarkers(markers: readonly MapMarker[]): MapMarker[] {
  return markers.filter(marker => Number.isSafeInteger(marker.id) && Number.isFinite(marker.latitude) && Number.isFinite(marker.longitude)
    && Math.abs(marker.latitude) <= 90 && Math.abs(marker.longitude) <= 180);
}

/** JSON that is safe inside a <script> element (no closing tags, no HTML comments, no line separators). */
export function scriptJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildMapHtml({ markers, styleUrl = mapStyleUrl(), interactive = true, selected = null, failure, rtl = false }: {
  markers: readonly MapMarker[]; styleUrl?: string; interactive?: boolean; selected?: number | null; failure: string; rtl?: boolean;
}): string {
  const data = { markers: validMarkers(markers), styleUrl, interactive, selected, failure };
  return `<!DOCTYPE html><html dir="${rtl ? 'rtl' : 'ltr'}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<link rel="stylesheet" href="${MAPLIBRE.style}" integrity="${MAPLIBRE.styleIntegrity}" crossorigin="anonymous">
<style>
html,body,#map{margin:0;height:100%;width:100%;background:#F2EEE8;font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
.pin{border:0;border-radius:999px;padding:5px 10px;background:#2D173A;color:#fff;font:700 13px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  box-shadow:0 2px 6px rgba(32,22,38,.28);cursor:pointer;white-space:nowrap;direction:ltr;-webkit-tap-highlight-color:transparent}
.pin.on{background:#fff;color:#2D173A;outline:2px solid #2D173A;transform:scale(1.12);z-index:2}
.fail{position:absolute;inset:0;display:none;align-items:center;justify-content:center;padding:24px;text-align:center;color:#675E6B;font-size:15px}
.maplibregl-ctrl-attrib{font-size:10px}
</style></head><body><div id="map"></div><div class="fail" id="fail"></div>
<script>window.__map=${scriptJson(data)};</script>
<script src="${MAPLIBRE.script}" integrity="${MAPLIBRE.scriptIntegrity}" crossorigin="anonymous"
  onerror="window.__mapFailed&&window.__mapFailed()"></script>
<script>
(function(){
  var d=window.__map, pins={};
  function post(m){var t=JSON.stringify(m);if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(t);else if(window.parent!==window)window.parent.postMessage({mkhaddaMap:t},'*');}
  window.__mapFailed=function(){var f=document.getElementById('fail');f.textContent=d.failure;f.style.display='flex';post({type:'error'});};
  if(!window.maplibregl){window.__mapFailed();return;}
  function mark(id){Object.keys(pins).forEach(function(k){pins[k].className=String(k)===String(id)?'pin on':'pin';});}
  window.__select=function(id,fly){mark(id);var m=d.markers.filter(function(x){return x.id===id;})[0];if(m&&fly&&map)map.easeTo({center:[m.longitude,m.latitude],duration:400});};
  window.addEventListener('message',function(e){var v=e.data&&e.data.mkhaddaSelect;if(typeof v==='number')window.__select(v,true);});
  var map;
  try{
    map=new maplibregl.Map({container:'map',style:d.styleUrl,interactive:d.interactive,attributionControl:{compact:true},
      center:d.markers.length?[d.markers[0].longitude,d.markers[0].latitude]:[55.27,25.2],zoom:d.markers.length===1?14:11,dragRotate:false,pitchWithRotate:false});
  }catch(err){window.__mapFailed();return;}
  map.on('error',function(e){if(e&&e.error&&/style/i.test(String(e.error.message||'')))window.__mapFailed();});
  d.markers.forEach(function(m){
    var el=document.createElement('button');el.className='pin';el.textContent=m.label;el.setAttribute('aria-label',m.name+' '+m.label);
    el.addEventListener('click',function(ev){ev.stopPropagation();mark(m.id);post({type:'select',id:m.id});});
    pins[m.id]=el;new maplibregl.Marker({element:el,anchor:'bottom'}).setLngLat([m.longitude,m.latitude]).addTo(map);
  });
  if(d.markers.length>1){var b=new maplibregl.LngLatBounds();d.markers.forEach(function(m){b.extend([m.longitude,m.latitude]);});map.fitBounds(b,{padding:48,maxZoom:15,duration:0});}
  if(d.selected!==null)mark(d.selected);
  map.on('load',function(){post({type:'ready'});});
})();
</script></body></html>`;
}
