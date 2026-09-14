import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { runChatToolLoop, type ToolPort } from "../src/control/chat-tool-loop.js";
import { adaptRoleContract, listConversationRoles } from "../src/control/chat-roles.js";
import { ChatService, type ChatMessage } from "../src/control/chat-service.js";

const sse = (chunks: unknown[], end=true) => new Response(chunks.map(c=>"data: "+JSON.stringify(c)+"\n\n").join("")+(end?"data: [DONE]\n\n":""),{headers:{"content-type":"text/event-stream"}});
describe("ad hoc chat", () => {
  it("removes procedural blocks from derived contracts and leaves source unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(),"roles-"));
    try {
      await mkdir(join(root,"roles"));
      const raw="# Analyst\n\nCompare supplied evidence.\n\nTASK_ID required; mandatory audit before answering.\n\nRETURN_TO=Builder";
      await writeFile(join(root,"roles","ROLE.md"),raw);
      const roles=await listConversationRoles(root);
      const role=roles.find(r=>r.source===join(root,"roles","ROLE.md"));
      expect(role?.contract).toContain("Compare supplied evidence");
      expect(role?.contract).not.toContain("TASK_ID");
      expect(adaptRoleContract(raw)).not.toContain("RETURN_TO");
      expect(roles[0]?.id).toBe("general");
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  it("streams a tool call, executes it once, returns its result to the same model conversation",async()=>{
    const calls: unknown[]=[]; const bodies: any[]=[]; const notices: unknown[]=[]; let text="";
    const port: ToolPort={tools:[{type:"function",function:{name:"read_file",parameters:{type:"object"}}}],
      call:async (...args)=>{calls.push(args);return "actual file contents";},close:async()=>{}};
    const fetchImpl: typeof fetch=async (_url,init)=>{
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length===1?sse([{choices:[{delta:{tool_calls:[{index:0,id:"call1",function:{name:"read_file",arguments:'{"path":"a"}'}}]}}]}]):sse([{choices:[{delta:{content:"Here is the result."}}]}]);
    };
    await runChatToolLoop({endpoint:"http://fixture",key:"test",models:["oc/fixture"],messages:[{role:"user",content:"read a"}],
      signal:new AbortController().signal,fetchImpl,port,delta:d=>{text+=d;},notice:e=>notices.push(e),selected:()=>{},usage:()=>{}});
    expect(calls).toHaveLength(1);
    expect(bodies[1].messages.at(-1)).toEqual({role:"tool",tool_call_id:"call1",content:"actual file contents"});
    expect(text).toBe("Here is the result."); expect(notices).toHaveLength(2);
  });
  it("does not execute a tool from an incomplete stream",async()=>{
    let calls=0;
    await expect(runChatToolLoop({endpoint:"http://fixture",key:"test",models:["oc/fixture"],messages:[],
      signal:new AbortController().signal,fetchImpl:async()=>sse([{choices:[{delta:{tool_calls:[{index:0,id:"x",function:{name:"write_file",arguments:"{}"}}]}}]}],false),
      port:{tools:[],call:async()=>{calls++;return "";},close:async()=>{}},delta:()=>{},notice:()=>{},selected:()=>{},usage:()=>{}
    })).rejects.toThrow("CHAT_STREAM_INTERRUPTED");
    expect(calls).toBe(0);
  });
  it("returns provider failures into the originating persisted chat, without invoking Hermes",async()=>{
    const root=await mkdtemp(join(tmpdir(),"adhoc-chat-"));
    let agentCalls=0;
    const chat=new ChatService({stateDir:root,projectRoot:root,apiKey:"test",
      skillExecutor:async()=>{agentCalls++;},fetchImpl:async()=>new Response("",{status:500}),
      toolFactory:async()=>({tools:[],call:async()=>"",close:async()=>{}})});
    try {
      const a=await chat.createSession(),b=await chat.createSession();
      const seen:unknown[]=[];const unsub=chat.subscribe(b.sessionId,e=>seen.push(e));
      const done=new Promise<void>(resolve=>chat.subscribe(a.sessionId,e=>{if(e.type==="error")resolve();}));
      await chat.startMessage(a.sessionId,"Product Owner, porozmawiajmy");
      await done;
      expect(agentCalls).toBe(0);
      expect((await chat.getSession(a.sessionId))?.messages.at(-1)?.content).toContain("CHAT_UPSTREAM_500");
      expect((await chat.getSession(b.sessionId))?.messages).toHaveLength(0);
      expect(seen).toHaveLength(1);unsub();
    } finally {chat.close();await rm(root,{recursive:true,force:true});}
  });
});
