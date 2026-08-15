const BACKEND_URL = "https://it-feels-backend.cleverfox687.workers.dev"; // Live Cloudflare Worker URL

// Return the direct search API endpoint
function getSearchUrl(query) {
    return BACKEND_URL + "/api/v1/search?query=" + encodeURIComponent(query);
}

function getSearchPlaylistsUrl(query) {
    return BACKEND_URL + "/api/v1/search/playlists?query=" + encodeURIComponent(query);
}

function getSearchPodcastsUrl(query) {
    return BACKEND_URL + "/api/v1/search/podcasts?query=" + encodeURIComponent(query);
}

// Return the direct stream API endpoint
function getStreamUrl(id, query) {
    if (query) {
        return BACKEND_URL + "/api/v1/video/stream?id=" + encodeURIComponent(id) + "&query=" + encodeURIComponent(query);
    }
    return BACKEND_URL + "/api/v1/video/stream?id=" + encodeURIComponent("search:" + id);
}

// (Optional) Return a direct home feed endpoint if your backend supports it
function getHomeFeedUrl() {
    return BACKEND_URL + "/api/v1/home";
}
