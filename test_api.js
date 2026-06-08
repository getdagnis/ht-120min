const fetch = require('node-fetch');
async function test() {
  const res = await fetch('http://localhost:5173/api/teams/refresh-fixtures?tournament_id=9433bdfa-a69e-4d4e-9130-04dbb217087d');
  console.log(res.status);
  console.log(await res.text());
}
test();
