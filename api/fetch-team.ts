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
    const url = `https://www.hattrick.org/Club/?TeamID=${teamId}`;
    
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,webp,image/apng,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': 'https://www.google.com/',
        'Sec-Fetch-Dest': 'document',
        'Sec-Fetch-Mode': 'navigate',
        'Sec-Fetch-Site': 'cross-site',
        'Sec-Fetch-User': '?1',
        'Upgrade-Insecure-Requests': '1'
      }
    });

    if (!res.ok) {
      console.error(`Hattrick fetch failed with status: ${res.status}`);
      return response.status(res.status).json({ 
        error: `Hattrick (Error ${res.status}): Access denied. You may need to enter the name manually.` 
      });
    }

    const html = await res.text();
    
    // Improved regex to handle the HTML snippet you provided
    let teamName = '';
    const teamNameMatch = html.match(/class="teamNameTitle">([\s\S]*?)<a/i);
    
    if (teamNameMatch && teamNameMatch[1]) {
      // Remove all HTML tags and trim whitespace/newlines
      teamName = teamNameMatch[1].replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
    }

    if (!teamName) {
      const titleMatch = html.match(/<title>(.*?)<\/title>/i);
      if (titleMatch && titleMatch[1]) {
        teamName = titleMatch[1].split(' - ')[0].trim();
      }
    }

    if (!teamName || teamName.toLowerCase() === 'hattrick') {
      return response.status(404).json({ error: 'Could not extract team name. Try manual entry.' });
    }

    return response.status(200).json({
      teamId,
      teamName
    });
  } catch (error: any) {
    return response.status(500).json({ error: `Server error: ${error.message}` });
  }
}
