import type { VercelRequest, VercelResponse } from '@vercel/node';
import { rejectIfTestingDisabled } from './_lib/guard.js';

const DEFAULT_MANAGER_ID = '8777402';
const DEFAULT_TEAM_ID = '681813';
const DEFAULT_OPPONENT_TEAM_ID = '3310896';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (rejectIfTestingDisabled(res)) return;

  const base = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}/api/testing`;

  if (String(req.query.format ?? '').toLowerCase() === 'json') {
    return res.status(200).json({
      enabled: true,
      base,
      defaults: { managerId: DEFAULT_MANAGER_ID, teamId: DEFAULT_TEAM_ID },
    });
  }

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>HT-120min Testing Tools</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; line-height: 1.5; max-width: 920px; }
    h1 { font-size: 1.25rem; }
    h2 { font-size: 1rem; margin-top: 1.75rem; }
    code { background: #f4f4f4; padding: 0.1rem 0.35rem; border-radius: 4px; }
    .ids { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 0.75rem 1rem; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; margin: 1rem 0 1.5rem; background: #fafafa; }
    .ids label { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.85rem; color: #444; }
    .ids input { font: inherit; padding: 0.45rem 0.55rem; border: 1px solid #ccc; border-radius: 6px; }
    .tool { margin: 1rem 0; padding: 1rem; border: 1px solid #ddd; border-radius: 8px; }
    .tool h3 { margin: 0 0 0.35rem; font-size: 0.95rem; }
    .tool p { margin: 0.35rem 0; color: #555; font-size: 0.9rem; }
    .links { display: flex; flex-wrap: wrap; gap: 0.75rem 1.25rem; margin-top: 0.65rem; }
    a { color: #0b57d0; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .muted { color: #666; font-size: 0.85rem; }
    ol { margin-top: 0.75rem; padding-left: 1.25rem; }
    ol a { font-weight: 600; }
  </style>
</head>
<body>
  <h1>HT-120min /testing toolkit</h1>
  <p class="muted">Dev-only. Disabled in production unless <code>TESTING_ENABLED=true</code>.</p>
  <p class="muted">Run <code>vercel dev</code> (port 3000). Vite proxies <code>/testing</code> and <code>/api</code>.</p>

  <div class="tool" style="background:#fff8e6;border-color:#e6c200">
    <h3>How auth works here</h3>
    <p><strong>Incognito does not matter.</strong> These tools do not read browser cookies. They load <code>oauth_token</code> + <code>oauth_token_secret</code> from Supabase for the <code>managerId</code> you type below, then sign CHPP requests with <em>app</em> consumer key/secret + <em>user</em> access token/secret.</p>
    <p>App credentials alone cannot impersonate your team. If challenges-view returns your data, user tokens are in the DB. Run <a id="link-oauth-verify" href="#">oauth-verify</a> first to confirm.</p>
  </div>

  <div class="ids">
    <label>
      Manager ID
      <input id="managerId" type="number" value="${DEFAULT_MANAGER_ID}" />
    </label>
    <label>
      My team ID
      <input id="teamId" type="number" value="${DEFAULT_TEAM_ID}" />
    </label>
    <label>
      Opponent team ID
      <input id="opponentTeamId" type="number" value="${DEFAULT_OPPONENT_TEAM_ID}" />
    </label>
    <label>
      CHPP version
      <input id="version" type="text" value="1.6" placeholder="1.6 or none" />
    </label>
  </div>

  <p class="muted">Challenge-send skips challengeable by default. Set <code>CHPP_REQUIRE_CHALLENGEABLE_CHECK=true</code> to re-enable. Server logs: <code>[CHPP challenges]</code> when challengeable runs.</p>

  <h2>Recommended order</h2>
  <ol>
    <li><a id="quick-oauth" href="#">oauth-verify</a> — prove user tokens exist and match managerId</li>
    <li><a id="quick-view" href="#">challenges-view</a></li>
    <li><a id="quick-compare" href="#">challenges-compare</a> (view vs challengeable variants)</li>
    <li><a id="quick-challengeable" href="#">challengeable</a></li>
    <li>Save raw XML into <code>docs/challenges.*.example.xml</code></li>
    <li><a id="quick-send" href="#">challenge-send</a> (direct, needs <code>confirm=1</code>)</li>
  </ol>

  <div class="tool">
    <h3>OAuth verify</h3>
    <p>Loads tokens from DB, calls <code>managercompendium</code>, checks CHPP UserID matches managerId.</p>
    <div class="links">
      <a id="link-oauth-verify-tool" href="#">Open (JSON)</a>
      <a id="link-credentials" href="#">credentials-check (same audit)</a>
    </div>
  </div>

  <div class="tool">
    <h3>Challenges view (Stage 1)</h3>
    <p><code>actionType=view</code> — uses same user tokens as oauth-verify. Does not prove challengeable works.</p>
    <div class="links">
      <a id="link-view" href="#">Readable (HTML)</a>
      <a id="link-view-json" href="#">JSON</a>
      <a id="link-view-xml" href="#">XML</a>
    </div>
  </div>

  <div class="tool">
    <h3>Challenges compare</h3>
    <p>Runs view + several challengeable parameter variants side-by-side. Use when view works but challengeable returns 401.</p>
    <div class="links">
      <a id="link-compare" href="#">Open (JSON)</a>
    </div>
  </div>

  <div class="tool">
    <h3>Challengeable (Stage 2)</h3>
    <p><code>actionType=challengeable</code> — safe eligibility check before sending.</p>
    <div class="links">
      <a id="link-challengeable" href="#">Readable (HTML)</a>
      <a id="link-challengeable-json" href="#">JSON</a>
      <a id="link-challengeable-xml" href="#">XML</a>
    </div>
  </div>

  <div class="tool">
    <h3>Challenge send (Stage 4)</h3>
    <p><code>actionType=challenge</code> — direct send (no challengeable gate). Requires <code>confirm=1</code>.</p>
    <div class="links">
      <a id="link-send" href="#">Readable (HTML)</a>
      <a id="link-send-json" href="#">JSON</a>
    </div>
  </div>

  <div class="tool">
    <h3>Booking status</h3>
    <p>Uses <code>matches</code> feed to detect booked friendlies.</p>
    <div class="links">
      <a id="link-booking" href="#">Open (JSON)</a>
    </div>
  </div>

  <p class="muted"><a href="${base}?format=json">JSON manifest</a></p>

  <script>
    const base = ${JSON.stringify(base)};
    const $ = (id) => document.getElementById(id);

    function readIds() {
      const managerId = $('managerId').value.trim() || ${JSON.stringify(DEFAULT_MANAGER_ID)};
      const teamId = $('teamId').value.trim() || ${JSON.stringify(DEFAULT_TEAM_ID)};
      const opponentTeamId = $('opponentTeamId').value.trim();
      const version = $('version').value.trim() || '1.6';
      return { managerId, teamId, opponentTeamId, version };
    }

    function chppParams(ids) {
      const params = {};
      if (ids.version && ids.version.toLowerCase() !== 'none') {
        params.version = ids.version;
      } else if (ids.version && ids.version.toLowerCase() === 'none') {
        params.omitVersion = '1';
      }
      return params;
    }

    function buildUrl(path, params) {
      const query = new URLSearchParams(params);
      return base + path + '?' + query.toString();
    }

    function updateLinks() {
      const ids = readIds();
      const { managerId, teamId, opponentTeamId } = ids;
      const core = { managerId, teamId, ...chppParams(ids) };
      const withOpponent = opponentTeamId
        ? { ...core, opponentTeamId }
        : { ...core, opponentTeamId: 'OPPONENT_ID' };

      $('link-oauth-verify').href = buildUrl('/oauth-verify', { managerId });
      $('link-oauth-verify-tool').href = buildUrl('/oauth-verify', { managerId });
      $('quick-oauth').href = $('link-oauth-verify').href;
      $('link-credentials').href = buildUrl('/credentials-check', { managerId });
      $('link-booking').href = buildUrl('/booking-status', core);
      $('link-compare').href = buildUrl('/challenges-compare', withOpponent);
      $('quick-compare').href = $('link-compare').href;

      $('link-view').href = buildUrl('/challenges-view', { ...core, format: 'html' });
      $('link-view-json').href = buildUrl('/challenges-view', core);
      $('link-view-xml').href = buildUrl('/challenges-view', { ...core, format: 'xml' });
      $('quick-view').href = $('link-view').href;

      $('link-challengeable').href = buildUrl('/challengeable', { ...withOpponent, format: 'html' });
      $('link-challengeable-json').href = buildUrl('/challengeable', withOpponent);
      $('link-challengeable-xml').href = buildUrl('/challengeable', { ...withOpponent, format: 'xml' });
      $('quick-challengeable').href = $('link-challengeable').href;

      $('link-send').href = buildUrl('/challenge-send', { ...withOpponent, confirm: '1', format: 'html' });
      $('link-send-json').href = buildUrl('/challenge-send', { ...withOpponent, confirm: '1' });
      $('quick-send').href = $('link-send').href;
    }

    ['managerId', 'teamId', 'opponentTeamId', 'version'].forEach((id) => {
      $(id).addEventListener('input', updateLinks);
    });

    updateLinks();
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.status(200).send(html);
}
