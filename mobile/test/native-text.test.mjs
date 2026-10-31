import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),babel=require('@babel/core');
function invalidChildren(source,filename){
  const {ast}=babel.transformSync(source,{filename,configFile:false,babelrc:false,ast:true,code:false,presets:[[require.resolve('@babel/preset-react'),{runtime:'classic'}]]});
  const errors=[];
  babel.traverse(ast,{CallExpression(path){
    const n=path.node;
    if(n.callee.type!=='MemberExpression'||n.callee.property.name!=='createElement')return;
    const component=n.arguments[0],name=component.name||component.property?.name;
    if(name==='Text')return;
    for(const child of n.arguments.slice(2))if(['StringLiteral','NumericLiteral'].includes(child.type))errors.push(`${filename}:${child.loc?.start.line??'?'}: raw text in ${name}`);
  }});
  return errors;
}
assert.equal(invalidChildren('<View><Text>OK</Text></View>','fixture.js').length,0);
assert.equal(invalidChildren('<View>{ok&&<Button/>} {show&&<Button/>}</View>','fixture.js').length,1,'A literal space outside Text crashes native Android, even if a DOM simulation accepts it.');
for(const name of ['AccountScreen','ProfileScreen','GoogleLogin']){
  const file=fileURLToPath(new URL(`../src/${name}.js`,import.meta.url));
  assert.deepEqual(invalidChildren(readFileSync(file,'utf8'),file),[]);
}
console.log('Native account/profile components contain no raw text children outside Text.');
