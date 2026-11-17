package com.streamhub.tv;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.os.SystemClock;
import android.util.Log;
import android.view.KeyEvent;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;

import java.io.IOException;

public class MainActivity extends Activity {
    private static final String TAG = "StreamHub";
    private static final String APP_URL = "http://" + LocalServer.HOST + ":" + LocalServer.PORT + "/";
    private static LocalServer server;

    private FrameLayout root;
    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private long lastBackPress;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        startServer();

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.rgb(8, 10, 15));
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(8, 10, 15));
        root.addView(webView, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        hideSystemUi();

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        settings.setUseWideViewPort(true);
        settings.setLoadWithOverviewMode(true);
        settings.setSupportZoom(false);
        settings.setTextZoom(100);
        // O front-end liga o modo TV (navegação pelo controle) quando vê esta marca.
        settings.setUserAgentString(settings.getUserAgentString() + " StreamHubTV/" + BuildConfigHolder.versionName(this));

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Só o app abre aqui dentro; links externos são ignorados (não há navegador na TV).
                return !request.getUrl().toString().startsWith(APP_URL);
            }

            @SuppressWarnings("deprecation")
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return !url.startsWith(APP_URL);
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden(); return; }
                customView = view;
                customViewCallback = callback;
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                webView.setVisibility(View.GONE);
                hideSystemUi();
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                root.removeView(customView);
                customView = null;
                webView.setVisibility(View.VISIBLE);
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
                customViewCallback = null;
                webView.requestFocus();
                hideSystemUi();
            }

            @Override
            public Bitmap getDefaultVideoPoster() {
                // Sem o ícone cinza de "play" do Android antes do vídeo começar.
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimetype, contentLength) ->
                Toast.makeText(this, "Exportar a lista não está disponível na TV.", Toast.LENGTH_LONG).show());

        if (savedInstanceState != null) webView.restoreState(savedInstanceState);
        else webView.loadUrl(APP_URL);
        webView.requestFocus();
    }

    private void startServer() {
        if (server != null && server.isAlive()) return;
        try {
            server = new LocalServer(getAssets());
            server.start(5000, true);
        } catch (IOException error) {
            Log.e(TAG, "Não foi possível iniciar o servidor local", error);
            Toast.makeText(this, "Não foi possível iniciar o StreamHub: " + error.getMessage(), Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public boolean dispatchKeyEvent(KeyEvent event) {
        int code = event.getKeyCode();
        if (event.getAction() == KeyEvent.ACTION_DOWN) {
            String media = null;
            if (code == KeyEvent.KEYCODE_MEDIA_PLAY_PAUSE || code == KeyEvent.KEYCODE_MEDIA_PLAY || code == KeyEvent.KEYCODE_MEDIA_PAUSE) media = "playpause";
            else if (code == KeyEvent.KEYCODE_MEDIA_REWIND) media = "rewind";
            else if (code == KeyEvent.KEYCODE_MEDIA_FAST_FORWARD) media = "forward";
            else if (code == KeyEvent.KEYCODE_MENU) media = "menu";
            if (media != null) {
                webView.evaluateJavascript("window.__streamhubMedia && window.__streamhubMedia('" + media + "')", null);
                return true;
            }
        }
        if (code == KeyEvent.KEYCODE_BACK) {
            if (event.getAction() == KeyEvent.ACTION_UP) handleBack();
            return true;
        }
        return super.dispatchKeyEvent(event);
    }

    private void handleBack() {
        if (customView != null) {
            webView.evaluateJavascript("document.fullscreenElement && document.exitFullscreen()", null);
            WebChromeClient.CustomViewCallback callback = customViewCallback;
            if (callback != null) callback.onCustomViewHidden();
            return;
        }
        webView.evaluateJavascript("window.__streamhubBack ? window.__streamhubBack() : false", result -> {
            if ("true".equals(result)) return;
            long now = SystemClock.elapsedRealtime();
            if (now - lastBackPress < 2000) {
                finish();
            } else {
                lastBackPress = now;
                Toast.makeText(this, "Aperte voltar de novo para sair", Toast.LENGTH_SHORT).show();
            }
        });
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemUi();
    }

    @SuppressWarnings("deprecation")
    private void hideSystemUi() {
        getWindow().getDecorView().setSystemUiVisibility(
                View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                        | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onPause() {
        super.onPause();
        // Sair do app (botão Home) para o vídeo e libera a conexão com o IPTV.
        webView.evaluateJavascript("document.querySelectorAll('video').forEach(function(v){try{v.pause()}catch(e){}})", null);
        webView.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        hideSystemUi();
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.stopLoading();
            webView.destroy();
        }
        super.onDestroy();
    }

    /** versionName sem depender do BuildConfig (desligado por padrão no AGP 8). */
    static final class BuildConfigHolder {
        static String versionName(Activity activity) {
            try {
                return activity.getPackageManager().getPackageInfo(activity.getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "0";
            }
        }
    }
}
