package dev.infinet.survey;

import android.Manifest;
import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.LocationManager;
import android.net.ConnectivityManager;
import android.net.NetworkCapabilities;
import android.net.Uri;
import android.net.wifi.ScanResult;
import android.net.wifi.WifiManager;
import android.net.wifi.rtt.RangingRequest;
import android.net.wifi.rtt.RangingResult;
import android.net.wifi.rtt.RangingResultCallback;
import android.net.wifi.rtt.WifiRttManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.provider.MediaStore;
import android.telephony.CellIdentityLte;
import android.telephony.CellIdentityNr;
import android.telephony.CellInfo;
import android.telephony.CellInfoGsm;
import android.telephony.CellInfoLte;
import android.telephony.CellInfoNr;
import android.telephony.CellInfoWcdma;
import android.telephony.CellSignalStrength;
import android.telephony.CellSignalStrengthLte;
import android.telephony.CellSignalStrengthNr;
import android.telephony.SignalStrength;
import android.telephony.TelephonyManager;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;

/**
 * Infinet Survey. Listens to the Wi-Fi and cellular networks around the phone and records them at the spots the
 * surveyor taps on a floor plan, for the venue replica in the simulation.
 *
 * Privacy (same rule as the booth scanner, Security spec §6): real network names and addresses are used only to
 * draw the live list on this screen. What is saved uses salted HMAC ids (the salt is the "team code", so both
 * phones produce the same ids); a name is kept only for networks the team marks as the venue's own, and for our
 * Infinet-Demo- hotspots. The app never joins, probes or sends anything to a network (except the optional
 * latency check, which uses whatever internet connection the phone already has).
 */
public class MainActivity extends Activity {
  private static final int REQ_PERMS = 1, REQ_FILE = 2;
  private static final String DEMO_PREFIX = "Infinet-Demo-";
  private static final long SCAN_EVERY_MS = 2500;

  private WebView web;
  private WifiManager wifi;
  private TelephonyManager tel;
  private WifiRttManager rtt;
  private SharedPreferences prefs;
  private final Handler main = new Handler(Looper.getMainLooper());
  private ValueCallback<Uri[]> fileCb;
  private boolean scanning = false;
  private int startOk = 0, startRefused = 0;
  private List<ScanResult> latest = new ArrayList<>();
  private final Set<String> allow = new HashSet<>();
  private byte[] salt;

