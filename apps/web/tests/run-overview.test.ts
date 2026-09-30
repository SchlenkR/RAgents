import assert from "node:assert/strict";
import test from "node:test";
import { runActivityNotice } from "../src/run-overview";
import { parseRunReadRevisions } from "../src/run-read-state";
import type { SessionInfo } from "../src/api";

const run = (id:string,updatedAt:number,revision?:number):SessionInfo => ({id,title:id,updatedAt,...revision===undefined?{}:{revision}});

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
