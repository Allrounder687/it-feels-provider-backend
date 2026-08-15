export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      if (path === '/') {
        return new Response('IT Feels Cloudflare Worker is running!\n', { headers: corsHeaders });
      }

      // 1. Search Endpoint
      if (path === '/api/v1/search') {
        const query = url.searchParams.get('query') || '';
        const page = url.searchParams.get('page') || '1';
        const limit = url.searchParams.get('limit') || '20';

        if (!query) {
          return new Response(JSON.stringify({ success: false, error: 'Query required' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&p=${page}&n=${limit}&q=${encodeURIComponent(query)}&_format=json&_marker=0&api_version=4`;
        const res = await fetch(saavnUrl);
        const data = await res.json();
        const results = data.results || [];

        const normalizedResults = results.map(e => ({
          id: e.id,
          title: decodeHtml(e.title || ''),
          artist: decodeHtml(e.subtitle || ''),
          album: decodeHtml((e.more_info && e.more_info.album) || ''),
          duration: parseInt((e.more_info && e.more_info.duration) || '0') || 0,
          coverArt: (e.image || '').replace('150x150', '500x500'),
          encryptedMediaUrl: (e.more_info && e.more_info.encrypted_media_url) || '',
          hasLyrics: (e.more_info && e.more_info.has_lyrics) === 'true',
          language: e.language || 'unknown',
          year: parseInt(e.year || '2024') || 2024,
          explicit: e.explicit_content === '1',
        }));

        return new Response(JSON.stringify({ success: true, results: normalizedResults }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 2. Home Feed Endpoint
      if (path === '/api/v1/home') {
        const saavnUrl = 'https://www.jiosaavn.com/api.php?__call=webapi.getLaunchData&api_version=4&_format=json&_marker=0';
        const res = await fetch(saavnUrl);
        const data = await res.json();

        let trending = [];
        let playlists = [];

        if (data.new_trending) {
          trending = data.new_trending.map(e => ({
            id: e.id,
            title: decodeHtml(e.title || ''),
            artist: decodeHtml(e.subtitle || ''),
            album: decodeHtml((e.more_info && e.more_info.album) || ''),
            duration: parseInt((e.more_info && e.more_info.duration) || '0') || 0,
            coverArt: (e.image || '').replace('150x150', '500x500'),
          }));
        }

        if (data.top_playlists) {
          playlists = data.top_playlists.map(e => ({
            id: e.id,
            title: decodeHtml(e.title || ''),
            subtitle: decodeHtml(e.subtitle || ''),
            type: e.type || 'playlist',
            image: (e.image || '').replace('150x150', '500x500'),
          }));
        }

        return new Response(JSON.stringify({
          success: true,
          data: { trending: trending, playlists: playlists }
        }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 3. Streaming & Video Resolution Endpoint
      if (path === '/api/v1/video/stream') {
        const videoId = url.searchParams.get('id') || '';
        const query = url.searchParams.get('query') || '';

        if (!videoId && !query) {
          return new Response(JSON.stringify({ success: false, error: 'id or query required' }), {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        let cleanId = videoId.includes(':') ? videoId.split(':').pop() : videoId;
        let searchQuery = query ? query : videoId.replace('search:', '');

        const pipedInstances = [
          'https://pipedapi.moomoo.me',
          'https://pipedapi.syncpundit.io',
          'https://piapi.ggtyler.dev',
          'https://api.piped.private.coffee',
        ];

        // Resolve generic search strings to YouTube IDs via Piped API
        if (!cleanId || videoId.startsWith('search:') || cleanId.length !== 11) {
          let foundId = null;
          for (const instance of pipedInstances) {
            try {
              // Create an AbortController for a 2-second timeout
              const controller = new AbortController();
              const timeoutId = setTimeout(() => controller.abort(), 2000);
              
              const searchRes = await fetch(`${instance}/search?q=${encodeURIComponent(searchQuery)}&filter=all`, {
                 signal: controller.signal
              });
              clearTimeout(timeoutId);

              if (searchRes.ok) {
                const searchData = await searchRes.json();
                const items = searchData.items || [];
                const videoItem = items.find(i => i.type === 'stream' && i.url.includes('/watch?v='));
                if (videoItem) {
                  foundId = videoItem.url.split('v=')[1];
                  break;
                }
              }
            } catch (e) {
               // ignore and try next instance
            }
          }
          
          if (foundId) {
            cleanId = foundId;
          } else {
            return new Response(JSON.stringify({ success: true, streams: [] }), {
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            });
          }
        }

        // Fetch direct streams using resolved ID
        for (const instance of pipedInstances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2500);

            const streamRes = await fetch(`${instance}/streams/${cleanId}`, {
               signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (streamRes.ok) {
              const data = await streamRes.json();
              if (data.videoStreams) {
                const streams = [];
                for (const stream of data.videoStreams) {
                  if (stream.quality && stream.url) {
                    const format = (stream.format || 'MP4').toUpperCase();
                    const codec = (stream.codec || '').toLowerCase();
                    const isH264 = codec.includes('avc1') || format.includes('MP4');

                    if (isH264 || stream.videoOnly === false) {
                      streams.push({
                        quality: stream.quality,
                        url: stream.url,
                        mimeType: 'video/mp4',
                        videoOnly: stream.videoOnly === true,
                        codec: codec,
                      });
                    }
                  }
                }

                let audioUrl = '';
                if (data.audioStreams && data.audioStreams.length > 0) {
                  const bestAudio = data.audioStreams.reduce((a, b) => (a.bitrate || 0) > (b.bitrate || 0) ? a : b);
                  audioUrl = bestAudio.url || '';
                }

                return new Response(JSON.stringify({
                  success: true,
                  title: data.title || 'Video',
                  streams: streams,
                  audioUrl: audioUrl,
                }), {
                  headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
              }
            }
          } catch (e) {}
        }

        // Exhausted piped instances
        return new Response(JSON.stringify({ success: true, streams: [] }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 4. Deezer Proxy Endpoint
      if (path.startsWith('/api/v1/deezer/')) {
        const deezerPath = path.replace('/api/v1/deezer/', '');
        const query = url.search;
        const deezerUrl = `https://api.deezer.com/${deezerPath}${query}`;
        try {
          const res = await fetch(deezerUrl);
          const data = await res.text();
          return new Response(data, {
            status: res.status,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      // 5. Spotify Token Endpoint
      if (path === '/spotify/token') {
        const clientId = env.SPOTIFY_CLIENT_ID || '';
        const clientSecret = env.SPOTIFY_CLIENT_SECRET || '';

        if (!clientId || !clientSecret) {
          return new Response(JSON.stringify({ error: 'Missing Spotify credentials in backend environment' }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          });
        }

        const authBase64 = btoa(`${clientId}:${clientSecret}`);

        try {
          const spotifyRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
              'Authorization': `Basic ${authBase64}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: 'grant_type=client_credentials'
          });

          const data = await spotifyRes.text();
          return new Response(data, {
            status: spotifyRes.status,
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders
            }
          });
        } catch (e) {
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }
      }

      return new Response(JSON.stringify({ success: false, error: 'Not Found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (err) {
      return new Response(JSON.stringify({ success: false, error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  },
};

function decodeHtml(html) {
  return html
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&');
}
