import './styles.css';
const $ = s => document.querySelector(s);
const state = { mode:'time', profile:'car_fastest', limit:10, point:null, name:'上海静安寺' };
let map, marker, polygon, revision=0, searchRevision=0;
const options={time:[[10,'10 分钟'],[20,'20 分钟'],[30,'30 分钟'],[45,'45 分钟']],distance:[[1000,'1 公里'],[3000,'3 公里'],[5000,'5 公里'],[10000,'10 公里']]};
const label=p=>({car_fastest:'驾车',bike_fastest:'骑行',foot_fastest:'步行'}[p]);
const lightMapStyle=[
  {featureType:'background',elementType:'all',stylers:{color:'#f5f3edff'}},
  {featureType:'land',elementType:'all',stylers:{color:'#f5f3edff'}},
  {featureType:'water',elementType:'all',stylers:{color:'#e5efecff'}},
  {featureType:'green',elementType:'all',stylers:{color:'#edf2eaff'}},
  {featureType:'building',elementType:'all',stylers:{color:'#efede6ff'}},
  {featureType:'road',elementType:'geometry',stylers:{color:'#ffffffd9'}},
  {featureType:'road',elementType:'geometry.stroke',stylers:{color:'#e2e4deff'}},
  {featureType:'highway',elementType:'geometry',stylers:{color:'#fbfaf5ff'}},
  {featureType:'highway',elementType:'geometry.stroke',stylers:{color:'#dedfd8ff'}},
  {featureType:'arterial',elementType:'geometry',stylers:{color:'#fdfcf8ff'}},
  {featureType:'local',elementType:'geometry',stylers:{color:'#ffffffb8'}},
  {featureType:'railway',elementType:'geometry',stylers:{color:'#d8dbd5ff'}},
  {featureType:'poilabel',elementType:'labels.text.fill',stylers:{color:'#89938cff'}},
  {featureType:'districtlabel',elementType:'labels.text.fill',stylers:{color:'#77847cff'}},
  {featureType:'road',elementType:'labels.text.fill',stylers:{color:'#a0a8a1ff'}}
];
function applyLightMapStyle(){
  const config={styleJson:lightMapStyle};
  if(typeof map.setMapStyle==='function')map.setMapStyle(config);
  else if(typeof map.setMapStyleV2==='function')map.setMapStyleV2(config);
}
$('#app').innerHTML=`<main class="shell"><section class="map-panel"><div id="map" class="map"></div><div class="map-hint">点击地图选择起点 · 沿真实路网计算</div><div id="map-status" class="map-status">正在加载百度地图…</div></section><aside class="sidebar"><div class="eyebrow">BAIDU MAP · REACHABILITY</div><h1>可达范围</h1><p class="intro">从这里出发，生活可以延伸多远？<br>探索真实道路上的时间与距离。</p><label class="field-label" for="search">搜索起点</label><div class="search-wrap"><input id="search" disabled placeholder="搜索地点，如上海静安寺" autocomplete="off"/><div id="suggestions" class="suggestions"></div></div><div id="selected-point" class="selected-point"></div><div class="section"><div class="field-label">出行方式</div><div id="profiles" class="segmented"><button data-profile="car_fastest" class="active">驾车</button><button data-profile="bike_fastest">骑行</button><button data-profile="foot_fastest">步行</button></div></div><div class="section"><div class="field-label">范围类型</div><div id="modes" class="segmented"><button data-mode="time" class="active">等时圈</button><button data-mode="distance">等距圈</button></div></div><div class="section"><div id="limit-label" class="field-label"></div><div id="limits" class="chips"></div></div><button id="calculate" disabled class="primary-button">生成可达范围</button><div id="notice" class="notice" role="status"></div><div class="result-card"><div class="result-title">计算结果</div><div id="result-summary" class="result-summary">等待地图加载</div><div class="legend"><span></span>百度 WebAPI · 真实路网可达区域</div><div id="metrics" class="selected-point"></div></div><div class="api-note"><strong>真实服务已接入</strong><p>支持驾车、骑行与步行。驾车等时圈最多 45 分钟。等距圈按道路距离计算，并非直线半径。地图轮廓经过轻量平滑以改善视觉效果。</p></div></aside></main>`;
function notice(text,type=''){ $('#notice').textContent=text; $('#notice').className=`notice ${type}`; }
function invalidate(){revision++; if(polygon){map.removeOverlay(polygon);polygon=null;} $('#result-summary').textContent='条件已更新，点击生成可达范围';$('#metrics').textContent='';notice('');}
function renderLimits(){ $('#limit-label').textContent=state.mode==='time'?'最长用时':'道路距离';$('#limits').innerHTML=options[state.mode].map(([n,t])=>`<button data-limit="${n}" class="${state.limit===n?'active':''}">${t}</button>`).join(''); }
function smoothClosedPath(points){
  if(points.length<8)return points;
  const smoothed=[];
  for(let i=0;i<points.length;i++){
    const a=points[i];
    const b=points[(i+1)%points.length];
    smoothed.push({lng:a.lng*0.75+b.lng*0.25,lat:a.lat*0.75+b.lat*0.25});
    smoothed.push({lng:a.lng*0.25+b.lng*0.75,lat:a.lat*0.25+b.lat*0.75});
  }
  return smoothed;
}
function setPoint(point,name='地图选点'){invalidate();state.point=point;state.name=name;$('#selected-point').textContent=`${name} · ${point.lng.toFixed(6)}, ${point.lat.toFixed(6)}`;if(marker)map.removeOverlay(marker);marker=new BMap.Marker(point);map.addOverlay(marker);}
$('#limits').onclick=e=>{const b=e.target.closest('button');if(b){state.limit=Number(b.dataset.limit);invalidate();renderLimits();}};
$('#profiles').onclick=e=>{const b=e.target.closest('button');if(!b)return;state.profile=b.dataset.profile;invalidate();$('#profiles').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));};
$('#modes').onclick=e=>{const b=e.target.closest('button');if(!b)return;state.mode=b.dataset.mode;state.limit=state.mode==='time'?10:3000;invalidate();$('#modes').querySelectorAll('button').forEach(x=>x.classList.toggle('active',x===b));renderLimits();};
async function calculate(){if(!map||!state.point)return;const version=revision;const request={...state,point:{lng:state.point.lng,lat:state.point.lat}};$('#calculate').disabled=true;$('#calculate').textContent='正在计算…';notice('正在沿真实路网计算可达范围…');const start=performance.now();try{const res=await fetch('/api/reachability',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:AbortSignal.timeout(35000)});const data=await res.json();if(!res.ok)throw new Error(data.message||'计算失败');if(version!==revision)return;if(data.mock)throw new Error('服务处于模拟模式，请启用真实接口');const rawPoints=data.points;const points=rawPoints.map(p=>new BMap.Point(p.lng,p.lat));const displayPoints=smoothClosedPath(rawPoints).map(p=>new BMap.Point(p.lng,p.lat));if(polygon)map.removeOverlay(polygon);polygon=new BMap.Polygon(displayPoints,{strokeColor:'#2e6f5e',strokeWeight:2,strokeOpacity:0.82,strokeLineCap:'round',strokeLineJoin:'round',fillColor:'#6aa892',fillOpacity:0.3,enableParse:false});map.addOverlay(polygon);map.setViewport([...points,state.point],{margins:[55,55,55,55]});$('#result-summary').textContent=`${request.name} · ${label(request.profile)} · ${request.limit}${request.mode==='time'?' 分钟':' 米'}`;$('#metrics').textContent=`${rawPoints.length} 个真实边界点 · ${((performance.now()-start)/1000).toFixed(1)} 秒`;notice(`${request.mode==='time'?'等时圈':'等距圈'}已生成`,'success');}catch(e){if(version===revision)notice(e.name==='TimeoutError'?'请求超时，请重试':e.message,'error');}finally{$('#calculate').disabled=false;$('#calculate').textContent='生成可达范围';}}
$('#calculate').onclick=calculate;
let timer;
$('#search').oninput=()=>{clearTimeout(timer);const id=++searchRevision;const keyword=$('#search').value.trim();$('#suggestions').replaceChildren();if(!keyword||!map)return;timer=setTimeout(()=>{const local=new BMap.LocalSearch(map,{onSearchComplete(results){if(id!==searchRevision)return;$('#suggestions').replaceChildren();if(!results?.getCurrentNumPois()){notice('未找到地点，请补充城市或地址');return;}for(let i=0;i<Math.min(5,results.getCurrentNumPois());i++){const poi=results.getPoi(i);if(!poi.point)continue;const b=document.createElement('button');b.className='suggestion';b.textContent=`${poi.title} · ${poi.address||''}`;b.onclick=()=>{searchRevision++;$('#search').value=poi.title;$('#suggestions').replaceChildren();map.centerAndZoom(poi.point,14);setPoint(poi.point,poi.title);};$('#suggestions').appendChild(b);}}});local.search(keyword);},350);};
document.addEventListener('click',e=>{if(!e.target.closest('.search-wrap'))$('#suggestions').replaceChildren();});
renderLimits();
async function boot(){try{const res=await fetch('/api/config');if(!res.ok)throw new Error('本地服务连接失败');const {browserAk}=await res.json();if(!browserAk)throw new Error('缺少浏览器端 AK');window.__baiduMapReady=()=>{try{map=new BMap.Map('map');applyLightMapStyle();const point=new BMap.Point(121.451754,31.229850);map.centerAndZoom(point,13);map.enableScrollWheelZoom();map.addEventListener('click',e=>{const p=e.latlng||e.point;if(p)setPoint(new BMap.Point(p.lng,p.lat));});$('#map-status').remove();$('#search').disabled=false;$('#calculate').disabled=false;setPoint(point,'上海静安寺');calculate();}catch(e){$('#map-status').textContent=e.message;}};const script=document.createElement('script');script.src=`https://api.map.baidu.com/api?v=4.0&ak=${encodeURIComponent(browserAk)}&callback=__baiduMapReady`;script.onerror=()=>{$('#map-status').textContent='地图加载失败，请检查网络后刷新';};document.head.appendChild(script);}catch(e){$('#map-status').textContent=e.message;}}
boot();
