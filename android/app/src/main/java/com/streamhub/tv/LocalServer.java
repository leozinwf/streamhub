package com.streamhub.tv;

import android.content.res.AssetManager;
import android.util.Log;

import org.json.JSONObject;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileNotFoundException;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import fi.iki.elonen.NanoHTTPD;
import okhttp3.HttpUrl;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.ResponseBody;
import okio.BufferedSource;

/**
 * Servidor local do StreamHub no Fire TV: entrega o front-end (assets/web) e
 * implementa as mesmas rotas /api do servidor Node (api/*.ts), já que no
 * Android não existe Node. Escuta só em 127.0.0.1.
 */
public class LocalServer extends NanoHTTPD {
    static final String HOST = "127.0.0.1";
    static final int PORT = 51730;
    private static final String TAG = "StreamHub";

    private static final String BROWSER_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
    private static final String STREAM_USER_AGENT =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140 Safari/537.36 StreamHub/1.0";
    private static final long MAX_PLAYLIST_BYTES = 15L * 1024 * 1024;
    private static final long MAX_MANIFEST_BYTES = 5L * 1024 * 1024;

    private static final Pattern URI_ATTRIBUTE = Pattern.compile("URI=\"([^\"]+)\"", Pattern.CASE_INSENSITIVE);
    private static final Pattern MANIFEST_URL = Pattern.compile("\\.m3u8(?:$|\\?)", Pattern.CASE_INSENSITIVE);
    private static final Pattern SEGMENT_URL = Pattern.compile("\\.(?:ts|m2ts|m4s|mp4|m4v|aac|mp3|vtt|webm|mkv)(?:$|\\?)", Pattern.CASE_INSENSITIVE);

    private final AssetManager assets;
    private final OkHttpClient client;
    private final OkHttpClient slowClient;

    LocalServer(AssetManager assets) {
        super(HOST, PORT);
        this.assets = assets;
        this.client = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .followRedirects(true)
                .followSslRedirects(true)
                .retryOnConnectionFailure(true)
                .build();
        this.slowClient = client.newBuilder().readTimeout(60, TimeUnit.SECONDS).build();
    }

    @Override
    public Response serve(IHTTPSession session) {
        String uri = session.getUri();
        try {
            if (uri.startsWith("/api/")) {
                if (Method.OPTIONS.equals(session.getMethod())) return cors(newFixedLengthResponse(status(204), MIME_PLAINTEXT, ""));
                switch (uri) {
                    case "/api/health": return json(200, "{\"success\":true,\"service\":\"streamhub-tv\"}");
                    case "/api/stream": return handleStream(session);
                    case "/api/playlist": return handlePlaylist(session);
                    case "/api/xtream": return handleXtream(session);
                    case "/api/export": return handleExport(session);
                    default: return json(404, "{\"error\":\"Rota da API não encontrada.\"}");
                }
            }
            return serveAsset(uri);
        } catch (Exception error) {
            Log.e(TAG, "Falha em " + uri, error);
            return cors(text(500, "Erro interno do StreamHub."));
        }
    }

    // ---------------------------------------------------------------- arquivos do front-end

    private Response serveAsset(String uri) throws IOException {
        String path = uri.replaceAll("^/+", "");
        if (path.isEmpty() || path.contains("..")) path = "index.html";
        InputStream stream;
        try {
            stream = assets.open("web/" + path);
        } catch (FileNotFoundException missing) {
            // Rotas do app (SPA) caem no index.html.
            path = "index.html";
            stream = assets.open("web/index.html");
        }
        byte[] data = readAll(stream, Long.MAX_VALUE);
        Response response = newFixedLengthResponse(Response.Status.OK, mimeFor(path), new ByteArrayInputStream(data), data.length);
        response.addHeader("Cache-Control", path.equals("index.html") || path.equals("sw.js") ? "no-cache" : "max-age=3600");
        return response;
    }

