package ru.sergsknarin.remont;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.Toast;
import androidx.core.content.FileProvider;
import java.io.File;

/** «Ремонт и автосервис» для Android: окно с сайтом https://sergsknarin.github.io/Remont/.
 *  Всё содержимое - на сайте (обновляется без переустановки). Здесь только: фото с камеры/галереи,
 *  кнопка «Назад», звонки и внешние ссылки, открытие ссылок сайта в приложении. */
public class MainActivity extends Activity {
    static final String HOST = "sergsknarin.github.io";
    static final String START = "https://" + HOST + "/Remont/app.html";
    private WebView web;
    private ValueCallback<Uri[]> pick;
    private Uri camUri;
    private static final int REQ_FILE = 1;

    @Override protected void onCreate(Bundle b) {
        super.onCreate(b);
        web = new WebView(this);
        setContentView(web);
        web.setOnApplyWindowInsetsListener((v, ins) -> {   // не залезать под строку состояния и кнопки
            v.setPadding(0, ins.getSystemWindowInsetTop(), 0, ins.getSystemWindowInsetBottom());
            return ins;
        });
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setUserAgentString(s.getUserAgentString() + " RemontApp/1");
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, true);

        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl(); String sc = String.valueOf(u.getScheme()), h = String.valueOf(u.getHost());
                if (sc.equals("http") || sc.equals("https")) {
                    // сайт и вход (Яндекс, VK ID) - внутри приложения, остальное - в браузере
                    if (h.equals(HOST) || h.endsWith("yandex.ru") || h.endsWith("yandex.net") || h.endsWith("vk.ru") || h.endsWith("vk.com") || h.endsWith("ok.ru") || h.endsWith("mail.ru")) return false;
                }
                open(new Intent(Intent.ACTION_VIEW, u));   // tel:, whatsapp:, сторонние сайты
                return true;
            }
            @Override public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (r.isForMainFrame() && v.getUrl() != null && !v.getUrl().startsWith("data:"))
                    Toast.makeText(MainActivity.this, "Нет связи: " + e.getDescription() + ". Страницы, открытые раньше, работают без интернета.", Toast.LENGTH_LONG).show();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams p) {
                if (pick != null) pick.onReceiveValue(null);
                pick = cb;
                Intent gallery = p.createIntent();
                gallery.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, p.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                Intent chooser = Intent.createChooser(gallery, "Фото");
                boolean img = false; for (String t : p.getAcceptTypes()) if (t != null && t.startsWith("image")) img = true;
                if (img) try {   // + «Камера»
                    File dir = new File(getCacheDir(), "cam"); dir.mkdirs();
                    File f = new File(dir, "foto_" + System.currentTimeMillis() + ".jpg");
                    camUri = FileProvider.getUriForFile(MainActivity.this, "ru.sergsknarin.remont.files", f);
                    Intent cam = new Intent(MediaStore.ACTION_IMAGE_CAPTURE).putExtra(MediaStore.EXTRA_OUTPUT, camUri)
                            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[]{cam});
                } catch (Exception e) { camUri = null; }
                try { startActivityForResult(chooser, REQ_FILE); } catch (ActivityNotFoundException e) { pick = null; return false; }
                return true;
            }
        });
        web.setDownloadListener((url, ua, cd, mime, len) -> open(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
        Intent in = getIntent();
        web.loadUrl(in != null && in.getData() != null ? in.getData().toString() : START);
    }

    @Override protected void onNewIntent(Intent i) { super.onNewIntent(i); if (i.getData() != null) web.loadUrl(i.getData().toString()); }

    @Override protected void onActivityResult(int req, int res, Intent data) {
        if (req != REQ_FILE || pick == null) { super.onActivityResult(req, res, data); return; }
        Uri[] out = null;
        if (res == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                out = new Uri[data.getClipData().getItemCount()];
                for (int k = 0; k < out.length; k++) out[k] = data.getClipData().getItemAt(k).getUri();
            } else if (data != null && data.getData() != null) out = new Uri[]{data.getData()};
            else if (camUri != null) out = new Uri[]{camUri};   // снимок с камеры
        }
        pick.onReceiveValue(out); pick = null;
    }

    private void open(Intent i) {
        try { startActivity(i); } catch (ActivityNotFoundException e) { Toast.makeText(this, "Нечем открыть: " + i.getData(), Toast.LENGTH_LONG).show(); }
    }

    @Override public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else new AlertDialog.Builder(this).setMessage("Выйти из приложения?").setPositiveButton("Выйти", (d, w) -> finish()).setNegativeButton("Нет", null).show();
    }
    @Override protected void onPause() { super.onPause(); CookieManager.getInstance().flush(); }
}
