package com.danielspurr.cagekings;

import android.content.Context;
import android.content.SharedPreferences;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;
import android.view.WindowManager;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Small native helpers the game needs:
 * - keepAwake: the screen stays on only while a run is in progress (menus let the phone sleep);
 * - audio focus: the game asks for audio focus and tells the web layer when another app (a call, a music app)
 *   takes it, so game music pauses or ducks instead of playing over it;
 * - renderer crash count: MainActivity records WebView renderer crashes so the game can report them.
 */
@CapacitorPlugin(name = "GameSystem")
public class GameSystemPlugin extends Plugin {

    static final String PREFS = "cagekings.system";
    private AudioManager audio;
    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        String state;
        if (change == AudioManager.AUDIOFOCUS_GAIN) state = "gain";
        else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT_CAN_DUCK) state = "duck";
        else if (change == AudioManager.AUDIOFOCUS_LOSS_TRANSIENT) state = "pause";
        else state = "loss";
        JSObject r = new JSObject();
        r.put("state", state);
        notifyListeners("audioFocus", r);
    };

    @PluginMethod
    public void keepAwake(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("on", false));
        getActivity().runOnUiThread(() -> {
            if (on) getActivity().getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            else getActivity().getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
            call.resolve();
        });
    }

    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        if (audio == null) audio = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest == null) {
                AudioAttributes attrs = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_GAME).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN).setAudioAttributes(attrs).setOnAudioFocusChangeListener(focusListener).build();
            }
            result = audio.requestAudioFocus(focusRequest);
        } else {
            result = audio.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        JSObject r = new JSObject();
        r.put("granted", result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        call.resolve(r);
    }

    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        if (audio != null) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && focusRequest != null) audio.abandonAudioFocusRequest(focusRequest);
            else audio.abandonAudioFocus(focusListener);
        }
        call.resolve();
    }

    /** How many times the WebView renderer crashed since the last call (and resets the count). */
    @PluginMethod
    public void takeRendererCrashes(PluginCall call) {
        SharedPreferences p = getContext().getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int n = p.getInt("rendererGone", 0);
        p.edit().putInt("rendererGone", 0).apply();
        JSObject r = new JSObject();
        r.put("count", n);
        call.resolve(r);
    }
}
