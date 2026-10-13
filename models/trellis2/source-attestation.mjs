import {execFileSync} from 'node:child_process';
// NUL-delimited Git status preserves whitespace/newlines and rename sources.
// Only untracked entries named exactly .DS_Store are outside source custody.
export function gitSourceIdentity(root){
  const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),
    raw=execFileSync('git',['status','--porcelain=v1','-z','--untracked-files=all'],{cwd:root,encoding:'utf8'}),
    fields=raw.split('\0'),kept=[],ignored=[];
  for(let i=0;i<fields.length-1;i++){
    const record=fields[i];
    if(record.length<4||record[2]!==' ')throw Error('malformed Git source status');
    const status=record.slice(0,2),name=record.slice(3);
    if(status==='??'&&name.split('/').at(-1)==='.DS_Store'){ignored.push(name);continue;}
    kept.push(record);
    if(status.includes('R')||status.includes('C')){
      if(++i>=fields.length-1)throw Error('incomplete renamed Git source status');
      kept.push(fields[i]);
    }
  }
  return {commit,dirty:kept.map(value=>value+'\0').join(''),ignoredUntrackedMetadata:ignored,statusPorcelain:raw};
}
