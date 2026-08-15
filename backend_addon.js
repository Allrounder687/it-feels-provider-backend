const BACKEND_URL = "http://127.0.0.1:8080"; // Change this to your live Render/Railway URL

function searchPlugin(query) {
    var response = sendMessage("fetch", JSON.stringify({ 
        url: BACKEND_URL + "/api/v1/search?query=" + encodeURIComponent(query) 
    }));
    if (!response) return JSON.stringify([]);
    var data = JSON.parse(response);
    if (!data.success || !data.results) return JSON.stringify([]);
    var mappedResults = [];
    for (var i = 0; i < data.results.length; i++) {
        var item = data.results[i];
        mappedResults.push({ id: item.id, title: item.title, artist: item.artist, albumArt: item.coverArt });
    }
    return JSON.stringify(mappedResults);
}

function getStreamPlugin(id) {
    var response = sendMessage("fetch", JSON.stringify({ 
        url: BACKEND_URL + "/api/v1/video/stream?id=" + encodeURIComponent("search:" + id) 
    }));
    if (!response) return null;
    var data = JSON.parse(response);
    if (data.success && data.audioUrl) return data.audioUrl;
    return null;
}
