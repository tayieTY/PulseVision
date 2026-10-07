import * as THREE from 'three';
import { OrbitControls } from '../vendor/OrbitControls.js';
import { createSignalSource, assetSeed } from './signals.js';

// Presentation model only. Asset coordinates/routes do not describe real utilities.
const TYPES = {
  water: { name: '供水管网', color: '#54d9ef', icon: '◉' },
  gas: { name: '燃气管网', color: '#ffbd69', icon: '◇' },
  heat: { name: '供热管网', color: '#ed8dab', icon: '≈' },
  drain: { name: '排水管网', color: '#7fa3ff', icon: '≋' },
  bridge: { name: '桥梁设施', color: '#87e1b8', icon: '⌒' },
};
const ASSETS = [
  { id: 'CC-W01', name: '人民大街供水示意段', type: 'water', location: '人民大街 / 南关区场景', points: [[125.325,43.893],[125.325,43.870],[125.325,43.850],[125.325,43.830],[125.325,43.813]], initial: 'normal' },
  { id: 'CC-G02', name: '卫星路燃气示意段', type: 'gas', location: '卫星路 / 南部城区场景', points: [[125.278,43.817],[125.302,43.817],[125.325,43.817],[125.346,43.817],[125.362,43.817]], initial: 'warning' },
  { id: 'CC-H03', name: '南湖大路供热示意段', type: 'heat', location: '南湖大路 / 朝阳区场景', points: [[125.274,43.835],[125.290,43.835],[125.310,43.835],[125.327,43.835],[125.353,43.835]], initial: 'normal' },
  { id: 'CC-D04', name: '伊通河沿岸排水示意段', type: 'drain', location: '伊通河 / 沿河街区场景', points: [[125.373,43.893],[125.369,43.877],[125.368,43.858],[125.366,43.849],[125.360,43.830],[125.355,43.807]], initial: 'normal' },
  { id: 'CC-B05', name: '长春大桥', type: 'bridge', location: '解放大路—吉林大路 / 示意桥位', points: [[125.361,43.863],[125.379,43.863]], initial: 'normal', extension: true },
  { id: 'CC-B06', name: '南湖大桥', type: 'bridge', location: '南湖公园 / 示意桥位', points: [[125.298,43.835],[125.309,43.835]], initial: 'normal', extension: true },
];
const SCENARIOS = {
  construction: { name: '施工扰动候选', description: '合成信号出现连续冲击和宽频能量增强。建议核对施工许可、确认现场位置，再安排人员核查。' },
  traffic: { name: '车辆通行背景', description: '合成信号呈短时通过特征，本次归为正常背景；记录已保留，无需生成风险工单。' },
  unknown: { name: '未知振动候选', description: '该合成事件暂未归入已知类别。保留信号片段并交由人员复核，不自动认定事故。' },
};
const $ = (id) => document.getElementById(id);
const state = { selected: ASSETS[1], filter: 'all', search: '', paused: false, time: 0, orders: [], serial: 0, signals: [], buildings: true, labels: true, view: '3d' };
let scene, renderer, camera, controls, buildingGroup, selectionRing;
let raycaster, cursor, viewport, dragStart, cameraTween;
const objects = new Map();
const labels = [];
const clickable = [];
const markers = [];
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const timestamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const statusText = (asset) => ({normal:'正常',warning:'待复核',reviewed:'已复核',ordered:'工单处理中',closed:'已闭环'}[asset.status]);
const statusClass = (asset) => ['warning','ordered'].includes(asset.status) ? 'warning' : asset.status === 'reviewed' ? 'reviewed' : 'normal';

function lengthKm(points) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    sum += Math.hypot((b[0]-a[0])*111.32*Math.cos((a[1]+b[1])*Math.PI/360), (b[1]-a[1])*111.32);
  }
  return sum;
}
function makeEvent(asset, kind) {
  const mid = asset.points[Math.floor(asset.points.length / 2)];
  return { kind, at: timestamp(), signalStart: state.time, chainage: Math.round(asset.length * 1000 * .52), point: mid, reviewedAt: null };
}
function resetAssetStates() {
  for (const asset of ASSETS) {
    asset.length = lengthKm(asset.points);
    asset.status = asset.initial;
    asset.event = asset.initial === 'warning' ? makeEvent(asset, 'construction') : null;
    if (asset.event) asset.event.signalStart = -8;
  }
}
resetAssetStates();

