const BACKEND_URL = "http://127.0.0.1:8080"; // Change this to your live Render/Railway URL

// Return the direct search API endpoint
function getSearchUrl(query) {
    return BACKEND_URL + "/api/v1/search?query=" + encodeURIComponent(query);
}

// Return the direct stream API endpoint
function getStreamUrl(id) {
    return BACKEND_URL + "/api/v1/video/stream?id=" + encodeURIComponent("search:" + id);
}

// (Optional) Return a direct home feed endpoint if your backend supports it
function getHomeFeedUrl() {
    return BACKEND_URL + "/api/v1/home";
}
