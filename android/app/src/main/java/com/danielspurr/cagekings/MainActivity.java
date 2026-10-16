package com.danielspurr.cagekings;

import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(PlayGamesPlugin.class); // local plugin: dormant until a Play Games project id is set
        registerPlugin(GameSystemPlugin.class);
        super.onCreate(savedInstanceState);
        // The screen is kept awake only during runs (GameSystem.keepAwake); edge-to-edge drawing, the web layer
        // respects the safe areas.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams lp = getWindow().getAttributes();
            lp.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(lp);
        }
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        hideSystemBars();
        // Under memory pressure Android can kill the WebView's renderer process (a 3D page is a likely target on
        // cheap phones). Unhandled, that crashes the whole app; instead count it and restart the activity, which
        // reloads the game with the save intact.
        if (getBridge() != null) {
            getBridge().addWebViewListener(new WebViewListener() {
                @Override
                public boolean onRenderProcessGone(WebView webView, RenderProcessGoneDetail detail) {
                    Log.w("Cage Kings", "WebView renderer gone (crashed: " + (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && detail.didCrash()) + ")");
                    SharedPreferences p = getSharedPreferences(GameSystemPlugin.PREFS, Context.MODE_PRIVATE);
                    long now = System.currentTimeMillis();
                    // a renderer that dies again within a minute would restart forever: close instead (the save is
                    // safe, and the player can reopen the game)
                    boolean again = now - p.getLong("rendererGoneAt", 0) < 60_000;
                    p.edit().putInt("rendererGone", p.getInt("rendererGone", 0) + 1).putLong("rendererGoneAt", now).apply();
                    ViewGroup parent = (ViewGroup) webView.getParent();
                    if (parent != null) parent.removeView(webView);
                    webView.destroy();
                    if (again) finish();
                    else recreate();
                    return true;
                }
            });
        }
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) hideSystemBars();
    }

    private void hideSystemBars() {
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }
}