function toast(message) {
  $('toast').textContent = message;
  $('toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('toast').classList.remove('show'), 3400);
}
function matches(asset) {
  return (state.filter === 'all' || state.filter === asset.type) && `${asset.name}${asset.id}${asset.location}`.toLowerCase().includes(state.search.toLowerCase());
}
function renderAssets() {
  const filtered = ASSETS.filter(matches);
  $('asset-list').replaceChildren(...filtered.map(asset => {
    const el = document.createElement('button');
    el.className = `asset-item ${state.selected.id === asset.id ? 'selected' : ''}`;
    el.dataset.id = asset.id;
    el.style.setProperty('--asset-color', TYPES[asset.type].color);
    el.setAttribute('aria-pressed', String(state.selected.id === asset.id));
    el.innerHTML = `<div class="row"><span class="asset-icon">${TYPES[asset.type].icon}</span><strong>${asset.name}</strong></div><div class="asset-sub"><span>${asset.id} · ${asset.extension ? '扩展场景' : '模拟管段'}</span><span class="tiny-status ${statusClass(asset)}">${statusText(asset)}</span></div>`;
    el.addEventListener('click', () => selectAsset(asset, true));
    return el;
  }));
  $('asset-count').textContent = String(filtered.length).padStart(2, '0');
  $('no-assets').hidden = filtered.length > 0;
  $('total-length').textContent = ASSETS.filter(a => a.type !== 'bridge').reduce((sum,a)=>sum+a.length,0).toFixed(1);
  $('alert-count').textContent = String(ASSETS.filter(a => a.status === 'warning').length).padStart(2,'0');
  objects.forEach((obj,id) => { obj.group.visible = matches(ASSETS.find(a=>a.id===id)); });
  labels.forEach(l => { l.visible = !l.asset || matches(l.asset); });
}
function renderDetail() {
  const a = state.selected, type = TYPES[a.type], event = a.event;
  $('detail-id').textContent = `${a.id} / ${a.extension ? 'EXTENSION SCENE' : 'FIBER NETWORK'}`;
  $('detail-name').textContent = a.name;
  $('detail-location').textContent = a.location;
  $('detail-type').textContent = type.name;
  $('detail-length').textContent = `示意长度 ${a.length.toFixed(2)} km`;
  $('detail-status').textContent = statusText(a);
  $('detail-status').className = `status ${statusClass(a)}`;
  $('event-type').textContent = event ? SCENARIOS[event.kind].name : '正常背景';
  $('chainage').textContent = event ? `K${Math.floor(event.chainage/1000)}+${String(event.chainage%1000).padStart(3,'0')}` : '—';
  $('event-time').textContent = event ? event.at : '无候选事件';
  $('event-card').className = `event-card ${statusClass(a)}`;
  $('event-card').replaceChildren();
  const title = document.createElement('strong');
  title.textContent = event ? SCENARIOS[event.kind].name : '正常背景监测';
  const description = document.createElement('div');
  description.textContent = event ? SCENARIOS[event.kind].description : '当前演示信号为低幅背景。可在场景播放器中触发一次事件，查看感知、复核与工单流程。';
  if (a.extension) description.textContent += ' 桥梁页面仅演示振动观测，不据此判断结构病害。';
  $('event-card').append(title,description);
  $('review').disabled = a.status !== 'warning';
  $('review').textContent = a.status === 'reviewed' ? '✓ 已人工复核' : '标记已复核';
  $('create-order').disabled = a.status !== 'reviewed';
  $('create-order').textContent = a.status === 'ordered' ? '工单已生成' : '生成模拟工单';
  renderWorkflow(); renderOrders(); updateVisuals();
}
function renderWorkflow() {
  const a = state.selected;
  const completed = a.status === 'closed' ? 4 : a.status === 'ordered' ? 3 : a.status === 'reviewed' ? 2 : a.event ? 1 : 0;
  $('workflow').querySelectorAll('[data-step]').forEach((el,i) => {
    el.classList.toggle('done', i < completed);
    el.classList.toggle('active', i === completed && completed < 4);
  });
}
function renderOrders() {
  const orders = state.orders.filter(o => o.assetId === state.selected.id);
  $('orders').replaceChildren();
  if (!orders.length) { $('orders').textContent = '暂无模拟工单 · 先触发事件并完成人工复核'; return; }
  for (const order of orders.slice().reverse()) {
    const el = document.createElement('div'); el.className = 'order-entry';
    const title = document.createElement('strong'); title.textContent = `${order.id} / ${order.complete ? '已闭环' : '模拟待处理'}`;
    const detail = document.createElement('span'); detail.textContent = `${order.createdAt} · ${order.eventName} · K${Math.floor(order.chainage/1000)}+${String(order.chainage%1000).padStart(3,'0')}`;
    el.append(title,detail);
    if (!order.complete) {
      const button = document.createElement('button');button.textContent = '模拟现场确认并关闭';
      button.addEventListener('click', () => {
        order.complete = true; order.closedAt = timestamp();
        ASSETS.find(a=>a.id===order.assetId).status = 'closed';
        renderAssets();renderDetail();toast('模拟工单已闭环，处置记录已保留');
      });el.append(document.createElement('br'),button);
    }
    $('orders').append(el);
  }
}
function selectAsset(asset, focus) {
  state.selected = asset;
  renderAssets();renderDetail();
  if (focus && camera && controls) {
    const center = objects.get(asset.id).center.clone();
    const offset = state.view === '2d' ? new THREE.Vector3(0,98,.03) : new THREE.Vector3(40,63,69);
    animateCamera(center.clone().add(offset),center);
  }
}
function updateVisuals() {
  objects.forEach((object,id) => {
    const a = ASSETS.find(a=>a.id===id);
    const active = a.id === state.selected.id;
    const alert = a.status === 'warning';
    object.line.material.opacity = active ? 1 : .75;
    object.line.material.emissiveIntensity = active ? 1.5 : .6;
    object.line.material.color.set(alert ? '#ffbd69' : TYPES[a.type].color);
    object.marker.material.color.set(alert ? '#ffbd69' : TYPES[a.type].color);
    object.halo.material.color.set(alert ? '#ffbd69' : TYPES[a.type].color);
    object.beacon.visible = alert;
  });
  labels.forEach(l => l.element.classList.toggle('selected', l.asset?.id === state.selected.id));
  if (selectionRing && objects.has(state.selected.id)) {
    const center = objects.get(state.selected.id).center;
    selectionRing.position.set(center.x,1.1,center.z);
    selectionRing.visible = matches(state.selected);
  }
}

const project = ([lng,lat], y = .2) => new THREE.Vector3((lng-125.333)*800,y,-(lat-43.851)*1110);
function rng(seed) { return () => { seed = (Math.imul(1664525,seed)+1013904223)>>>0;return seed/4294967296; }; }
const RIVER = [[125.374,43.918],[125.369,43.899],[125.370,43.885],[125.373,43.875],[125.374,43.863],[125.369,43.851],[125.367,43.841],[125.364,43.831],[125.360,43.820],[125.361,43.809],[125.359,43.79]];
const LAKE = [[125.292,43.850],[125.302,43.852],[125.313,43.848],[125.314,43.841],[125.311,43.832],[125.304,43.829],[125.296,43.831],[125.293,43.838]];
const ROADS = [
  { name:'人民大街', points:[[125.325,43.914],[125.325,43.896],[125.325,43.877],[125.325,43.851],[125.325,43.826],[125.325,43.790]], width:1.6 },
  { name:'亚泰大街', points:[[125.347,43.913],[125.347,43.887],[125.347,43.860],[125.347,43.831],[125.347,43.801]], width:1.2 },
  { name:'东环城路', points:[[125.395,43.908],[125.395,43.885],[125.395,43.852],[125.391,43.819],[125.392,43.795]], width:1.2 },
  { name:'新民大街', points:[[125.305,43.896],[125.302,43.882],[125.301,43.862],[125.304,43.855]], width:1 },
  { name:'前进大街', points:[[125.283,43.846],[125.286,43.832],[125.287,43.816],[125.29,43.790]], width:1.1 },
  { name:'解放大路', points:[[125.262,43.876],[125.279,43.874],[125.301,43.869],[125.325,43.865],[125.350,43.863],[125.374,43.863],[125.405,43.863]], width:1.35 },
  { name:'南湖大路', points:[[125.261,43.835],[125.288,43.835],[125.315,43.835],[125.341,43.835],[125.365,43.835],[125.403,43.835]], width:1.2 },
  { name:'卫星路', points:[[125.262,43.817],[125.285,43.817],[125.315,43.817],[125.345,43.817],[125.366,43.817],[125.400,43.817]], width:1.35 },
  { name:'南环城路', points:[[125.263,43.799],[125.293,43.799],[125.325,43.799],[125.360,43.799],[125.394,43.799]], width:1.2 },
  { name:'自由大路', points:[[125.322,43.850],[125.346,43.850],[125.369,43.850],[125.405,43.850]], width:1 },
  { name:'长春大街', points:[[125.304,43.894],[125.325,43.892],[125.352,43.890],[125.380,43.885],[125.401,43.886]], width:1.1 },
];
function addStrip(points,width,color,y=.08,group=scene) {
  const positions = [];
  for(let i=1;i<points.length;i++) {
    const a=project(points[i-1],y),b=project(points[i],y),dir=b.clone().sub(a).normalize(),n=new THREE.Vector3(-dir.z,0,dir.x).multiplyScalar(width/2);
    const corners=[a.clone().add(n),a.clone().sub(n),b.clone().add(n),b.clone().sub(n)];
    for(const idx of [0,1,2,1,3,2])positions.push(...corners[idx].toArray());
  }
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.computeVertexNormals();
  const mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));group.add(mesh);return mesh;
}
function addPolygon(coords,color,y=.1) {
  const shape = new THREE.Shape();
  coords.forEach((c,i)=>{const p=project(c);if(i===0)shape.moveTo(p.x,-p.z);else shape.lineTo(p.x,-p.z);});shape.closePath();
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shape),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide}));mesh.rotation.x=-Math.PI/2;mesh.position.y=y;scene.add(mesh);return mesh;
}
function distanceToPath(x,z,points) {
  let min=Infinity;
  for(let i=1;i<points.length;i++) {
    const a=project(points[i-1]),b=project(points[i]),dx=b.x-a.x,dz=b.z-a.z;
    const t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
    min=Math.min(min,Math.hypot(x-a.x-t*dx,z-a.z-t*dz));
  }return min;
}
function addLabel(text, point, cls='', asset=null) {
  const element=document.createElement(asset?'button':'span');element.className=`city-label ${cls}`;
  if(asset){const dot=document.createElement('i');element.append(dot,document.createTextNode(text));element.style.setProperty('--asset-color',TYPES[asset.type].color);element.setAttribute('aria-label',`查看${asset.name}`);element.addEventListener('click',()=>selectAsset(asset,true));}
  else element.textContent=text;
  $('map-labels').append(element);labels.push({element,point,asset,visible:true});
}
function buildCity() {
  const ground=new THREE.Mesh(new THREE.BoxGeometry(116,2,140),new THREE.MeshStandardMaterial({color:'#152838',roughness:.94,metalness:.08}));ground.position.y=-1.1;scene.add(ground);
  const outline=new THREE.LineSegments(new THREE.EdgesGeometry(ground.geometry),new THREE.LineBasicMaterial({color:'#31556b',transparent:true,opacity:.65}));outline.position.copy(ground.position);scene.add(outline);
  const grid=new THREE.GridHelper(140,56,'#284152','#203848');grid.position.y=.02;scene.add(grid);
  const parkCenter=project([125.303,43.841]);
  const park=new THREE.Mesh(new THREE.CircleGeometry(15,64),new THREE.MeshBasicMaterial({color:'#173b3c',transparent:true,opacity:.8}));park.rotation.x=-Math.PI/2;park.scale.set(1,1.27,1);park.position.copy(parkCenter);park.position.y=.06;scene.add(park);
  addStrip(RIVER,3.3,'#173e4d',.12);addStrip(RIVER,1.8,'#245469',.14);addPolygon(LAKE,'#245b6e',.15);
  ROADS.forEach(r=>{addStrip(r.points,r.width+.55,'#2a4252');addStrip(r.points,r.width,'#344c5c',.11);addStrip(r.points,.045,'#637c8a',.12);});
  // Secondary street mesh is schematic, not a geographic road dataset.
  for(let x=125.269;x<125.399;x+=.011)if(Math.abs(x-125.305)>.006)addStrip([[x,43.791],[x,43.914]],.23,'#294150',.025);
  for(let y=43.794;y<43.913;y+=.009)addStrip([[125.261,y],[125.405,y]],.23,'#294150',.03);
  buildingGroup=new THREE.Group();scene.add(buildingGroup);
  const random=rng(261007),buildings=[];
  for(let x=-53;x<56;x+=3.5)for(let z=-67;z<65;z+=3.4) {
    const px=x+random()*1.2,pz=z+random()*1.2;
    if(Math.hypot((px-parkCenter.x)/1.05,(pz-parkCenter.z)/1.27)<16||distanceToPath(px,pz,RIVER)<3.1||ROADS.some(r=>distanceToPath(px,pz,r.points)<r.width/2+1.5)||random()<.10)continue;
    const downtown=Math.max(0,1-Math.hypot(px+4,pz+20)/45);
    const h=1.1+random()*4.8+downtown*random()*6;
    buildings.push({x:px,z:pz,w:1.1+random()*1.2,d:1.1+random()*1.4,h,color:new THREE.Color().setHSL(.57+random()*.025,.20+random()*.12,.21+random()*.12)});
  }
  const buildingMesh=new THREE.InstancedMesh(new THREE.BoxGeometry(1,1,1),new THREE.MeshStandardMaterial({roughness:.82,metalness:.12}),buildings.length);
  const transform=new THREE.Object3D();buildings.forEach((b,i)=>{transform.position.set(b.x,b.h/2+.2,b.z);transform.scale.set(b.w,b.h,b.d);transform.updateMatrix();buildingMesh.setMatrixAt(i,transform.matrix);buildingMesh.setColorAt(i,b.color);});buildingGroup.add(buildingMesh);
  const roofPositions=[];buildings.forEach(b=>{const y=b.h+.22,x=b.x,z=b.z,w=b.w/2,d=b.d/2;for(const[a,c]of[[[-w,-d],[w,-d]],[[w,-d],[w,d]],[[w,d],[-w,d]],[[-w,d],[-w,-d]]])roofPositions.push(x+a[0],y,z+a[1],x+c[0],y,z+c[1]);});
  const roofGeometry=new THREE.BufferGeometry();roofGeometry.setAttribute('position',new THREE.Float32BufferAttribute(roofPositions,3));buildingGroup.add(new THREE.LineSegments(roofGeometry,new THREE.LineBasicMaterial({color:'#6c9bb0',transparent:true,opacity:.34})));
  addLabel('南湖',project([125.304,43.843],.5),'water');addLabel('伊 通 河',project([125.371,43.881],.5),'water');
  addLabel('朝阳区',project([125.279,43.879],7));addLabel('南关区',project([125.344,43.857],8));addLabel('二道区',project([125.390,43.885],6));
  addLabel('人民大街',project([125.328,43.885],.6));addLabel('卫星路',project([125.337,43.813],.6));
  addLabel('长春理工大学 · 示意位置',project([125.295,43.813],2));
  for(const asset of ASSETS)buildAsset(asset);
  selectionRing=new THREE.Mesh(new THREE.RingGeometry(2.7,2.8,64),new THREE.MeshBasicMaterial({color:'#a1edee',transparent:true,opacity:.9,side:THREE.DoubleSide}));selectionRing.rotation.x=-Math.PI/2;scene.add(selectionRing);
}
function buildAsset(asset) {
  const group=new THREE.Group();scene.add(group);
  const points=asset.points.map(c=>project(c,asset.type==='bridge'?1.7:.85));
  const curve=new THREE.CatmullRomCurve3(points,false,'centripetal',.1);
  const color=TYPES[asset.type].color;
  const line=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*15),asset.type==='bridge'?.44:.21,6,false),new THREE.MeshStandardMaterial({color,emissive:color,emissiveIntensity:.7,transparent:true,opacity:.85,roughness:.5}));group.add(line);
  const hit=new THREE.Mesh(new THREE.TubeGeometry(curve,Math.max(24,points.length*12),1.2,5,false),new THREE.MeshBasicMaterial({visible:false}));hit.userData.asset=asset;group.add(hit);clickable.push(hit);
  const center=curve.getPoint(.52);
  const marker=new THREE.Mesh(new THREE.SphereGeometry(.75,12,8),new THREE.MeshBasicMaterial({color}));marker.position.copy(center).add(new THREE.Vector3(0,5.8,0));group.add(marker);marker.userData.asset=asset;clickable.push(marker);
  const stalkGeometry=new THREE.BufferGeometry().setFromPoints([center,marker.position]);group.add(new THREE.Line(stalkGeometry,new THREE.LineBasicMaterial({color,transparent:true,opacity:.75})));
  const halo=new THREE.Mesh(new THREE.RingGeometry(1.35,1.49,40),new THREE.MeshBasicMaterial({color,side:THREE.DoubleSide,transparent:true,opacity:.75}));halo.rotation.x=-Math.PI/2;halo.position.copy(center).add(new THREE.Vector3(0,.12,0));group.add(halo);
  const beacon=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.45,10,24,1,true),new THREE.MeshBasicMaterial({color:'#ffbd69',transparent:true,opacity:.09,side:THREE.DoubleSide,depthWrite:false}));beacon.position.copy(center).add(new THREE.Vector3(0,5,0));group.add(beacon);
  if(asset.type==='bridge') {
    const start=points[0],end=points.at(-1),length=start.distanceTo(end);
    const bridge=new THREE.Mesh(new THREE.BoxGeometry(length,1.0,2),new THREE.MeshStandardMaterial({color:'#487781',roughness:.6}));bridge.position.copy(start).add(end).multiplyScalar(.5);group.add(bridge);
    for(const t of [.15,.45,.75]){const p=curve.getPoint(t);const pier=new THREE.Mesh(new THREE.BoxGeometry(.35,1.3,1.6),new THREE.MeshStandardMaterial({color:'#648e94'}));pier.position.set(p.x,.7,p.z);group.add(pier);}
    for(let i=0;i<14;i++){const p=curve.getPoint(i/13),height=1.2+Math.sin(i/13*Math.PI)*2.8;const arch=new THREE.Mesh(new THREE.BoxGeometry(.12,height,.12),new THREE.MeshBasicMaterial({color}));arch.position.set(p.x,1.7+height/2,p.z-.8);group.add(arch);const arch2=arch.clone();arch2.position.z=p.z+.8;group.add(arch2);}
  }
  const packet=new THREE.Mesh(new THREE.SphereGeometry(.38,8,6),new THREE.MeshBasicMaterial({color:'#f0ffff'}));group.add(packet);
  markers.push({asset,curve,packet,halo,marker});
  objects.set(asset.id,{group,line,marker,halo,beacon,center,curve});
  addLabel(asset.type==='bridge'?asset.name:asset.name.replace('示意段',''),marker.position.clone().add(new THREE.Vector3(0,2.4,0)),'asset',asset);
}
function animateCamera(position,target) {
  if(reducedMotion){camera.position.copy(position);controls.target.copy(target);controls.update();return;}
  cameraTween={start:performance.now(),from:camera.position.clone(),to:position,fromTarget:controls.target.clone(),toTarget:target};
}
function fitCamera() {
  if(!camera)return;
  const ratio=viewport.clientWidth/viewport.clientHeight;
  const zoom=ratio<1?Math.min(1.55,1/ratio):1;
  const position=state.view==='2d'?new THREE.Vector3(0,208*zoom,.04):new THREE.Vector3(96*zoom,126*zoom,142*zoom);
  animateCamera(position,new THREE.Vector3(0,0,0));
}
function initScene() {
  viewport=$('viewport');
  scene=new THREE.Scene();scene.background=new THREE.Color('#0b1524');scene.fog=new THREE.Fog('#0b1524',190,410);
  renderer=new THREE.WebGLRenderer({antialias:true,preserveDrawingBuffer:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.8));renderer.setSize(viewport.clientWidth,viewport.clientHeight);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.28;viewport.append(renderer.domElement);
  renderer.domElement.setAttribute('aria-label','长春城市三维模型，使用鼠标旋转和缩放，点击发光设施查看详情');
  renderer.domElement.setAttribute('role','img');
  camera=new THREE.PerspectiveCamera(40,viewport.clientWidth/viewport.clientHeight,.1,600);camera.position.set(96,126,142);
  controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.07;controls.minDistance=30;controls.maxDistance=340;controls.maxPolarAngle=Math.PI/2.2;controls.enablePan=true;
  controls.addEventListener('start',()=>{cameraTween=null;});
  scene.add(new THREE.HemisphereLight('#c7e3ee','#172736',2.1));
  const key=new THREE.DirectionalLight('#b4d9ec',2.7);key.position.set(-70,110,35);scene.add(key);
  const fill=new THREE.DirectionalLight('#385f86',1.5);fill.position.set(80,40,-70);scene.add(fill);
  buildCity();fitCamera();updateVisuals();raycaster=new THREE.Raycaster();cursor=new THREE.Vector2();
  renderer.domElement.addEventListener('pointerdown',event=>{dragStart={x:event.clientX,y:event.clientY};});
  renderer.domElement.addEventListener('pointerup',event=>{
    if(!dragStart||event.button!==0||Math.hypot(event.clientX-dragStart.x,event.clientY-dragStart.y)>6)return;
    const rect=renderer.domElement.getBoundingClientRect();cursor.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(cursor,camera);
    const hits=raycaster.intersectObjects(clickable).filter(hit=>matches(hit.object.userData.asset));
    if(hits.length)selectAsset(hits[0].object.userData.asset,false);
  });
  renderer.domElement.addEventListener('contextmenu',event=>event.preventDefault());
  let previousAspect=camera.aspect;
  const resize=new ResizeObserver(()=>{camera.aspect=viewport.clientWidth/viewport.clientHeight;camera.updateProjectionMatrix();renderer.setSize(viewport.clientWidth,viewport.clientHeight);if(Math.abs(previousAspect-camera.aspect)>.2)fitCamera();previousAspect=camera.aspect;});resize.observe(viewport);
  renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();showSceneError('浏览器图形资源暂时中断，请刷新页面恢复场景。');});
  $('loading').hidden=true;
}
function showSceneError(message){$('loading').hidden=true;$('map-error').hidden=false;$('error-message').textContent=message;}

