import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect, vi } from "vitest";
import { openHermesToolPort } from "../src/control/hermes-tool-port.js";
afterEach(()=>vi.unstubAllEnvs());
describe("Hermes Python tool protocol",()=>{
  it("imports only tool functions and scopes responses to the requesting session",async()=>{
    const root=await mkdtemp(join(tmpdir(),"hermes-tool-protocol-"));
    vi.stubEnv("KOORDYNATOR_HERMES_PYTHON","/usr/bin/python3");
    vi.stubEnv("PYTHONPATH",root);
    vi.stubEnv("KOORDYNATOR_FREE_ONLY","0");
    await writeFile(join(root,"model_tools.py"),[
      "def get_tool_definitions(**kwargs):",
      "    return [{'type':'function','function':{'name':'skills_list','parameters':{'type':'object'}}}]",
      "def handle_function_call(name, args, **kwargs):",
      "    return 'session=' + kwargs['session_id']",
      ""
    ].join("\n"));
    let port;
    try {
      port=await openHermesToolPort({root,stateDir:join(root,".orchestrator"),endpoint:"http://127.0.0.1:1/v1",apiKey:"fixture-secret",model:"oc/test",
        sessionId:"origin-session",userTask:"List skills",readOnly:false,signal:new AbortController().signal});
      expect(port.tools.map(t=>t.function.name)).toEqual(["skills_list"]);
      expect(await port.call("skills_list",{},"call-1")).toBe("session=origin-session");
      await expect(port.call("terminal",{},"call-2")).rejects.toThrow("TOOL_NOT_ALLOWED");
    } finally {await port?.close();await rm(root,{recursive:true,force:true});}
  },30000);
});
