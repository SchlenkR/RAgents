import assert from "node:assert/strict";
import test from "node:test";
import { groupRunsByActivity, runActivityNotice } from "../src/run-overview";
import { parseRunReadRevisions } from "../src/run-read-state";
import type { SessionInfo } from "../src/api";

const run = (id:string,updatedAt:number,revision?:number):SessionInfo => ({id,title:id,updatedAt,...revision===undefined?{}:{revision}});

test("activity groups use local calendar days and stable newest-first ordering without mutating inputs",()=>{
  const now = new Date(2026,0,1,0,20);
  const input = Object.freeze([
    Object.freeze(run("old",new Date(2024,6,20,12).getTime())),
    Object.freeze(run("yesterday",new Date(2025,11,31,23,59).getTime())),
    Object.freeze(run("z",new Date(2026,0,1,0,10).getTime())),
    Object.freeze(run("a",new Date(2026,0,1,0,10).getTime())),
  ]);
  const before = JSON.stringify(input);
  const groups = groupRunsByActivity(input,now);
  assert.deepEqual(groups.map(group=>group.date),["2026-01-01","2025-12-31","2024-07-20"]);
  assert.deepEqual(groups.slice(0,2).map(group=>group.label),["Heute","Gestern"]);
  assert.match(groups[2]!.label,/2024/);
  assert.deepEqual(groups[0]!.sessions.map(session=>session.id),["a","z"]);
  assert.equal(JSON.stringify(input),before);
  assert.deepEqual(groupRunsByActivity([],now),[]);
});

test("same-year older dates omit the year and leap-day yesterday is a calendar subtraction",()=>{
  const groups=groupRunsByActivity([run("leap",new Date(2024,1,29,23).getTime()),run("older",new Date(2024,0,2).getTime())],new Date(2024,2,1,1));
  assert.equal(groups[0]!.label,"Gestern");
  assert.doesNotMatch(groups[1]!.label,/2024/);
});

test("unread notices depend on actual journal revision rather than activity timestamps",()=>{
  assert.equal(runActivityNotice(run("a",999,4),undefined),"unseen");
  assert.equal(runActivityNotice(run("a",999,4),3),"updated");
  assert.equal(runActivityNotice(run("a",999,4),4),undefined);
  assert.equal(runActivityNotice(run("a",999,4),5),undefined);
  assert.equal(runActivityNotice(run("a",999),undefined),undefined);
  assert.equal(runActivityNotice(run("a",1000,0),0),undefined);
});

test("stored read revisions keep only nonnegative safe integers",()=>{
  for(const value of [null,"", "broken", "[]", "null"]) assert.deepEqual(parseRunReadRevisions(value),{});
  assert.deepEqual(parseRunReadRevisions(JSON.stringify({a:0,b:15,c:-1,d:1.5,e:"4",f:null,g:Number.MAX_SAFE_INTEGER+1})),{a:0,b:15});
});
