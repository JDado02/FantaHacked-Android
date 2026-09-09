package it.fantahacked.app;

import android.annotation.SuppressLint;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.webkit.WebViewAssetLoader;

/**
 * FantaHacked per Android.
 *
 * L'applicazione vera e' nella cartella `web/` del progetto, che Gradle
 * impacchetta negli assets: HTML, CSS e il motore in JavaScript, lo stesso
 * verificato numero per numero contro quello Python del computer.
 * Questa classe fa quattro cose e basta:
 *
 *   1. serve quella cartella su un indirizzo **https** finto;
 *   2. la apre in una WebView a schermo intero;
 *   3. tiene il tasto "indietro" dentro l'applicazione invece di chiuderla;
 *   4. manda al browser di sistema i link che escono da qui.
 *
 * Il punto uno non e' un dettaglio. Caricando i file da `file:///android_asset`
 * la pagina non ha un'origine vera, e il browser blocca tutte le richieste
 * verso l'esterno: l'applicazione non riuscirebbe **mai** a scaricare i dati
 * dei giocatori, e nemmeno a salvare l'asta in modo affidabile.
 * `WebViewAssetLoader` serve gli stessi file su
 * `https://appassets.androidplatform.net/`, che e' un'origine a tutti gli
 * effetti: da li' `fetch` verso GitHub funziona (che risponde con
 * `Access-Control-Allow-Origin: *`) e `localStorage` e' persistente.
 *
 * Non c'e' nessuna logica d'asta in Java, ed e' voluto: un motore solo,
 * scritto una volta, che si puo' confrontare con quello del computer. Due
 * motori diversi vorrebbe dire due risposte diverse sullo stesso giocatore, e
 * nessun modo di sapere quale ha ragione.
 */
public class MainActivity extends AppCompatActivity {

    private static final String CASA =
            "https://appassets.androidplatform.net/assets/index.html";

    private WebView vista;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle statoSalvato) {
        super.onCreate(statoSalvato);
        setContentView(R.layout.activity_main);

        final WebViewAssetLoader caricatore = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        vista = findViewById(R.id.vista);
        WebSettings s = vista.getSettings();
        // Il motore e' JavaScript: senza questo non c'e' applicazione.
        s.setJavaScriptEnabled(true);
        // L'asta si salva in localStorage e deve sopravvivere alla chiusura:
        // e' l'unica cosa che non si puo' riscaricare.
        s.setDomStorageEnabled(true);
        // Nessun accesso al disco: i file arrivano dal caricatore qui sopra.
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setSupportZoom(false);
        // Niente ridimensionamento automatico del testo: la pagina e' gia'
        // pensata per un telefono, e il "text zoom" di sistema la spaccherebbe
        // proprio sui numeri grandi, che sono la cosa da leggere in fretta.
        s.setTextZoom(100);

        vista.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView w, WebResourceRequest r) {
                return caricatore.shouldInterceptRequest(r.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r) {
                Uri u = r.getUrl();
                if ("appassets.androidplatform.net".equals(u.getHost())) return false;
                String schema = u.getScheme();
                if ("http".equals(schema) || "https".equals(schema)) {
                    // Un link esterno apre il browser: dentro l'applicazione
                    // resta soltanto l'applicazione.
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                    return true;
                }
                return false;
            }
        });

        // Il tasto indietro chiude prima i pannelli aperti, poi torna indietro
        // nella cronologia, e solo alla fine esce. Uscire per sbaglio a meta'
        // asta sarebbe la cosa peggiore che possa capitare, anche se l'asta e'
        // salvata e si ritrova al riavvio.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                vista.evaluateJavascript(
                        "(function(){var f=document.querySelectorAll('.foglio:not([hidden])');"
                      + "if(f.length){f.forEach(function(x){x.hidden=true;});return 'chiuso';}"
                      + "return 'niente';})()",
                        valore -> {
                            if (valore != null && valore.contains("niente")) {
                                if (vista.canGoBack()) vista.goBack();
                                else finish();
                            }
                        });
            }
        });

        if (statoSalvato != null) vista.restoreState(statoSalvato);
        else vista.loadUrl(CASA);
    }

    @Override
    protected void onSaveInstanceState(Bundle stato) {
        super.onSaveInstanceState(stato);
        vista.saveState(stato);
    }
}
