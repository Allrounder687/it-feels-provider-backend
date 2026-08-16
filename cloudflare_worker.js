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

        const normalizedResults = results.map(e => {
          let artistName = decodeHtml(e.subtitle || '');
          if (!artistName && e.more_info && e.more_info.artistMap && e.more_info.artistMap.primary_artists) {
            const pa = e.more_info.artistMap.primary_artists;
            if (Array.isArray(pa)) {
              artistName = pa.map(a => decodeHtml(a.name)).join(', ');
            }
          }
          if (!artistName && e.more_info && e.more_info.music) {
            artistName = decodeHtml(e.more_info.music);
          }

          return {
            id: e.id,
            title: decodeHtml(e.title || ''),
            artist: artistName,
            album: decodeHtml((e.more_info && e.more_info.album) || ''),
            duration: parseInt((e.more_info && e.more_info.duration) || '0') || 0,
            coverArt: (e.image || '').replace('150x150', '500x500'),
            encryptedMediaUrl: (e.more_info && e.more_info.encrypted_media_url) || '',
            hasLyrics: (e.more_info && e.more_info.has_lyrics) === 'true',
            language: e.language || 'unknown',
            year: parseInt(e.year || '2024') || 2024,
            explicit: e.explicit_content === '1',
            playCount: parseInt(e.play_count || '0') || 0,
          };
        });

        return new Response(JSON.stringify({ success: true, results: normalizedResults }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 1.b Search Playlists Endpoint (Saavn)
      if (path === '/api/v1/search/playlists') {
        const query = url.searchParams.get('query') || '';
        if (!query) return new Response(JSON.stringify({ success: false, results: [] }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        const saavnUrl = `https://www.jiosaavn.com/api.php?__call=search.getPlaylistResults&q=${encodeURIComponent(query)}&p=1&n=20&api_version=4&_format=json&_marker=0`;
        const res = await fetch(saavnUrl);
        const data = await res.json();
        const results = (data.results || []).map(e => ({
          id: e.id,
          title: decodeHtml(e.title || ''),
          subtitle: decodeHtml(e.subtitle || ''),
          type: 'playlist',
          image: (e.image || '').replace('50x50', '500x500').replace('150x150', '500x500'),
        }));
        return new Response(JSON.stringify({ success: true, results }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // 1.d Charts Endpoint
      if (path === '/api/v1/charts') {
        const dzUrl = 'https://api.deezer.com/chart';
        const res = await fetch(dzUrl);
        const data = await res.json();
        const tracks = (data.tracks && data.tracks.data ? data.tracks.data : []).map(e => ({
          id: e.id.toString(),
          title: e.title,
          artist: e.artist ? e.artist.name : 'Unknown Artist',
          album: e.album ? e.album.title : '',
          duration: e.duration || 0,
          coverArt: e.album ? e.album.cover_xl : '',
        }));
        const playlists = (data.playlists && data.playlists.data ? data.playlists.data : []).map(e => ({
          id: e.id.toString(),
          title: e.title,
          subtitle: e.user ? e.user.name : '',
          type: 'playlist',
          image: e.picture_xl || '',
        }));
        return new Response(JSON.stringify({ success: true, data: { tracks, playlists } }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // 1.e Playlist Tracks Endpoint (Deezer or Saavn depending on ID format)
      if (path === '/api/v1/playlist') {
        const id = url.searchParams.get('id') || '';
        const type = url.searchParams.get('type') || 'playlist';
        if (!id) return new Response(JSON.stringify({ success: false, tracks: [] }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        // If ID is all digits and it's not explicitly an album, it's likely a Deezer playlist
        if (/^\d+$/.test(id) && type !== 'album') {
          const dzUrl = `https://api.deezer.com/playlist/${id}/tracks`;
          const res = await fetch(dzUrl);
          const data = await res.json();
          const tracks = (data.data || []).map(e => ({
            id: e.id.toString(),
            title: e.title,
            artist: e.artist ? e.artist.name : 'Unknown Artist',
            album: e.album ? e.album.title : '',
            duration: e.duration || 0,
            coverArt: e.album ? (e.album.cover_xl || e.album.cover_medium) : '',
          }));
          return new Response(JSON.stringify({ success: true, tracks }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } else {
          // Else assume Saavn
          let saavnUrl = '';
          if (type === 'album') {
            saavnUrl = `https://www.jiosaavn.com/api.php?__call=content.getAlbumDetails&_format=json&cc=in&_marker=0&api_version=4&ctx=web6dot0&albumid=${id}`;
          } else {
            saavnUrl = `https://www.jiosaavn.com/api.php?__call=playlist.getDetails&_format=json&cc=in&_marker=0&api_version=4&ctx=web6dot0&listid=${id}`;
          }
          const res = await fetch(saavnUrl);
          const data = await res.json();
          const rawList = data.songs || data.list || [];
          const tracks = rawList.map(e => {
            let artistName = decodeHtml(e.subtitle || e.primary_artists || '');
            if (!artistName && e.more_info && e.more_info.artistMap && e.more_info.artistMap.primary_artists) {
              const pa = e.more_info.artistMap.primary_artists;
              if (Array.isArray(pa)) {
                artistName = pa.map(a => decodeHtml(a.name)).join(', ');
              }
            }
            if (!artistName && e.more_info && e.more_info.music) {
              artistName = decodeHtml(e.more_info.music);
            }

            return {
              id: e.id,
              title: decodeHtml(e.title || e.name || ''),
              artist: artistName,
              album: decodeHtml((e.more_info && e.more_info.album) || ''),
              duration: parseInt((e.more_info && e.more_info.duration) || '0') || 0,
              coverArt: (e.image || '').replace('150x150', '500x500'),
              encryptedMediaUrl: (e.more_info && e.more_info.encrypted_media_url) || '',
              hasLyrics: (e.more_info && e.more_info.has_lyrics) === 'true',
              language: e.language || 'unknown',
              year: parseInt(e.year || '2024') || 2024,
              explicit: e.explicit_content === '1',
              playCount: parseInt(e.play_count || '0') || 0,
            };
          });
          return new Response(JSON.stringify({ success: true, tracks }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }

      // 1.f Lyrics Endpoint (Saavn)
      if (path === '/api/v1/lyrics') {
        const track = url.searchParams.get('track') || '';
        const artist = url.searchParams.get('artist') || '';
        if (!track) return new Response(JSON.stringify({ success: false }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&q=${encodeURIComponent(track + ' ' + artist)}&p=1&n=5&api_version=4&_format=json&_marker=0`;
        const res = await fetch(searchUrl);
        const data = await res.json();
        const results = data.results || [];
        if (results.length > 0) {
          const songId = results[0].id;
          const lyricsUrl = `https://www.jiosaavn.com/api.php?__call=lyrics.getLyrics&lyrics_id=${songId}&ctx=web6dot0&api_version=4&_format=json&_marker=0`;
          const lyricsRes = await fetch(lyricsUrl);
          const lyricsData = await lyricsRes.json();
          if (lyricsData.lyrics) {
            return new Response(JSON.stringify({
              success: true,
              lyrics: {
                plain: lyricsData.lyrics.replace(/<br>/g, '\n'),
                synced: null
              }
            }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
          }
        }
        return new Response(JSON.stringify({ success: false }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
      }

      // 1.c Search Podcasts Endpoint (YouTube HTML Scraper)
      if (path === '/api/v1/search/podcasts') {
        const query = url.searchParams.get('query') || '';
        if (!query) return new Response(JSON.stringify({ success: false, results: [] }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });

        try {
          const ytUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(query + ' podcast')}`;
          const res = await fetch(ytUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          const html = await res.text();
          const match = html.match(/ytInitialData\s*=\s*({.+?});/);
          let results = [];

          if (match && match[1]) {
            const data = JSON.parse(match[1]);
            const contents = data.contents?.twoColumnSearchResultsRenderer?.primaryContents?.sectionListRenderer?.contents || [];

            for (let section of contents) {
              if (section.itemSectionRenderer) {
                for (let item of section.itemSectionRenderer.contents) {
                  if (item.videoRenderer) {
                    const video = item.videoRenderer;

                    // Fixed Duration Logic: Properly account for HH:MM:SS format
                    let parsedDuration = 0;
                    if (video.lengthText && video.lengthText.simpleText) {
                      const timeParts = video.lengthText.simpleText.split(':').map(Number);
                      if (timeParts.length === 3) {
                        parsedDuration = (timeParts[0] * 3600) + (timeParts[1] * 60) + (timeParts[2] || 0);
                      } else if (timeParts.length === 2) {
                        parsedDuration = (timeParts[0] * 60) + (timeParts[1] || 0);
                      } else if (timeParts.length === 1) {
                        parsedDuration = timeParts[0] || 0;
                      }
                    }

                    results.push({
                      id: 'yt:' + video.videoId,
                      title: video.title?.runs?.[0]?.text || 'Podcast',
                      artist: video.ownerText?.runs?.[0]?.text || 'YouTube',
                      album: 'Podcast',
                      duration: parsedDuration,
                      coverArt: video.thumbnail?.thumbnails?.pop()?.url || '',
                    });
                  }
                }
              }
            }
          }

          return new Response(JSON.stringify({ success: true, results: results.slice(0, 15) }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        } catch (e) {
          return new Response(JSON.stringify({ success: false, error: e.toString() }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
        }
      }

      // 2. Home Feed Endpoint
      if (path === '/api/v1/home') {
        const saavnUrl = 'https://www.jiosaavn.com/api.php?__call=webapi.getLaunchData&api_version=4&_format=json&_marker=0';
        const res = await fetch(saavnUrl);
        const data = await res.json();

        let trending = [];
        let playlists = [];

        if (data.new_trending) {
          for (const e of data.new_trending) {
            if (e.type === 'song') {
              trending.push({
                id: e.id,
                title: decodeHtml(e.title || ''),
                artist: decodeHtml(e.subtitle || ''),
                album: decodeHtml((e.more_info && e.more_info.album) || ''),
                duration: parseInt((e.more_info && e.more_info.duration) || '0') || 0,
                coverArt: (e.image || '').replace('150x150', '500x500'),
              });
            } else {
              playlists.push({
                id: e.id,
                title: decodeHtml(e.title || ''),
                subtitle: decodeHtml(e.subtitle || ''),
                type: e.type || 'playlist',
                image: (e.image || '').replace('150x150', '500x500'),
              });
            }
          }
        }

        if (data.top_playlists) {
          for (const e of data.top_playlists) {
            playlists.push({
              id: e.id,
              title: decodeHtml(e.title || ''),
              subtitle: decodeHtml(e.subtitle || ''),
              type: e.type || 'playlist',
              image: (e.image || '').replace('150x150', '500x500'),
            });
          }
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

        if (cleanId && !videoId.startsWith('search:')) {
          try {
            const detailsRes = await fetch(`https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${cleanId}&api_version=4&_format=json&_marker=0`);
            const detailsData = await detailsRes.json();

            if (detailsData && detailsData[cleanId] && detailsData[cleanId].more_info && detailsData[cleanId].more_info.encrypted_media_url) {
              const encUrl = detailsData[cleanId].more_info.encrypted_media_url;
              const authRes = await fetch(`https://www.jiosaavn.com/api.php?__call=song.generateAuthToken&url=${encodeURIComponent(encUrl)}&bitrate=128&api_version=4&_format=json&ctx=web6dot0&_marker=0`);
              const authData = await authRes.json();
              if (authData && authData.auth_url) {
                return new Response(JSON.stringify({
                  success: true,
                  title: detailsData[cleanId].title || 'Audio',
                  streams: [{
                    quality: 'audio',
                    url: authData.auth_url,
                    mimeType: 'audio/mp4',
                    videoOnly: false,
                    codec: 'mp4a'
                  }],
                  audioUrl: authData.auth_url,
                }), {
                  headers: { 'Content-Type': 'application/json', ...corsHeaders },
                });
              }
            }
          } catch (e) {
            // Ignore and fallback to Piped
          }
        }

        const pipedInstances = [
          'https://pipedapi.moomoo.me',
          'https://pipedapi.syncpundit.io',
          'https://piapi.ggtyler.dev',
          'https://api.piped.private.coffee',
        ];

        if (!cleanId || videoId.startsWith('search:') || cleanId.length !== 11) {
          let foundId = null;
          for (const instance of pipedInstances) {
            try {
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
          } catch (e) { }
        }

        try {
          const ytUrl = `https://www.youtube.com/watch?v=${cleanId}`;
          const ytRes = await fetch(ytUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 Safari/537.36',
              'Accept-Language': 'en-US,en;q=0.9'
            }
          });
          const html = await ytRes.text();
          const match = html.match(/ytInitialPlayerResponse\s*=\s*({.+?});/);

          if (match && match[1]) {
            const ytData = JSON.parse(match[1]);
            if (ytData.streamingData && ytData.streamingData.adaptiveFormats) {
              const formats = ytData.streamingData.adaptiveFormats;
              let streams = [];

              for (const f of formats) {
                if (!f.mimeType) continue;

                let fUrl = f.url || '';
                if (!fUrl && f.signatureCipher) {
                  const cipherParams = new URLSearchParams(f.signatureCipher);
                  fUrl = cipherParams.get('url') || '';
                }

                if (fUrl) {
                  if (f.mimeType.includes('video/')) {
                    const isH264 = f.mimeType.includes('avc1') || f.mimeType.includes('mp4');
                    if (isH264) {
                      streams.push({
                        quality: f.qualityLabel || '720p',
                        url: fUrl,
                        mimeType: 'video/mp4',
                        videoOnly: true,
                        codec: 'avc1'
                      });
                    }
                  } else if (f.mimeType.includes('audio/')) {
                    streams.push({
                      quality: 'audio',
                      url: fUrl,
                      mimeType: f.mimeType,
                      videoOnly: false,
                      codec: f.mimeType.includes('mp4a') ? 'mp4a' : 'opus',
                      bitrate: f.bitrate || 0
                    });
                  }
                }
              }

              // Fixed Logic: Return the stream list regardless if audio specifically is found or not.
              if (streams.length > 0) {
                const audioStreams = streams.filter(s => s.quality === 'audio');
                audioStreams.sort((a, b) => (b.bitrate || 0) - (a.bitrate || 0));

                return new Response(JSON.stringify({
                  success: true,
                  title: ytData.videoDetails ? ytData.videoDetails.title : 'Video',
                  streams: streams,
                  audioUrl: audioStreams.length > 0 ? audioStreams[0].url : ''
                }), { headers: { 'Content-Type': 'application/json', ...corsHeaders } });
              }
            }
          }
        } catch (e) {
          // Fallthrough
        }

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

      // 6. LastFM Auth Endpoint
      if (path === '/api/v1/lastfm/auth' && request.method === 'POST') {
        const bodyText = await request.text();
        const data = JSON.parse(bodyText);
        const { username, password } = data;

        const apiKey = env.LASTFM_API_KEY || '';
        const secret = env.LASTFM_SHARED_SECRET || '';

        if (!apiKey || !secret) {
          return new Response(JSON.stringify({ error: 'Missing LastFM credentials in backend' }), {
            status: 500, headers: { 'Content-Type': 'application/json', ...corsHeaders }
          });
        }

        const params = {
          method: 'auth.getMobileSession',
          username, password, api_key: apiKey
        };

        const apiSig = await generateLastFmSignature(params, secret);
        const searchParams = new URLSearchParams({ ...params, api_sig: apiSig, format: 'json' });

        const lastfmRes = await fetch('https://ws.audioscrobbler.com/2.0/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: searchParams.toString()
        });

        return new Response(await lastfmRes.text(), {
          status: lastfmRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 7. LastFM Now Playing Endpoint
      if (path === '/api/v1/lastfm/nowplaying' && request.method === 'POST') {
        const bodyText = await request.text();
        let data = {};
        try { data = JSON.parse(bodyText); } catch (e) { }

        const apiKey = env.LASTFM_API_KEY || '';
        const secret = env.LASTFM_SHARED_SECRET || '';

        const params = {
          method: 'track.updateNowPlaying',
          track: data.track,
          artist: data.artist,
          api_key: apiKey,
          sk: data.sk
        };
        if (data.album) params.album = data.album;
        if (data.duration) params.duration = data.duration;

        const apiSig = await generateLastFmSignature(params, secret);
        const searchParams = new URLSearchParams({ ...params, api_sig: apiSig, format: 'json' });

        const lastfmRes = await fetch('https://ws.audioscrobbler.com/2.0/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: searchParams.toString()
        });

        return new Response(await lastfmRes.text(), {
          status: lastfmRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 8. LastFM Scrobble Endpoint
      if (path === '/api/v1/lastfm/scrobble' && request.method === 'POST') {
        const bodyText = await request.text();
        let data = {};
        try { data = JSON.parse(bodyText); } catch (e) { }

        const apiKey = env.LASTFM_API_KEY || '';
        const secret = env.LASTFM_SHARED_SECRET || '';

        const params = {
          method: 'track.scrobble',
          'track[0]': data.track,
          'artist[0]': data.artist,
          // Fixed Safety Fallback: Default to current timestamp if omitted
          'timestamp[0]': (data.timestamp || Math.floor(Date.now() / 1000)).toString(),
          api_key: apiKey,
          sk: data.sk
        };
        if (data.album) params['album[0]'] = data.album;

        const apiSig = await generateLastFmSignature(params, secret);
        const searchParams = new URLSearchParams({ ...params, api_sig: apiSig, format: 'json' });

        const lastfmRes = await fetch('https://ws.audioscrobbler.com/2.0/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: searchParams.toString()
        });

        return new Response(await lastfmRes.text(), {
          status: lastfmRes.status,
          headers: { 'Content-Type': 'application/json', ...corsHeaders }
        });
      }

      // 9. Video Search Endpoint (Piped API)
      // FIX: Removed `|| path === '/api/v1/search/podcasts'` which was unreachable duplicate logic
      if (path === '/api/v1/search/videos') {
        const query = url.searchParams.get('query') || '';

        const pipedInstances = [
          'https://pipedapi.moomoo.me',
          'https://pipedapi.syncpundit.io',
          'https://piapi.ggtyler.dev',
          'https://api.piped.private.coffee',
        ];

        let results = [];
        for (const instance of pipedInstances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const searchRes = await fetch(`${instance}/search?q=${encodeURIComponent(query)}&filter=all`, {
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (searchRes.ok) {
              const searchData = await searchRes.json();
              const items = searchData.items || [];
              const videoItems = items.filter(i => i.type === 'stream' && i.url.includes('/watch?v='));
              results = videoItems.map(item => ({
                id: item.url.split('v=')[1],
                title: item.title,
                uploader: item.uploaderName,
                duration: item.duration,
                thumbnail: item.thumbnail
              }));
              break;
            }
          } catch (e) {
            // try next instance
          }
        }

        return new Response(JSON.stringify({ success: true, results: results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }

      // 10. Trending Videos Endpoint
      if (path === '/api/v1/trending/videos') {
        const pipedInstances = [
          'https://pipedapi.moomoo.me',
          'https://pipedapi.syncpundit.io',
          'https://piapi.ggtyler.dev',
          'https://api.piped.private.coffee',
        ];

        let results = [];
        for (const instance of pipedInstances) {
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 2000);

            const searchRes = await fetch(`${instance}/trending?region=IN`, {
              signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (searchRes.ok) {
              const items = await searchRes.json();
              const videoItems = items.filter(i => i.type === 'stream' && i.url.includes('/watch?v='));
              results = videoItems.map(item => ({
                id: item.url.split('v=')[1],
                title: item.title,
                uploader: item.uploaderName,
                duration: item.duration,
                thumbnail: item.thumbnail
              }));
              break;
            }
          } catch (e) {
            // try next instance
          }
        }

        return new Response(JSON.stringify({ success: true, results: results }), {
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
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

async function generateLastFmSignature(params, secret) {
  const keys = Object.keys(params).sort();
  let sigStr = '';
  for (const k of keys) {
    if (params[k] !== undefined && params[k] !== null) {
      sigStr += `${k}${params[k]}`;
    }
  }
  sigStr += secret;

  // Cloudflare Workers WebCrypto MD5 support
  const msgUint8 = new TextEncoder().encode(sigStr);
  const hashBuffer = await crypto.subtle.digest('MD5', msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}