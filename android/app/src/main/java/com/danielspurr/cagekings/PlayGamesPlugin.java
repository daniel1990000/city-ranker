package com.danielspurr.cagekings;

import android.content.Intent;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.games.GamesClientStatusCodes;
import com.google.android.gms.games.PlayGames;
import com.google.android.gms.games.PlayGamesSdk;
import com.google.android.gms.games.SnapshotsClient;
import com.google.android.gms.games.snapshot.Snapshot;
import com.google.android.gms.games.snapshot.SnapshotMetadataChange;

import java.nio.charset.StandardCharsets;

/**
 * Google Play Games Services: sign-in, leaderboards, achievements and one cloud save slot.
 *
 * Does nothing at all until res/values/strings.xml has a real game_services_project_id (the numeric id from
 * Play Console > Play Games Services > Configuration). Until then isAvailable() is false and every call
 * rejects, so a build without a Play Games project behaves exactly like one without this plugin.
 */
@CapacitorPlugin(name = "PlayGames")
public class PlayGamesPlugin extends Plugin {
    private static final String TAG = "PlayGames";
    private static final int RC_UI = 9004;
    private boolean ready = false;

    @Override
    public void load() {
        String id = "";
        int res = getContext().getResources().getIdentifier("game_services_project_id", "string", getContext().getPackageName());
        if (res != 0) id = getContext().getString(res).trim();
        if (!id.matches("\\d{6,}")) return; // not configured: stay dormant
        try {
            PlayGamesSdk.initialize(getContext());
            ready = true;
        } catch (Exception e) {
            Log.w(TAG, "Play Games init failed", e);
        }
    }

    private boolean check(PluginCall call) {
        if (ready && getActivity() != null) return true;
        call.reject("Play Games is not configured");
        return false;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject r = new JSObject();
        r.put("available", ready);
        call.resolve(r);
    }

    @PluginMethod
    public void isAuthenticated(PluginCall call) {
        if (!check(call)) return;
        PlayGames.getGamesSignInClient(getActivity()).isAuthenticated().addOnCompleteListener(t -> {
            JSObject r = new JSObject();
            r.put("authenticated", t.isSuccessful() && t.getResult() != null && t.getResult().isAuthenticated());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        if (!check(call)) return;
        PlayGames.getGamesSignInClient(getActivity()).signIn().addOnCompleteListener(t -> {
            JSObject r = new JSObject();
            r.put("authenticated", t.isSuccessful() && t.getResult() != null && t.getResult().isAuthenticated());
            call.resolve(r);
        });
    }

    @PluginMethod
    public void submitScore(PluginCall call) {
        if (!check(call)) return;
        String board = call.getString("leaderboardId", "");
        // JS numbers arrive as Integer or Double, and getLong returns null for anything but a Long
        Double raw = call.getDouble("score");
        Long score = raw == null || raw.isNaN() ? null : Math.round(raw);
        if (board.isEmpty() || score == null) {
            call.reject("leaderboardId and score are required");
            return;
        }
        PlayGames.getLeaderboardsClient(getActivity()).submitScore(board, score);
        call.resolve();
    }

    @PluginMethod
    public void showLeaderboards(PluginCall call) {
        if (!check(call)) return;
        String board = call.getString("leaderboardId", "");
        (board.isEmpty()
            ? PlayGames.getLeaderboardsClient(getActivity()).getAllLeaderboardsIntent()
            : PlayGames.getLeaderboardsClient(getActivity()).getLeaderboardIntent(board)
        ).addOnSuccessListener(this::open).addOnCompleteListener(t -> {
            if (t.isSuccessful()) call.resolve();
            else call.reject("Leaderboards unavailable");
        });
    }

    @PluginMethod
    public void unlockAchievement(PluginCall call) {
        if (!check(call)) return;
        String id = call.getString("achievementId", "");
        if (id.isEmpty()) {
            call.reject("achievementId is required");
            return;
        }
        PlayGames.getAchievementsClient(getActivity()).unlock(id);
        call.resolve();
    }

    @PluginMethod
    public void showAchievements(PluginCall call) {
        if (!check(call)) return;
        PlayGames.getAchievementsClient(getActivity()).getAchievementsIntent().addOnSuccessListener(this::open).addOnCompleteListener(t -> {
            if (t.isSuccessful()) call.resolve();
            else call.reject("Achievements unavailable");
        });
    }

    /** Write the save (a text blob) to the single cloud slot; the most recently modified copy wins conflicts. */
    @PluginMethod
    public void saveGame(PluginCall call) {
        if (!check(call)) return;
        String name = call.getString("name", "cagekings");
        String data = call.getString("data", "");
        String description = call.getString("description", "Cage Kings progress");
        SnapshotsClient client = PlayGames.getSnapshotsClient(getActivity());
        client.open(name, true, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED).addOnCompleteListener(t -> {
            if (!t.isSuccessful() || t.getResult() == null || t.getResult().getData() == null) {
                call.reject("Cloud save unavailable");
                return;
            }
            Snapshot snap = t.getResult().getData();
            snap.getSnapshotContents().writeBytes(data.getBytes(StandardCharsets.UTF_8));
            SnapshotMetadataChange change = new SnapshotMetadataChange.Builder().setDescription(description).build();
            client.commitAndClose(snap, change).addOnCompleteListener(c -> {
                if (c.isSuccessful()) call.resolve();
                else call.reject("Cloud save failed");
            });
        });
    }

    /**
     * Read the cloud slot. Resolves { data: string | null, missing: boolean }: missing = true only when Play Games says
     * there is no save yet. Any other failure (network, sign-in, conflict) rejects, so the game never mistakes "could not
     * read" for "nothing there" and overwrites the player's cloud progress.
     */
    @PluginMethod
    public void loadGame(PluginCall call) {
        if (!check(call)) return;
        String name = call.getString("name", "cagekings");
        SnapshotsClient client = PlayGames.getSnapshotsClient(getActivity());
        client.open(name, false, SnapshotsClient.RESOLUTION_POLICY_MOST_RECENTLY_MODIFIED).addOnCompleteListener(t -> {
            JSObject r = new JSObject();
            if (!t.isSuccessful()) {
                Exception e = t.getException();
                if (e instanceof ApiException && ((ApiException) e).getStatusCode() == GamesClientStatusCodes.SNAPSHOT_NOT_FOUND) {
                    r.put("data", null);
                    r.put("missing", true);
                    call.resolve(r);
                } else {
                    call.reject("Cloud load failed");
                }
                return;
            }
            if (t.getResult() == null || t.getResult().getData() == null) {
                call.reject("Cloud load conflict");
                return;
            }
            Snapshot snap = t.getResult().getData();
            try {
                byte[] bytes = snap.getSnapshotContents().readFully();
                r.put("data", bytes == null || bytes.length == 0 ? null : new String(bytes, StandardCharsets.UTF_8));
                r.put("missing", bytes == null || bytes.length == 0);
            } catch (Exception e) {
                client.discardAndClose(snap);
                call.reject("Cloud load failed");
                return;
            }
            client.discardAndClose(snap);
            call.resolve(r);
        });
    }

    private void open(Intent intent) {
        try {
            getActivity().startActivityForResult(intent, RC_UI);
        } catch (Exception e) {
            Log.w(TAG, "Could not open Play Games UI", e);
        }
    }
}
