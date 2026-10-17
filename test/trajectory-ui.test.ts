import assert from "node:assert/strict";
import { runInNewContext } from "node:vm";
import test from "node:test";
import { TRAJECTORY_JS } from "../src/trajectory-dashboard.ts";

class Element {
  children: Element[] = []; textContent = ""; hidden = false; value = ""; className = "";
  listeners = new Map<string, () => unknown>();
  append(e: Element) { this.children.push(e); }
  replaceChildren() { this.children = []; }
  get options() { return this.children; }
  setAttribute() {}
  addEventListener(name: string, cb: () => unknown) { this.listeners.set(name,cb); }
}
test("coverage and connection keep refreshing after more than one session page", async () => {
  const elements = new Map<string,Element>();
  const element=(id:string)=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id)!;};
  const timers: (()=>unknown)[] = []; let events=250; let eventCount=350; let fail=false; let requests=0;
  const sessions=Array.from({length:301},(_,i)=>({session:i.toString(16).padStart(32,"0"),models:[],turns:1,actions:0,reportedSuccess:0,reportedFailure:0,unknown:0,cancelled:0,gaps:0}));
  runInNewContext(TRAJECTORY_JS,{
    document:{getElementById:element,createElement:()=>new Element()},Intl,encodeURIComponent,
    setInterval:(cb:()=>unknown)=>{timers.push(cb);return 1;},
    fetch:async(path:string)=>{requests++;if(fail)throw new Error("synthetic offline");const u=new URL(path,"http://localhost");let after=Number(u.searchParams.get("after")??0);if(u.pathname==="/events"){if(u.searchParams.get("tail")==="1")after=Math.max(0,eventCount-200);return{ok:true,json:async()=>({rows:Array.from({length:Math.min(200,eventCount-after)},(_,i)=>({sequence:after+i+1,turn:1,action:null,kind:"runtime_action",category:"command",outcome:"unknown",evidence:null,elapsedMs:null,durationMs:null,inputBytes:null,outputBytes:null,changedFiles:null,exitCode:null})),next:after+200<eventCount?after+200:null})};}return{ok:true,json:async()=>({models:[],storage:{status:"ready",reason:null,bytes:100,maxBytes:1000},coverage:{discoveredSources:301,catchingUp:0,pausedSources:0,partialLineSources:0,discoveryUnavailable:false,discoveryLimited:false,ignoredSourceRecords:0},totals:{events,turns:2,actions:0,reportedSuccess:0,reportedFailure:0,gaps:0},sessions:sessions.slice(after,after+100),next:after+100<301?after+100:null})};},
  });
  const settle=()=>new Promise(resolve=>setImmediate(resolve));await settle();
  assert.equal(element("sessions").children.length,100);
  element("more-sessions").listeners.get("click")!();await settle();
  assert.equal(element("sessions").children.length,200);assert.equal(element("more-sessions").hidden,false);
  const before=requests;events=999;timers[0]();await settle();
  assert(requests>before);assert.equal(element("sessions").children.length,200,"stats refresh preserves pagination");
  assert.equal(element("totals").children[0].children[0].textContent,"999");
  element("sessions").children[0].children[0].children[0].listeners.get("click")!();await settle();
  assert.equal(element("events").children.length,200);assert.equal(element("events").children.at(-1)!.children[0].textContent,"350");
  eventCount=500;timers[0]();await settle();assert.equal(element("events").children.at(-1)!.children[0].textContent,"500","live tail keeps receiving later events");
  element("first-events").listeners.get("click")!();await settle();element("more-events").listeners.get("click")!();await settle();
  assert.equal(element("events").children.length,400);assert.match(element("timeline-note").textContent,/Historical/);
  eventCount=550;element("latest-events").listeners.get("click")!();await settle();assert.equal(element("events").children.at(-1)!.children[0].textContent,"550");
  eventCount=600;timers[0]();await settle();assert.equal(element("events").children.at(-1)!.children[0].textContent,"600");
  fail=true;timers[0]();await settle();assert.match(element("connection").textContent,/unavailable/);
});
