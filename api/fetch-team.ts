import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(
  request: VercelRequest,
  response: VercelResponse
) {
  const { teamId } = request.query;

  if (!teamId) {
    return response.status(400).json({ error: 'teamId is required' });
  }

  try {
    // We use the direct Club URL instead of the ashx redirect to minimize hop issues in serverless
    const url = `https://www.hattrick.org/Club/?TeamID=${teamId}`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });

    if (!res.ok) {
      // Log specific status to help debugging
      console.error(`Hattrick fetch failed with status: ${res.status}`);
      return response.status(res.status).json({ 
        error: `Hattrick returned error ${res.status}. They might be blocking the request.` 
      });
    }

    const html = await res.text();
    
    // Target the specific div class: <div class="teamNameTitle">Team Name...</div>
    let teamName = '';
    const teamNameMatch = html.match(/<div class="teamNameTitle">([\s\S]*?)<a/i);
    
    if (teamNameMatch && teamNameMatch[1]) {
      teamName = teamNameMatch[1].replace(/<[^>]*>?/gm, '').trim();
    }

    // Fallback to title if the specific div isn't found
    if (!teamName) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        teamName = titleMatch[1].split(' - ')[0].trim();
      }
    }

    if (!teamName || teamName.toLowerCase() === 'hattrick') {
      return response.status(404).json({ error: 'Could not extract team name from page.' });
    }

    return response.status(200).json({
      teamId,
      teamName
    });
  } catch (error: any) {
    return response.status(500).json({ error: `Server error: ${error.message}` });
  }
}