function prepareCanvas(canvas) {
  const ratio=Math.min(devicePixelRatio,2),width=canvas.clientWidth,height=canvas.clientHeight;
  if(canvas.width!==Math.round(width*ratio)||canvas.height!==Math.round(height*ratio)){canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);}
  const ctx=canvas.getContext('2d');ctx.setTransform(ratio,0,0,ratio,0,0);return{ctx,width,height};
}
const signalSources = new Map();
function drawSignal(t) {
  const asset=state.selected,event=asset.event,active=event&&asset.status!=='closed';
  const kind=active?event.kind:'background',start=active?event.signalStart:-Infinity;
  const key=`${asset.id}:${kind}:${start}`;
  if (!signalSources.has(key)) {
    // Keep only the current source for each asset, including after reset/injection.
    for (const existing of signalSources.keys()) if (existing.startsWith(`${asset.id}:`)) signalSources.delete(existing);
    signalSources.set(key,createSignalSource(assetSeed(asset.id),kind,start));
  }
  const signal=signalSources.get(key).window(t);
  $('amplitude').textContent=signal.rms.toFixed(3);
  $('frequency').textContent=signal.dominantHz===null?'—':signal.dominantHz.toFixed(1);
  const{ctx,width:w,height:h}=prepareCanvas($('waveform'));ctx.clearRect(0,0,w,h);
  ctx.strokeStyle='#203148';ctx.lineWidth=.6;
  for(let i=1;i<4;i++){ctx.beginPath();ctx.moveTo(0,h*i/4);ctx.lineTo(w,h*i/4);ctx.stroke();}
  for(let i=1;i<5;i++){ctx.beginPath();ctx.moveTo(w*i/5,0);ctx.lineTo(w*i/5,h);ctx.stroke();}
  ctx.beginPath();
  const pixels=Math.max(1,Math.floor(w));
  // Peak-preserving decimation: narrow impacts remain visible at dashboard width.
  for(let x=0;x<pixels;x++) {
    const begin=Math.floor(x/pixels*signal.values.length),end=Math.max(begin+1,Math.floor((x+1)/pixels*signal.values.length));
    let low=Infinity,high=-Infinity;
    for(let i=begin;i<end;i++){low=Math.min(low,signal.values[i]);high=Math.max(high,signal.values[i]);}
    const y1=Math.max(2,Math.min(h-2,h/2-high*h*.34));
    const y2=Math.max(2,Math.min(h-2,h/2-low*h*.34));
    ctx.moveTo(x+.5,y1);ctx.lineTo(x+.5,Math.max(y1+.65,y2));
  }
  ctx.strokeStyle=asset.status==='warning'?'#ffbd69':'#68dce9';ctx.lineWidth=1;ctx.stroke();
  const spec=prepareCanvas($('spectrogram'));
  spec.ctx.fillStyle='#091528';spec.ctx.fillRect(0,0,spec.width,spec.height);
  const columnWidth=spec.width/64;
  for(const column of signal.columns)for(let y=0;y<spec.height;y+=2) {
    const bin=Math.max(1,Math.min(100,Math.round((1-y/spec.height)*100)));
    const db=10*Math.log10(column.power[bin]+1e-12);
    const power=Math.max(0,Math.min(1,(db+65)/55));
    spec.ctx.fillStyle=`hsl(${241-power*190},${58+power*28}%,${9+power*47}%)`;
    spec.ctx.fillRect(column.position*spec.width,y,columnWidth+1,2);
  }
}
function updateLabels() {
  const width=viewport.clientWidth,height=viewport.clientHeight;
  const occupied=[];
  const ordered=labels.slice().sort((a,b)=>(b.asset?.id===state.selected.id?3:b.asset?2:1)-(a.asset?.id===state.selected.id?3:a.asset?2:1));
  for(const l of ordered) {
    const projected=l.point.clone().project(camera);
    const x=(projected.x+1)/2*width,y=(-projected.y+1)/2*height;
    const show=state.labels&&l.visible&&projected.z<1&&projected.z>-1&&x>5&&x<width-5&&y>108&&y<height-25;
    l.element.hidden=!show;
    if(show){
      const w=l.element.offsetWidth,h=l.element.offsetHeight;
      const candidates=l.asset?[[0,0],[0,-28],[0,28],[-24,-16],[24,16]]:[[0,0],[0,18],[0,-18]];
      let placement=null;
      for(const[dx,dy]of candidates){
        const cx=THREE.MathUtils.clamp(x+dx,w/2+6,width-w/2-6),cy=y+dy;
        const rect={left:cx-w/2-4,right:cx+w/2+4,top:cy-h/2-3,bottom:cy+h/2+3};
        if(cy<108||cy>height-25||occupied.some(r=>rect.left<r.right&&rect.right>r.left&&rect.top<r.bottom&&rect.bottom>r.top))continue;
        placement={cx,cy,rect};break;
      }
      if(placement){l.element.style.left=`${placement.cx}px`;l.element.style.top=`${placement.cy}px`;occupied.push(placement.rect);}else l.element.hidden=true;
    }
  }
  const direction=new THREE.Vector3();camera.getWorldDirection(direction);$('compass-needle').style.transform=`rotate(${Math.atan2(direction.x,-direction.z)*180/Math.PI}deg)`;
}
let lastFrame=0,lastChart=0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt=Math.min(.1,(now-lastFrame)/1000||0);lastFrame=now;
  if(!state.paused&&!document.hidden)state.time+=dt;
  if(document.hidden)return;
  if(renderer&&camera) {
    if(cameraTween) {
      const progress=Math.min(1,(now-cameraTween.start)/800),ease=1-Math.pow(1-progress,3);
      camera.position.lerpVectors(cameraTween.from,cameraTween.to,ease);controls.target.lerpVectors(cameraTween.fromTarget,cameraTween.toTarget,ease);if(progress===1)cameraTween=null;
    }
    controls.update();
    markers.forEach(m=>{m.packet.position.copy(m.curve.getPoint((state.time*.11+ASSETS.indexOf(m.asset)*.16)%1));m.halo.scale.setScalar(reducedMotion?1:1+.15*Math.sin(state.time*2));});
    if(selectionRing&&!reducedMotion)selectionRing.material.opacity=.65+.2*Math.sin(state.time*2);
    updateLabels();renderer.render(scene,camera);
  }
  if(now-lastChart>100){drawSignal(state.time);lastChart=now;}
}

