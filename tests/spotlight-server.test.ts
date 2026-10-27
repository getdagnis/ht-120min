import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import test from 'node:test';
import { readFileSync } from 'node:fs';

test('daily resolver reuses persisted selection and fetches only two rich profiles', () => {
 const output = execFileSync(process.execPath, ['--conditions=react-server','--import','tsx','--input-type=module','--eval', `
 import assert from 'node:assert/strict';
 import { registerHooks } from 'node:module';
 registerHooks({resolve(s,c,n){return n(s==='server-only'?'next/dist/compiled/server-only/empty.js':s,c);}});
 process.env.NEXT_PUBLIC_SUPABASE_URL='https://mock.invalid';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY='public-test';process.env.SUPABASE_URL='https://mock.invalid';process.env.SUPABASE_SECRET_KEY='test';
 const participants=[1,2,3,4].map(id=>({id:String(id),ht_team_id:id,hattrick_user_id:id,name:'Club '+id}));
 let winner=null;let reads=[];let rpcCalls=0;let failProfile=false;let failManager=0;
 globalThis.fetch=async(input,init)=>{
  const url=new URL(String(input)); let data;
  if(url.pathname.includes('/rpc/')) {
   rpcCalls++;const body=JSON.parse(init.body); winner ||= body.p_participant;data=winner;
  } else if(url.pathname.endsWith('/profiles')) {
   assert.equal(new Headers(init.headers).get('apikey'),'public-test');
   const id=Number(url.searchParams.get('hattrick_user_id').slice(3));reads.push(id);
   if(failProfile || id===failManager) return new Response(JSON.stringify({message:'Unavailable'}),{status:400,headers:{'Content-Type':'application/json'}});
   data={hattrick_user_id:id,manager_name:'Manager '+id,teams_json:[]};
  } else throw new Error('Unexpected request '+url);
  return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
 };
 const {loadInitialTournamentSpotlights}=await import('./src/app/_data/spotlight.ts');
 const first=await loadInitialTournamentSpotlights('cup',participants,true);
 assert.equal(first.managerSpotlights.length,2);assert.equal(reads.length,2);
 const selected=first.managerSpotlight.managerId;
 failManager=first.managerSpotlights.find(p=>p.managerId!==selected).managerId;
 const degraded=await loadInitialTournamentSpotlights('cup',participants,true);
 assert.equal(degraded.managerSpotlight.managerId,selected);
 assert.equal(degraded.managerSpotlights.length,1);
 assert.equal(degraded.managerSpotlightsHasMore,true);
 failManager=0;
 reads=[];
 const second=await loadInitialTournamentSpotlights('cup',participants.filter(p=>p.hattrick_user_id!==selected),true);
 assert.equal(second.managerSpotlight.managerId,selected);assert.equal(reads.length,2);
 winner=null;reads=[];
 const empty=await loadInitialTournamentSpotlights('cup',[],true);
 assert.equal(empty.managerSpotlight,null);assert.equal(reads.length,0);assert.equal(winner,null);

 const multi=[{id:'a',ht_team_id:11,hattrick_user_id:1,name:'First'}, {id:'b',ht_team_id:12,hattrick_user_id:1,name:'Second'}];
 const clubs=await loadInitialTournamentSpotlights('cup',multi,true);
 assert.equal(clubs.managerSpotlights.length,1);
 assert.equal(clubs.managerSpotlight.currentTeams.filter(t=>t.isTournamentTeam).length,2);
 failProfile=true;
 const failed=await loadInitialTournamentSpotlights('cup',multi,true);
 assert.equal(failed.managerSpotlight,null);
 console.log('PASS');
 `], {encoding:'utf8',timeout:15000});
 assert.match(output,/PASS/);
});
test('migration denies public writes and resolves concurrent selection without replacement',()=>{
 const sql=readFileSync('migrations/155_daily_manager_spotlights.sql','utf8');
 assert.match(sql,/enable row level security/);
 assert.match(sql,/from public, anon, authenticated/g);
 assert.match(sql,/on conflict \(tournament_id, utc_date\) do nothing/);
 assert.match(sql,/security invoker/);
});

test('daily selection has service-only grants, no public policies, and no empty persisted choice', () => {
 const sql=readFileSync('migrations/155_daily_manager_spotlights.sql','utf8');
 assert.match(sql,/revoke all on public\.daily_manager_spotlights from public, anon, authenticated;/i);
 assert.match(sql,/revoke all on function public\.resolve_daily_manager_spotlight\(uuid, date, jsonb\) from public, anon, authenticated;/i);
 assert.match(sql,/grant select, insert on public\.daily_manager_spotlights to service_role;/i);
 assert.match(sql,/grant execute on function public\.resolve_daily_manager_spotlight\(uuid, date, jsonb\) to service_role;/i);
 assert.doesNotMatch(sql,/create policy|security definer|grant[^;]+to (?:public|anon|authenticated)/i);
 assert.match(sql,/if p_participant is not null then[\s\S]+insert into[\s\S]+on conflict \(tournament_id, utc_date\) do nothing;[\s\S]+end if;/i);
 assert.match(sql,/p_utc_date <> \(now\(\) at time zone 'UTC'\)::date/i);
 assert.match(sql,/primary key \(tournament_id, utc_date\)/i);
});