  @Override
  protected void onCreate(Bundle b) {
    super.onCreate(b);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    wifi = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
    tel = (TelephonyManager) getSystemService(Context.TELEPHONY_SERVICE);
    if (getPackageManager().hasSystemFeature(PackageManager.FEATURE_WIFI_RTT)) rtt = (WifiRttManager) getSystemService(Context.WIFI_RTT_RANGING_SERVICE);
    prefs = getSharedPreferences("survey", MODE_PRIVATE);
    String code = prefs.getString("teamCode", null);
    if (code == null) {
      byte[] r = new byte[4];
      new SecureRandom().nextBytes(r);
      code = String.format("%02x%02x-%02x%02x", r[0], r[1], r[2], r[3]);
      prefs.edit().putString("teamCode", code).apply();
    }
    setSalt(code);
    try {
      JSONArray a = new JSONArray(prefs.getString("allow", "[]"));
      for (int i = 0; i < a.length(); i++) allow.add(a.getString(i));
    } catch (Exception ignored) { }

    WebView.setWebContentsDebuggingEnabled(true); // lets the laptop inspect the page over USB (adb) while testing
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    web.setWebViewClient(new WebViewClient());
    web.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onConsoleMessage(android.webkit.ConsoleMessage m) {
        android.util.Log.i("InfinetSurvey", m.messageLevel() + " " + m.message() + " @" + m.lineNumber());
        return true;
      }

      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
        if (fileCb != null) fileCb.onReceiveValue(null);
        fileCb = cb;
        try { startActivityForResult(p.createIntent(), REQ_FILE); } catch (Exception e) { fileCb = null; return false; }
        return true;
      }
    });
    web.addJavascriptInterface(new Bridge(), "Android");
    web.loadUrl("file:///android_asset/index.html");
    setContentView(web);

    registerReceiver(scanReceiver, new IntentFilter(WifiManager.SCAN_RESULTS_AVAILABLE_ACTION));
    askPerms();
  }

  @Override
  protected void onDestroy() {
    super.onDestroy();
    try { unregisterReceiver(scanReceiver); } catch (Exception ignored) { }
  }

  @Override
  protected void onActivityResult(int req, int res, Intent data) {
    super.onActivityResult(req, res, data);
    if (req == REQ_FILE && fileCb != null) {
      fileCb.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(res, data));
      fileCb = null;
    }
  }

  @Override
  public void onRequestPermissionsResult(int req, String[] p, int[] g) {
    js("window.onInfo && window.onInfo(" + info() + ")");
  }

  @Override
  public void onBackPressed() {
    js("window.onBack && window.onBack()");
  }

  private void askPerms() {
    List<String> want = new ArrayList<>();
    want.add(Manifest.permission.ACCESS_FINE_LOCATION);
    want.add(Manifest.permission.ACCESS_COARSE_LOCATION);
    if (Build.VERSION.SDK_INT >= 33) want.add(Manifest.permission.NEARBY_WIFI_DEVICES);
    List<String> missing = new ArrayList<>();
    for (String p : want) if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) missing.add(p);
    if (!missing.isEmpty()) requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
  }

  private void js(final String code) {
    main.post(new Runnable() { public void run() { web.evaluateJavascript(code, null); } });
  }

  // ───────────── ids ─────────────
  private void setSalt(String code) { salt = ("infinet-survey:" + code.trim().toLowerCase()).getBytes(StandardCharsets.UTF_8); }

  private String hid(String s) {
    try {
      Mac m = Mac.getInstance("HmacSHA256");
      m.init(new SecretKeySpec(salt, "HmacSHA256"));
      byte[] d = m.doFinal(s.getBytes(StandardCharsets.UTF_8));
      StringBuilder sb = new StringBuilder();
      for (int i = 0; i < 6; i++) sb.append(String.format("%02x", d[i]));
      return sb.toString();
    } catch (Exception e) { return "000000000000"; }
  }

  /** one physical access point usually runs several BSSIDs that differ only in the last nibble */
  private static String groupKey(String bssid) {
    String b = bssid.toLowerCase();
    if (b.length() != 17) return b;
    return b.substring(0, 16) + "0";
  }

  private static boolean locallyAdministered(String bssid) {
    try { return (Integer.parseInt(bssid.substring(0, 2), 16) & 0x02) != 0; } catch (Exception e) { return false; }
  }

  private static String security(String cap) {
    String c = cap == null ? "" : cap.toUpperCase();
    boolean sae = c.contains("SAE"), psk = c.contains("PSK"), eap = c.contains("EAP");
    if (c.contains("OWE")) return "OWE";
    if (eap && (c.contains("SUITE_B") || c.contains("SUITE-B") || c.contains("WPA3"))) return "WPA3-ENT";
    if (eap) return "WPA2-ENT";
    if (sae && psk) return "WPA2/3";
    if (sae) return "WPA3-SAE";
    if (psk) return (c.contains("CCMP") || c.contains("GCMP")) ? "WPA2-PSK" : "WPA-TKIP";
    if (c.contains("WEP")) return "WEP";
    return "OPEN";
  }

  private static int channel(int f) {
    if (f == 2484) return 14;
    if (f < 3000) return (f - 2407) / 5;
    if (f < 5925) return (f - 5000) / 5;
    return (f - 5950) / 5;
  }

  private static String band(int f) { return f < 3000 ? "2.4" : f < 5925 ? "5" : "6"; }

  private static int widthMHz(int w) {
    switch (w) { case 0: return 20; case 1: return 40; case 2: return 80; case 3: return 160; case 4: return 160; case 5: return 320; default: return 20; }
  }

  // ───────────── Wi-Fi scanning ─────────────
  private final Runnable scanTick = new Runnable() {
    public void run() {
      if (!scanning) return;
      boolean ok = false;
      try { ok = wifi.startScan(); } catch (Exception ignored) { }
      if (ok) startOk++; else startRefused++;
      main.postDelayed(this, SCAN_EVERY_MS);
    }
  };

  private final BroadcastReceiver scanReceiver = new BroadcastReceiver() {
    @Override
    public void onReceive(Context c, Intent i) {
      boolean fresh = i.getBooleanExtra(WifiManager.EXTRA_RESULTS_UPDATED, false);
      pushScan(fresh);
    }
  };

  private void pushScan(boolean fresh) {
    try {
      List<ScanResult> rs = wifi.getScanResults();
      latest = rs == null ? new ArrayList<ScanResult>() : rs;
      long nowUs = SystemClock.elapsedRealtime() * 1000;
      JSONArray arr = new JSONArray();
      for (ScanResult r : latest) {
        if (r.BSSID == null) continue;
        String ssid = r.SSID == null ? "" : r.SSID;
        boolean demo = ssid.startsWith(DEMO_PREFIX);
        boolean la = locallyAdministered(r.BSSID);
        JSONObject o = new JSONObject();
        o.put("ap", hid("ap:" + r.BSSID.toLowerCase()));
        o.put("grp", hid("grp:" + groupKey(r.BSSID)));
        o.put("net", hid("net:" + ssid));
        o.put("name", ssid);                               // display only; the page saves it only when allowed
        o.put("keep", demo || allow.contains(ssid));       // venue network or one of our demo hotspots
        o.put("demo", demo);
        if (demo) o.put("bssid", r.BSSID.toLowerCase());  // our own hotspot: the real address is ours to keep
        o.put("la", la);
        if (!la) o.put("oui", r.BSSID.substring(0, 8).toLowerCase()); // vendor prefix of infrastructure APs
        o.put("f", r.frequency);
        o.put("ch", channel(r.frequency));
        o.put("band", band(r.frequency));
        o.put("bw", widthMHz(r.channelWidth));
        o.put("sec", security(r.capabilities));
        String cap = r.capabilities == null ? "" : r.capabilities;
        o.put("pmf", cap.contains("MFPR") ? "required" : cap.contains("MFPC") ? "capable" : "none");
        if (Build.VERSION.SDK_INT >= 30) o.put("std", r.getWifiStandard());
        o.put("mc", r.is80211mcResponder());
        o.put("rssi", r.level);
        o.put("ageMs", Math.max(0, (nowUs - r.timestamp) / 1000));
        arr.put(o);
      }
      JSONObject msg = new JSONObject();
      msg.put("fresh", fresh);
      msg.put("t", System.currentTimeMillis());
      msg.put("ok", startOk);
      msg.put("refused", startRefused);
      msg.put("aps", arr);
      js("window.onScan && window.onScan(" + msg.toString() + ")");
    } catch (SecurityException se) {
      js("window.onError && window.onError('Location or nearby-devices permission missing')");
    } catch (Exception e) {
      js("window.onError && window.onError(" + JSONObject.quote(String.valueOf(e)) + ")");
    }
  }

  // ───────────── cellular ─────────────
  private static Object val(int v) { return (v == Integer.MAX_VALUE || v == Integer.MIN_VALUE) ? JSONObject.NULL : (Object) v; }

  private JSONObject cellSnapshot() {
    JSONObject out = new JSONObject();
    JSONArray cells = new JSONArray(), sig = new JSONArray();
    try {
      if (tel != null) {
        List<CellInfo> all = tel.getAllCellInfo();
        if (all != null) for (CellInfo ci : all) {
          JSONObject o = new JSONObject();
          o.put("reg", ci.isRegistered());
          if (ci instanceof CellInfoLte) {
            CellInfoLte l = (CellInfoLte) ci;
            CellIdentityLte id = l.getCellIdentity();
            CellSignalStrengthLte ss = l.getCellSignalStrength();
            o.put("rat", "LTE"); o.put("pci", val(id.getPci())); o.put("arfcn", val(id.getEarfcn()));
            o.put("plmn", plmn(id.getMccString(), id.getMncString()));
            if (Build.VERSION.SDK_INT >= 30) o.put("bands", new JSONArray(id.getBands()));
            o.put("rsrp", val(ss.getRsrp())); o.put("rsrq", val(ss.getRsrq())); o.put("snr", val(ss.getRssnr())); o.put("rssi", val(ss.getRssi()));
          } else if (ci instanceof CellInfoNr) {
            CellInfoNr n = (CellInfoNr) ci;
            CellIdentityNr id = (CellIdentityNr) n.getCellIdentity();
            CellSignalStrengthNr ss = (CellSignalStrengthNr) n.getCellSignalStrength();
            o.put("rat", "NR"); o.put("pci", val(id.getPci())); o.put("arfcn", val(id.getNrarfcn()));
            o.put("plmn", plmn(id.getMccString(), id.getMncString()));
            if (Build.VERSION.SDK_INT >= 30) o.put("bands", new JSONArray(id.getBands()));
            o.put("rsrp", val(ss.getSsRsrp())); o.put("rsrq", val(ss.getSsRsrq())); o.put("snr", val(ss.getSsSinr()));
          } else if (ci instanceof CellInfoWcdma) {
            o.put("rat", "WCDMA"); o.put("dbm", val(((CellInfoWcdma) ci).getCellSignalStrength().getDbm()));
          } else if (ci instanceof CellInfoGsm) {
            o.put("rat", "GSM"); o.put("dbm", val(((CellInfoGsm) ci).getCellSignalStrength().getDbm()));
          } else continue;
          cells.put(o);
        }
        // in 5G NSA the NR leg often shows up only here, not in getAllCellInfo
        SignalStrength s = tel.getSignalStrength();
        if (s != null) for (CellSignalStrength cs : s.getCellSignalStrengths()) {
          JSONObject o = new JSONObject();
          o.put("level", cs.getLevel()); o.put("dbm", val(cs.getDbm()));
          if (cs instanceof CellSignalStrengthNr) {
            CellSignalStrengthNr n = (CellSignalStrengthNr) cs;
            o.put("rat", "NR"); o.put("rsrp", val(n.getSsRsrp())); o.put("rsrq", val(n.getSsRsrq())); o.put("snr", val(n.getSsSinr()));
          } else if (cs instanceof CellSignalStrengthLte) {
            CellSignalStrengthLte l = (CellSignalStrengthLte) cs;
            o.put("rat", "LTE"); o.put("rsrp", val(l.getRsrp())); o.put("rsrq", val(l.getRsrq())); o.put("snr", val(l.getRssnr()));
          } else o.put("rat", cs.getClass().getSimpleName().replace("CellSignalStrength", ""));
          sig.put(o);
        }
      }
    } catch (SecurityException se) {
      try { out.put("error", "permission"); } catch (Exception ignored) { }
    } catch (Exception e) {
      try { out.put("error", String.valueOf(e)); } catch (Exception ignored) { }
    }
    try { out.put("cells", cells); out.put("sig", sig); } catch (Exception ignored) { }
    return out;
  }

  private static String plmn(String mcc, String mnc) { return mcc == null || mnc == null ? "" : mcc + "-" + mnc; }

  // ───────────── storage ─────────────
  private File dir() { File d = getExternalFilesDir(null); if (d == null) d = getFilesDir(); return d; }

  private void writeAtomic(File f, String s) throws Exception {
    File tmp = new File(f.getPath() + ".tmp");
    try (FileOutputStream o = new FileOutputStream(tmp)) { o.write(s.getBytes(StandardCharsets.UTF_8)); o.getFD().sync(); }
    if (!tmp.renameTo(f)) throw new Exception("rename failed");
  }

  private String read(File f) {
    try { return f.exists() ? new String(Files.readAllBytes(f.toPath()), StandardCharsets.UTF_8) : ""; } catch (Exception e) { return ""; }
  }

  private String info() {
    try {
      JSONObject o = new JSONObject();
      o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
      o.put("android", Build.VERSION.RELEASE);
      o.put("sdk", Build.VERSION.SDK_INT);
      o.put("teamCode", prefs.getString("teamCode", ""));
      o.put("allow", new JSONArray(new ArrayList<>(allow)));
      o.put("fine", checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED);
      o.put("nearby", Build.VERSION.SDK_INT < 33 || checkSelfPermission(Manifest.permission.NEARBY_WIFI_DEVICES) == PackageManager.PERMISSION_GRANTED);
      LocationManager lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
      o.put("location", lm != null && lm.isLocationEnabled());
      o.put("wifi", wifi != null && wifi.isWifiEnabled());
      o.put("throttled", Build.VERSION.SDK_INT >= 30 && wifi != null && wifi.isScanThrottleEnabled());
      o.put("rtt", rtt != null && rtt.isAvailable());
      o.put("dir", dir().getAbsolutePath());
      return o.toString();
    } catch (Exception e) { return "{}"; }
  }

  // ───────────── the page's API ─────────────
  private class Bridge {
    @JavascriptInterface public String info() { return MainActivity.this.info(); }

    @JavascriptInterface public void askPermissions() { main.post(new Runnable() { public void run() { askPerms(); } }); }

    @JavascriptInterface public void openSettings(final String which) {
      main.post(new Runnable() {
        public void run() {
          String a = "dev".equals(which) ? android.provider.Settings.ACTION_APPLICATION_DEVELOPMENT_SETTINGS
              : "location".equals(which) ? android.provider.Settings.ACTION_LOCATION_SOURCE_SETTINGS
              : "wifi".equals(which) ? android.provider.Settings.ACTION_WIFI_SETTINGS
              : android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS;
          Intent i = new Intent(a);
          if (a.equals(android.provider.Settings.ACTION_APPLICATION_DETAILS_SETTINGS)) i.setData(Uri.parse("package:" + getPackageName()));
          try { startActivity(i); } catch (Exception ignored) { }
        }
      });
    }

    @JavascriptInterface public void setScanning(final boolean on) {
      main.post(new Runnable() {
        public void run() {
          if (on == scanning) return;
          scanning = on;
          main.removeCallbacks(scanTick);
          if (on) { main.post(scanTick); pushScan(false); }
        }
      });
    }

    @JavascriptInterface public String cells() { return cellSnapshot().toString(); }

    @JavascriptInterface public void setTeamCode(String code) {
      if (code == null || code.trim().length() < 4) return;
      prefs.edit().putString("teamCode", code.trim().toLowerCase()).apply();
      setSalt(code);
    }

    @JavascriptInterface public void setAllow(String json) {
      try {
        JSONArray a = new JSONArray(json);
        allow.clear();
        for (int i = 0; i < a.length(); i++) allow.add(a.getString(i));
        prefs.edit().putString("allow", a.toString()).apply();
      } catch (Exception ignored) { }
    }

    /** id of a network name under the current team code (lets the page name a venue network retroactively) */
    @JavascriptInterface public String netId(String ssid) { return hid("net:" + ssid); }

    @JavascriptInterface public String rttCapable() { return String.valueOf(rtt != null && rtt.isAvailable()); }

    /** range the strongest 802.11mc responders (fine timing measurement); results arrive at window.onRtt */
    @JavascriptInterface public void range(final String tag) {
      main.post(new Runnable() {
        public void run() {
          try {
            if (rtt == null || !rtt.isAvailable()) { js("window.onRtt && window.onRtt(" + JSONObject.quote(tag) + ", [])"); return; }
            List<ScanResult> rs = new ArrayList<>();
            for (ScanResult r : latest) if (r.is80211mcResponder()) rs.add(r);
            Collections.sort(rs, new java.util.Comparator<ScanResult>() { public int compare(ScanResult a, ScanResult b) { return b.level - a.level; } });
            int max = RangingRequest.getMaxPeers();
            if (rs.isEmpty()) { js("window.onRtt && window.onRtt(" + JSONObject.quote(tag) + ", [])"); return; }
            RangingRequest.Builder rb = new RangingRequest.Builder();
            for (int i = 0; i < Math.min(max, rs.size()); i++) rb.addAccessPoint(rs.get(i));
            rtt.startRanging(rb.build(), getMainExecutor(), new RangingResultCallback() {
              @Override public void onRangingFailure(int code) { js("window.onRtt && window.onRtt(" + JSONObject.quote(tag) + ", [])"); }
              @Override public void onRangingResults(List<RangingResult> results) {
                JSONArray arr = new JSONArray();
                try {
                  for (RangingResult r : results) {
                    if (r.getStatus() != RangingResult.STATUS_SUCCESS || r.getMacAddress() == null) continue;
                    JSONObject o = new JSONObject();
                    o.put("ap", hid("ap:" + r.getMacAddress().toString().toLowerCase()));
                    o.put("dM", r.getDistanceMm() / 1000.0);
                    o.put("sdM", r.getDistanceStdDevMm() / 1000.0);
                    o.put("rssi", r.getRssi());
                    o.put("n", r.getNumSuccessfulMeasurements());
                    arr.put(o);
                  }
                } catch (Exception ignored) { }
                js("window.onRtt && window.onRtt(" + JSONObject.quote(tag) + ", " + arr + ")");
              }
            });
          } catch (Exception e) { js("window.onRtt && window.onRtt(" + JSONObject.quote(tag) + ", [])"); }
        }
      });
    }

    @JavascriptInterface public String netType() {
      try {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        NetworkCapabilities nc = cm.getNetworkCapabilities(cm.getActiveNetwork());
        if (nc == null) return "none";
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_WIFI)) return "wifi";
        if (nc.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR)) return "cell";
        return "other";
      } catch (Exception e) { return "unknown"; }
    }

    @JavascriptInterface public boolean save(String name, String json) {
      try { writeAtomic(new File(dir(), name), json); return true; } catch (Exception e) { return false; }
    }

    @JavascriptInterface public String load(String name) { return read(new File(dir(), name)); }

    @JavascriptInterface public String list() {
      JSONArray a = new JSONArray();
      File[] fs = dir().listFiles();
      if (fs != null) for (File f : fs) if (f.getName().endsWith(".json")) a.put(f.getName());
      return a.toString();
    }

    /** copy a file to Downloads/Infinet (visible in the Files app, easy to send or `adb pull`), then offer to share */
    @JavascriptInterface public String export(String name, String json, boolean share) {
      try {
        ContentResolver cr = getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, "Download/Infinet");
        final Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) return "";
        try (OutputStream o = cr.openOutputStream(uri)) { o.write(json.getBytes(StandardCharsets.UTF_8)); }
        if (share) main.post(new Runnable() {
          public void run() {
            Intent s = new Intent(Intent.ACTION_SEND);
            s.setType("application/json");
            s.putExtra(Intent.EXTRA_STREAM, uri);
            s.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try { startActivity(Intent.createChooser(s, "Send the survey")); } catch (Exception ignored) { }
          }
        });
        return "Download/Infinet/" + name;
      } catch (Exception e) { return ""; }
    }
  }
}