    private static String mimeFor(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html; charset=utf-8";
        if (lower.endsWith(".js") || lower.endsWith(".mjs")) return "text/javascript; charset=utf-8";
        if (lower.endsWith(".css")) return "text/css; charset=utf-8";
        if (lower.endsWith(".json") || lower.endsWith(".webmanifest")) return "application/json; charset=utf-8";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".ico")) return "image/x-icon";
        if (lower.endsWith(".woff2")) return "font/woff2";
        if (lower.endsWith(".woff")) return "font/woff";
        return "application/octet-stream";
    }

    // ---------------------------------------------------------------- /api/stream (api/stream.ts)

    private Response handleStream(IHTTPSession session) throws IOException {
        if (!Method.GET.equals(session.getMethod()) && !Method.HEAD.equals(session.getMethod())) return text(405, "Method Not Allowed");
        String targetValue = param(session, "url");
        HttpUrl target = publicHttpUrl(targetValue);
        if (target == null) return cors(text(400, "URL inválida ou destino não permitido."));

        Request.Builder request = new Request.Builder().url(target)
                .header("Accept", "application/vnd.apple.mpegurl, application/x-mpegURL, video/mp2t, */*")
                .header("User-Agent", STREAM_USER_AGENT)
                .header("Accept-Encoding", "identity")
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Referer", origin(target) + "/")
                .header("Origin", origin(target));
        String range = session.getHeaders().get("range");
        if (range != null && !range.isEmpty()) request.header("Range", range);

        okhttp3.Response upstream;
        try {
            upstream = client.newCall(request.build()).execute();
        } catch (IOException error) {
            boolean timeout = error instanceof java.net.SocketTimeoutException || error instanceof java.io.InterruptedIOException;
            return cors(text(502, timeout ? "Tempo limite ao acessar o stream." : "Não foi possível acessar o stream de origem."));
        }

        ResponseBody body = upstream.body();
        if (!upstream.isSuccessful() || body == null) {
            int code = upstream.code();
            upstream.close();
            return cors(text(code >= 400 ? code : 502, "Servidor de origem respondeu HTTP " + code + "."));
        }

        HttpUrl finalUrl = upstream.request().url();
        String contentType = header(upstream, "content-type");
        String contentLength = header(upstream, "content-length");
        String contentDisposition = header(upstream, "content-disposition");
        String targetPath = target.encodedPath() + (target.encodedQuery() != null ? "?" + target.encodedQuery() : "");
        String finalPath = finalUrl.encodedPath() + (finalUrl.encodedQuery() != null ? "?" + finalUrl.encodedQuery() : "");
        boolean looksLikeManifestUrl = MANIFEST_URL.matcher(targetPath).find() || MANIFEST_URL.matcher(finalPath).find();
        boolean looksLikeText = contentType.toLowerCase(Locale.ROOT).contains("text/") || contentType.toLowerCase(Locale.ROOT).contains("mpegurl");
        // Segmentos de vídeo nunca são manifesto, mesmo que o servidor mande um content-type errado.
        boolean looksLikeSegment = SEGMENT_URL.matcher(finalUrl.encodedPath()).find();
        boolean isManifest = looksLikeManifestUrl || (!looksLikeSegment && (looksLikeText || contentDisposition.toLowerCase(Locale.ROOT).contains(".m3u8")));

        if (isManifest) {
            try {
                if (parseLong(contentLength) > MAX_MANIFEST_BYTES) return cors(text(413, "Manifesto HLS excede o limite permitido."));
                byte[] bytes = readAll(body.byteStream(), MAX_MANIFEST_BYTES);
                if (bytes == null) return cors(text(413, "Manifesto HLS excede o limite permitido."));
                String content = new String(bytes, StandardCharsets.UTF_8);
                boolean manifestLike = content.replaceFirst("^\\s+", "").regionMatches(true, 0, "#EXTM3U", 0, 7);
                if (!manifestLike && looksLikeManifestUrl) return cors(text(502, "A origem respondeu algo que não é um manifesto HLS válido."));
                String rewritten = manifestLike ? rewriteManifest(content, finalUrl) : content;
                Response response = newFixedLengthResponse(Response.Status.OK, "application/vnd.apple.mpegurl; charset=utf-8", rewritten);
                noStore(response);
                return cors(response);
            } finally {
                upstream.close();
            }
        }

        String type = contentType.isEmpty()
                ? (finalPath.toLowerCase(Locale.ROOT).matches(".*\\.ts(\\?.*)?$") ? "video/mp2t" : "application/octet-stream")
                : contentType;
        InputStream stream = new UpstreamStream(upstream);
        long length = parseLong(contentLength);
        Response response = length >= 0
                ? newFixedLengthResponse(status(upstream.code()), type, stream, length)
                : newChunkedResponse(status(upstream.code()), type, stream);
        for (String key : new String[]{"content-range", "accept-ranges", "etag", "last-modified"}) {
            String value = upstream.header(key);
            if (value != null) response.addHeader(key, value);
        }
        noStore(response);
        response.addHeader("Access-Control-Expose-Headers", "Content-Length, Content-Range, Accept-Ranges, ETag, Last-Modified");
        response.setGzipEncoding(false);
        return cors(response);
    }

    private static String proxied(HttpUrl target) {
        return "http://" + HOST + ":" + PORT + "/api/stream?url=" + encodeURIComponent(target.toString());
    }

    private static String rewriteManifest(String content, HttpUrl base) {
        String[] lines = content.split("\\r?\\n", -1);
        StringBuilder out = new StringBuilder(content.length() + 1024);
        for (int i = 0; i < lines.length; i++) {
            String line = lines[i];
            String trimmed = line.trim();
            if (!trimmed.isEmpty()) {
                if (trimmed.startsWith("#")) {
                    Matcher matcher = URI_ATTRIBUTE.matcher(line);
                    StringBuffer buffer = new StringBuffer();
                    while (matcher.find()) {
                        HttpUrl resolved = base.resolve(matcher.group(1));
                        String replacement = resolved != null ? "URI=\"" + proxied(resolved) + "\"" : matcher.group(0);
                        matcher.appendReplacement(buffer, Matcher.quoteReplacement(replacement));
                    }
                    matcher.appendTail(buffer);
                    line = buffer.toString();
                } else {
                    HttpUrl resolved = base.resolve(trimmed);
                    if (resolved != null) line = proxied(resolved);
                }
            }
            out.append(line);
            if (i < lines.length - 1) out.append('\n');
        }
        return out.toString();
    }

    // ---------------------------------------------------------------- /api/playlist (api/playlist.ts)

    private Response handlePlaylist(IHTTPSession session) {
        if (!Method.GET.equals(session.getMethod())) return text(405, "Method Not Allowed");
        HttpUrl target = publicHttpUrl(param(session, "url"));
        if (target == null) return cors(text(400, "URL inválida ou destino não permitido."));
        Request request = new Request.Builder().url(target)
                .header("Accept", "application/vnd.apple.mpegurl, application/x-mpegurl, text/plain, */*")
                .header("User-Agent", BROWSER_USER_AGENT)
                .build();
        try (okhttp3.Response upstream = slowClient.newCall(request).execute()) {
            ResponseBody body = upstream.body();
            if (!upstream.isSuccessful() || body == null) return cors(text(502, "Servidor de origem respondeu HTTP " + upstream.code() + "."));
            if (parseLong(header(upstream, "content-length")) > MAX_PLAYLIST_BYTES) return cors(text(413, "A playlist excede o limite de 15 MB."));
            byte[] bytes = readAll(body.byteStream(), MAX_PLAYLIST_BYTES);
            if (bytes == null) return cors(text(413, "A playlist excede o limite de 15 MB."));
            Response response = newFixedLengthResponse(Response.Status.OK, "text/plain; charset=utf-8", new ByteArrayInputStream(bytes), bytes.length);
            response.addHeader("Cache-Control", "no-store");
            return cors(response);
        } catch (IOException error) {
            boolean timeout = error instanceof java.io.InterruptedIOException;
            return cors(text(502, timeout ? "Tempo limite ao acessar a playlist." : "Não foi possível acessar a playlist de origem."));
        }
    }

    // ---------------------------------------------------------------- /api/xtream (api/xtream.ts)

    private Response handleXtream(IHTTPSession session) throws IOException {
        Method method = session.getMethod();
        if (!Method.GET.equals(method) && !Method.POST.equals(method)) return cors(text(405, "Method Not Allowed"));

        JSONObject body = new JSONObject();
        if (Method.POST.equals(method)) {
            byte[] raw = readRequestBody(session);
            try { body = new JSONObject(new String(raw, StandardCharsets.UTF_8)); } catch (Exception ignored) { /* corpo vazio ou inválido */ }
        }

        String serverValue = value(body, session, "server");
        String username = value(body, session, "username");
        String password = value(body, session, "password");
        String action = value(body, session, "action");
        HttpUrl server = normalizeServer(serverValue);
        if (server == null || username.isEmpty() || password.isEmpty()) {
            return json(400, "{\"error\":\"Servidor, usuário e senha são obrigatórios.\"}");
        }

        HttpUrl.Builder target = server.resolve("/player_api.php").newBuilder()
                .addQueryParameter("username", username)
                .addQueryParameter("password", password);
        if (!action.isEmpty()) target.addQueryParameter("action", action);
        for (String key : new String[]{"category_id", "series_id", "vod_id", "stream_id", "limit"}) {
            String parameter = value(body, session, key);
            if (!parameter.isEmpty()) target.addQueryParameter(key, parameter);
        }
        HttpUrl url = target.build();
        String language = session.getHeaders().get("accept-language");

        Request request = new Request.Builder().url(url)
                .header("Accept", "application/json, text/plain, */*")
                .header("Accept-Language", language != null && !language.isEmpty() ? language : "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7")
                .header("Cache-Control", "no-cache")
                .header("Pragma", "no-cache")
                .header("Referer", origin(url) + "/")
                .header("User-Agent", BROWSER_USER_AGENT)
                .build();

        okhttp3.Response upstream;
        try {
            upstream = slowClient.newCall(request).execute();
        } catch (IOException error) {
            boolean timeout = error instanceof java.io.InterruptedIOException;
            return json(502, "{\"error\":\"" + (timeout ? "Tempo limite ao conectar ao servidor IPTV." : "Não foi possível conectar ao servidor IPTV.") + "\"}");
        }
        ResponseBody responseBody = upstream.body();
        if (!upstream.isSuccessful() || responseBody == null) {
            int code = upstream.code();
            upstream.close();
            Log.w(TAG, "Xtream respondeu HTTP " + code);
            return json(502, "{\"error\":\"Servidor de origem respondeu HTTP " + code + ".\",\"upstreamStatus\":" + code + "}");
        }

        // Confere se parece JSON sem carregar listas enormes na memória: repassa o corpo direto.
        BufferedSource source = responseBody.source();
        BufferedSource peek = source.peek();
        int first = -1;
        try {
            while (peek.request(1)) {
                int b = peek.readByte() & 0xff;
                if (b == 0xEF || b == 0xBB || b == 0xBF || Character.isWhitespace(b)) continue;
                first = b;
                break;
            }
        } catch (IOException ignored) { /* corpo vazio */ }
        if (first != '{' && first != '[' && first != '"' && first != 'n' && first != 't' && first != 'f' && first != '-' && !(first >= '0' && first <= '9')) {
            upstream.close();
            return json(502, "{\"error\":\"O servidor IPTV retornou uma resposta que não é um JSON válido.\"}");
        }
        Response response = newChunkedResponse(Response.Status.OK, "application/json; charset=utf-8", new UpstreamStream(upstream));
        response.addHeader("Cache-Control", "no-store");
        return cors(response);
    }

    // ---------------------------------------------------------------- /api/export (api/export.ts)

    private Response handleExport(IHTTPSession session) {
        if (!Method.GET.equals(session.getMethod())) return text(405, "Method Not Allowed");
        HttpUrl server = normalizeServer(param(session, "server"));
        String username = param(session, "username").trim();
        String password = param(session, "password").trim();
        if (server == null || username.isEmpty() || password.isEmpty()) return text(400, "Dados IPTV inválidos.");
        HttpUrl url = server.resolve("/get.php").newBuilder()
                .addQueryParameter("username", username)
                .addQueryParameter("password", password)
                .addQueryParameter("type", "m3u_plus")
                .addQueryParameter("output", "ts")
                .build();
        try {
            okhttp3.Response upstream = slowClient.newCall(new Request.Builder().url(url).header("User-Agent", BROWSER_USER_AGENT).build()).execute();
            if (!upstream.isSuccessful() || upstream.body() == null) {
                int code = upstream.code();
                upstream.close();
                return text(502, "O IPTV respondeu HTTP " + code + ".");
            }
            Response response = newChunkedResponse(Response.Status.OK, "audio/x-mpegurl; charset=utf-8", new UpstreamStream(upstream));
            response.addHeader("Content-Disposition", "attachment; filename=\"streamhub-completo.m3u\"");
            response.addHeader("Cache-Control", "no-store");
            return response;
        } catch (IOException error) {
            return text(502, "Não foi possível exportar a lista completa.");
        }
    }

    // ---------------------------------------------------------------- utilidades

    /** Fecha a conexão com o IPTV quando o player para de ler (troca de canal), liberando a vaga. */
    private static final class UpstreamStream extends FilterInputStream {
        private final okhttp3.Response response;
        UpstreamStream(okhttp3.Response response) {
            super(response.body().byteStream());
            this.response = response;
        }
        @Override public void close() {
            try { response.close(); } catch (Exception ignored) { /* já fechado */ }
        }
    }

    private static boolean isPrivateHost(String host) {
        host = host.toLowerCase(Locale.ROOT);
        if (host.equals("localhost") || host.equals("::1") || host.equals("[::1]") || host.endsWith(".local")) return true;
        return host.matches("^127\\..*") || host.matches("^10\\..*") || host.matches("^192\\.168\\..*")
                || host.matches("^172\\.(1[6-9]|2\\d|3[0-1])\\..*");
    }

    private static HttpUrl publicHttpUrl(String value) {
        if (value == null) return null;
        HttpUrl url = HttpUrl.parse(value.trim());
        if (url == null || isPrivateHost(url.host())) return null;
        return url;
    }

    private static HttpUrl normalizeServer(String value) {
        String raw = value == null ? "" : value.trim().replaceAll("/+$", "");
        if (!raw.matches("(?i)^https?://.*")) return null;
        return publicHttpUrl(raw);
    }

    private static String origin(HttpUrl url) {
        boolean defaultPort = url.port() == HttpUrl.defaultPort(url.scheme());
        return url.scheme() + "://" + (url.host().contains(":") ? "[" + url.host() + "]" : url.host()) + (defaultPort ? "" : ":" + url.port());
    }

    private static String param(IHTTPSession session, String key) {
        List<String> values = session.getParameters().get(key);
        return values == null || values.isEmpty() || values.get(0) == null ? "" : values.get(0);
    }

    private static String value(JSONObject body, IHTTPSession session, String key) {
        Object fromBody = body.opt(key);
        if (fromBody instanceof String) return ((String) fromBody).trim();
        return param(session, key).trim();
    }

    private static byte[] readRequestBody(IHTTPSession session) throws IOException {
        long length = parseLong(session.getHeaders().get("content-length"));
        if (length <= 0) return new byte[0];
        if (length > 1024 * 1024) throw new IOException("Corpo da requisição grande demais");
        byte[] buffer = new byte[(int) length];
        InputStream input = session.getInputStream();
        int offset = 0;
        while (offset < length) {
            int read = input.read(buffer, offset, (int) length - offset);
            if (read < 0) break;
            offset += read;
        }
        return buffer;
    }

    /** Lê tudo; devolve null se passar de {@code limit} bytes. */
    private static byte[] readAll(InputStream input, long limit) throws IOException {
        try (InputStream in = input) {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buffer = new byte[16 * 1024];
            long total = 0;
            int read;
            while ((read = in.read(buffer)) != -1) {
                total += read;
                if (total > limit) return null;
                out.write(buffer, 0, read);
            }
            return out.toByteArray();
        }
    }

    private static long parseLong(String value) {
        if (value == null || value.isEmpty()) return -1;
        try { return Long.parseLong(value.trim()); } catch (NumberFormatException e) { return -1; }
    }

    private static String header(okhttp3.Response response, String name) {
        String value = response.header(name);
        return value == null ? "" : value;
    }

    private static String encodeURIComponent(String value) {
        try {
            return URLEncoder.encode(value, "UTF-8")
                    .replace("+", "%20").replace("%21", "!").replace("%27", "'")
                    .replace("%28", "(").replace("%29", ")").replace("%7E", "~");
        } catch (Exception e) {
            return value;
        }
    }

    private static void noStore(Response response) {
        response.addHeader("Cache-Control", "no-store, no-cache, must-revalidate");
        response.addHeader("Pragma", "no-cache");
    }

    private static Response cors(Response response) {
        response.addHeader("Access-Control-Allow-Origin", "*");
        response.addHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        response.addHeader("Access-Control-Allow-Headers", "Content-Type, Range");
        return response;
    }

    private static Response text(int code, String message) {
        return newFixedLengthResponse(status(code), "text/plain; charset=utf-8", message);
    }

    private static Response json(int code, String body) {
        Response response = newFixedLengthResponse(status(code), "application/json; charset=utf-8", body);
        response.addHeader("Cache-Control", "no-store");
        return cors(response);
    }

    private static Response.IStatus status(int code) {
        for (Response.Status known : Response.Status.values()) {
            if (known.getRequestStatus() == code) return known;
        }
        return new Response.IStatus() {
            @Override public String getDescription() { return code + " Status"; }
            @Override public int getRequestStatus() { return code; }
        };
    }
}
