import 'dart:convert';
import 'dart:io';

import 'package:shelf/shelf.dart';
import 'package:shelf/shelf_io.dart';
import 'package:shelf_router/shelf_router.dart';
import 'package:youtube_explode_dart/youtube_explode_dart.dart';
import 'package:http/http.dart' as http;

final _yt = YoutubeExplode();

final _router = Router()
  ..get('/', _rootHandler)
  ..get('/api/v1/search', _searchHandler)
  ..get('/api/v1/video/stream', _streamHandler);

Response _rootHandler(Request req) {
  return Response.ok('IT Feels Provider Backend is running!\n');
}

Future<Response> _searchHandler(Request request) async {
  final query = request.url.queryParameters['query'] ?? '';
  final page = request.url.queryParameters['page'] ?? '1';
  final limit = request.url.queryParameters['limit'] ?? '20';

  if (query.isEmpty) {
    return Response.ok(
      jsonEncode({'success': false, 'error': 'Query required'}),
    );
  }

  try {
    final uri = Uri.parse(
      'https://www.jiosaavn.com/api.php?__call=search.getResults&p=$page&n=$limit&q=${Uri.encodeComponent(query)}&_format=json&_marker=0&api_version=4',
    );
    final response = await http.get(uri);

    if (response.statusCode == 200) {
      final data = jsonDecode(response.body);
      final List results = data['results'] ?? [];

      final normalizedResults = results.map((e) {
        return {
          'id': e['id'],
          'title': _decodeHtml(e['title'] ?? ''),
          'artist': _decodeHtml(
            e['subtitle'] ?? '',
          ), // Saavn puts primary artist in subtitle
          'album': _decodeHtml(e['more_info']?['album'] ?? ''),
          'duration': int.tryParse(e['more_info']?['duration'] ?? '0') ?? 0,
          'coverArt':
              (e['image'] as String?)?.replaceAll('150x150', '500x500') ?? '',
          'encryptedMediaUrl': e['more_info']?['encrypted_media_url'] ?? '',
          'hasLyrics': e['more_info']?['has_lyrics'] == 'true',
          'language': e['language'] ?? 'unknown',
          'year': int.tryParse(e['year'] ?? '2024') ?? 2024,
          'explicit': e['explicit_content'] == '1',
        };
      }).toList();

      return Response.ok(
        jsonEncode({'success': true, 'results': normalizedResults}),
        headers: {'Content-Type': 'application/json'},
      );
    }
  } catch (e) {
    print('Search error: $e');
  }

  return Response.ok(
    jsonEncode({'success': true, 'results': []}),
    headers: {'Content-Type': 'application/json'},
  );
}

Future<Response> _streamHandler(Request request) async {
  final videoId = request.url.queryParameters['id'] ?? '';
  final query = request.url.queryParameters['query'] ?? '';

  if (videoId.isEmpty && query.isEmpty) {
    return Response.ok(
      jsonEncode({'success': false, 'error': 'id or query required'}),
    );
  }

  String cleanId = videoId.contains(':') ? videoId.split(':').last : videoId;
  String searchQuery = query.isNotEmpty
      ? query
      : videoId.replaceFirst('search:', '');

  try {
    if (cleanId.isEmpty ||
        videoId.startsWith('search:') ||
        cleanId.length != 11) {
      final searchResults = await _yt.search.search(searchQuery);
      if (searchResults.isNotEmpty) {
        cleanId = searchResults.first.id.value;
      } else {
        return Response.ok(
          jsonEncode({'success': true, 'streams': []}),
          headers: {'Content-Type': 'application/json'},
        );
      }
    }

    // 1. Try Piped API Fallback first for better unthrottled CDNs
    final pipedInstances = [
      'https://pipedapi.moomoo.me',
      'https://pipedapi.syncpundit.io',
      'https://piapi.ggtyler.dev',
      'https://api.piped.private.coffee',
    ];

    for (final instance in pipedInstances) {
      try {
        final uri = Uri.parse('$instance/streams/$cleanId');
        final response = await http
            .get(uri)
            .timeout(const Duration(milliseconds: 1500));
        if (response.statusCode == 200) {
          final data = jsonDecode(response.body);
          if (data is Map && data['videoStreams'] != null) {
            final videoStreams = data['videoStreams'] as List;
            final audioStreams = data['audioStreams'] as List;

            final List<Map<String, dynamic>> streams = [];
            for (var stream in videoStreams) {
              if (stream['quality'] != null && stream['url'] != null) {
                // Prioritize H.264 / mp4 for hardware decoding
                final format =
                    stream['format']?.toString().toUpperCase() ?? 'MP4';
                final codec = stream['codec']?.toString().toLowerCase() ?? '';
                final isH264 = codec.contains('avc1') || format.contains('MP4');

                if (isH264 || stream['videoOnly'] == false) {
                  streams.add({
                    'quality': stream['quality'],
                    'url': stream['url'],
                    'mimeType': 'video/mp4',
                    'videoOnly': stream['videoOnly'] == true,
                    'codec': codec,
                  });
                }
              }
            }

            String audioUrl = '';
            if (audioStreams.isNotEmpty) {
              final bestAudio = audioStreams.reduce(
                (a, b) => (a['bitrate'] ?? 0) > (b['bitrate'] ?? 0) ? a : b,
              );
              audioUrl = bestAudio['url'] ?? '';
            }

            return Response.ok(
              jsonEncode({
                'success': true,
                'title': data['title'] ?? 'Video',
                'streams': streams,
                'audioUrl': audioUrl,
              }),
              headers: {'Content-Type': 'application/json'},
            );
          }
        }
      } catch (_) {}
    }

    // 2. Native YoutubeExplode Fallback
    final manifest = await _yt.videos.streamsClient.getManifest(cleanId);
    final videoTitle = (await _yt.videos.get(cleanId)).title;

    final List<Map<String, dynamic>> streams = [];
    for (final streamInfo in manifest.muxed) {
      streams.add({
        'quality': streamInfo.videoQuality.name,
        'url': streamInfo.url.toString(),
        'mimeType': 'video/mp4',
        'videoOnly': false,
      });
    }

    String audioUrl = '';
    if (manifest.audioOnly.isNotEmpty) {
      audioUrl = manifest.audioOnly.withHighestBitrate().url.toString();
    }

    return Response.ok(
      jsonEncode({
        'success': true,
        'title': videoTitle,
        'streams': streams,
        'audioUrl': audioUrl,
      }),
      headers: {'Content-Type': 'application/json'},
    );
  } catch (e) {
    print('Stream error: $e');
  }

  return Response.ok(
    jsonEncode({'success': true, 'streams': []}),
    headers: {'Content-Type': 'application/json'},
  );
}

String _decodeHtml(String text) {
  return text
      .replaceAll('&quot;', '"')
      .replaceAll('&#039;', "'")
      .replaceAll('&amp;', '&');
}

void main(List<String> args) async {
  final ip = InternetAddress.anyIPv4;
  final handler = Pipeline()
      .addMiddleware(logRequests())
      .addHandler(_router.call);
  final port = int.parse(Platform.environment['PORT'] ?? '8080');
  final server = await serve(handler, ip, port);
  print('Server listening on port ${server.port}');
}