function download(data,filename,mime) {
  const url=URL.createObjectURL(new Blob([data],{type:mime}));const a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}
function wireUI() {
  $('filters').addEventListener('click',event=>{
    const button=event.target.closest('[data-filter]');if(!button)return;
    state.filter=button.dataset.filter;
    $('filters').querySelectorAll('button').forEach(el=>{el.classList.toggle('active',el===button);el.setAttribute('aria-pressed',String(el===button));});
    const filtered=ASSETS.filter(matches);if(filtered.length&&!filtered.includes(state.selected))selectAsset(filtered[0],false);renderAssets();updateVisuals();
  });
  $('search').addEventListener('input',event=>{state.search=event.target.value.trim();renderAssets();updateVisuals();});
  $('buildings-layer').addEventListener('change',event=>{state.buildings=event.target.checked;if(buildingGroup)buildingGroup.visible=state.buildings;});
  $('labels-layer').addEventListener('change',event=>{state.labels=event.target.checked;});
  $('mode-3d').addEventListener('click',()=>setView('3d'));
  $('mode-2d').addEventListener('click',()=>setView('2d'));
  $('zoom-in').addEventListener('click',()=>zoom(.8));$('zoom-out').addEventListener('click',()=>zoom(1.25));
  $('reset-camera').addEventListener('click',()=>fitCamera());
  $('pause').addEventListener('click',()=>{state.paused=!state.paused;$('pause').textContent=state.paused?'▶ 继续信号':'Ⅱ 暂停信号';$('pause').setAttribute('aria-pressed',String(state.paused));});
  $('inject').addEventListener('click',()=>{
    const asset=state.selected,kind=$('scenario').value;
    if(asset.status==='ordered'){toast('当前设施有处理中工单，请先完成模拟现场确认');return;}
    asset.event=makeEvent(asset,kind);asset.status=kind==='traffic'?'normal':'warning';renderAssets();renderDetail();
    toast(`已在${asset.name}触发${SCENARIOS[kind].name}（模拟）`);
  });
  $('review').addEventListener('click',()=>{
    const a=state.selected;if(a.status!=='warning')return;
    a.status='reviewed';a.event.reviewedAt=timestamp();renderAssets();renderDetail();toast('已模拟人工复核，可继续生成工单');
  });
  $('create-order').addEventListener('click',()=>{
    const a=state.selected;if(a.status!=='reviewed')return;
    const order={id:`DEMO-${String(++state.serial).padStart(3,'0')}`,assetId:a.id,assetName:a.name,eventName:SCENARIOS[a.event.kind].name,chainage:a.event.chainage,createdAt:timestamp(),reviewedAt:a.event.reviewedAt,complete:false,simulated:true};state.orders.push(order);a.status='ordered';renderAssets();renderDetail();toast(`模拟工单 ${order.id} 已生成，尚未发送至任何外部单位`);
  });
  $('reset-demo').addEventListener('click',()=>{resetAssetStates();state.orders=[];state.serial=0;state.time=0;state.paused=false;$('scenario').value='construction';$('pause').textContent='Ⅱ 暂停信号';$('pause').setAttribute('aria-pressed','false');renderAssets();renderDetail();toast('演示已重置，模拟工单已清空');});
  $('export').addEventListener('click',()=>{
    const record={title:'光脉智瞳长春场景演示记录',simulated:true,exportedAt:new Date().toISOString(),notice:'所有资产、监测与工单数据均为模拟，不代表真实部署或实测性能。',assets:ASSETS.map(({id,name,type,status,event,points,length,extension})=>({id,name,type,status,event,points,schematicLengthKm:length,extension:!!extension})),orders:state.orders};
    download(JSON.stringify(record,null,2),'PulseVision-长春模拟记录.json','application/json');toast('演示记录已导出（JSON）');
  });
  $('capture').addEventListener('click',()=>{
    if(!renderer){toast('三维场景不可用，无法导出画面');return;}
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d');ctx.fillStyle='#0b1524';ctx.fillRect(0,0,1920,1080);
    const src=renderer.domElement;const scale=Math.min(1920/src.width,940/src.height),w=src.width*scale,h=src.height*scale;ctx.drawImage(src,(1920-w)/2,92,w,h);
    const displayScale=w/viewport.clientWidth;
    for(const label of labels.filter(l=>!l.element.hidden)){
      const x=(1920-w)/2+parseFloat(label.element.style.left)*displayScale,y=92+parseFloat(label.element.style.top)*displayScale;
      ctx.font=`${label.asset?18:17}px Microsoft YaHei, sans-serif`;const text=label.element.textContent;
      const tw=ctx.measureText(text).width;
      if(label.asset){ctx.fillStyle='#132b3ee8';ctx.beginPath();ctx.roundRect(x-tw/2-12,y-18,tw+24,34,5);ctx.fill();ctx.strokeStyle=TYPES[label.asset.type].color;ctx.lineWidth=1;ctx.stroke();}
      ctx.fillStyle=label.asset?TYPES[label.asset.type].color:'#aecbdc';ctx.textAlign='center';ctx.fillText(text,x,y+5);
    }ctx.textAlign='left';
    ctx.font='bold 34px Microsoft YaHei, sans-serif';ctx.fillStyle='#edf3fa';ctx.fillText('光脉智瞳 | 长春城市监测交互演示',58,55);
    ctx.font='22px Microsoft YaHei, sans-serif';ctx.fillStyle='#91aec3';ctx.fillText('南湖 — 人民大街 — 伊通河 · 城市形态、管网与建筑为示意模型',58,1050);
    ctx.fillStyle='#ffbd69';ctx.font='20px Microsoft YaHei, sans-serif';ctx.fillText('模拟数据 / 非真实部署',1540,55);
    const a=document.createElement('a');a.href=canvas.toDataURL('image/png');a.download='光脉智瞳-长春城市演示.png';a.click();toast('城市示意画面已导出，可插入PPT');
  });
  $('fullscreen').addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{toast('当前浏览器未开放全屏，请使用浏览器全屏快捷键');}});
  document.addEventListener('fullscreenchange',()=>{$('fullscreen').textContent=document.fullscreenElement?'退出全屏 ↙':'全屏 ↗';});
  const dialog=$('sources-dialog');$('sources-btn').addEventListener('click',()=>dialog.showModal());$('close-sources').addEventListener('click',()=>dialog.close());dialog.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
  document.addEventListener('keydown',event=>{if(event.key==='/'&&!['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)&&!dialog.open){event.preventDefault();$('search').focus();}});
}
function setView(mode) {
  state.view=mode;
  for(const value of ['2d','3d']){const btn=$(`mode-${value}`);btn.classList.toggle('active',value===mode);btn.setAttribute('aria-pressed',String(value===mode));}
  if(controls)controls.enableRotate=mode==='3d';fitCamera();
}
function zoom(factor) {
  if(!camera)return;
  const offset=camera.position.clone().sub(controls.target),length=THREE.MathUtils.clamp(offset.length()*factor,controls.minDistance,controls.maxDistance);offset.setLength(length);animateCamera(controls.target.clone().add(offset),controls.target.clone());
}

wireUI();renderAssets();renderDetail();
try{initScene();}catch(error){console.error('City scene initialization failed:',error);showSceneError('此浏览器未能初始化 WebGL 图形渲染。可尝试开启浏览器硬件加速或更换浏览器。');}
renderAssets();renderDetail();
const updateClock=()=>{$('clock').textContent=new Date().toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false});};updateClock();setInterval(updateClock,1000);
requestAnimationFrame(frame);
