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
    const url = `https://www.hattrick.org/goto.ashx?path=/Club/?TeamID=${teamId}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    if (!res.ok) {
      return response.status(500).json({ error: 'Failed to fetch from Hattrick' });
    }

    const html = await res.text();
    
    // Try to extract team name from <title> or <h1>
    // Hattrick title format is usually: "Team Name - Hattrick" or similar
    let teamName = '';
    const titleMatch = html.match(/<title>(.*?)<\/title>/i);
    if (titleMatch && titleMatch[1]) {
      teamName = titleMatch[1].split(' - ')[0].trim();
    }

    if (!teamName || teamName.toLowerCase() === 'hattrick') {
      // Fallback: search for header with team name
      const h1Match = html.match(/<h1[^>]*>(.*?)<\/h1>/i);
      if (h1Match && h1Match[1]) {
        teamName = h1Match[1].trim();
      }
    }

    if (!teamName) {
      return response.status(404).json({ error: 'Team name not found' });
    }

    return response.status(200).json({
      teamId,
      teamName
    });
  } catch (error: any) {
    return response.status(500).json({ error: error.message });
  }
}
