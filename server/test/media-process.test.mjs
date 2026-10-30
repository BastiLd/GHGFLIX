import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { terminateMediaProcess } from "../src/media-process.js";
if(process.platform !== "win32") {
  console.log("SKIP Windows launcher-tree test on non-Windows platform");
} else {
  const parent=spawn(process.execPath,["-e",`const {spawn}=require('node:child_process');const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit',windowsHide:true});console.log(c.pid);setInterval(()=>{},1000);`],{stdio:["ignore","pipe","pipe"],windowsHide:true});
  let childPid;
  try {
    childPid=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error("child did not start")),5000);
      parent.stdout.once("data",d=>{clearTimeout(timeout);resolve(Number(String(d).trim()));});
    });
    assert.ok(childPid>0);process.kill(childPid,0);
    await terminateMediaProcess(parent);
    assert.throws(()=>process.kill(childPid,0));
    console.log("PASS owned Windows launcher and descendant terminated");
  } finally {
    await terminateMediaProcess(parent);
    if(childPid){try{process.kill(childPid,"SIGKILL");}catch{}}
  }
}
