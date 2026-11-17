#!/usr/bin/env bash
# Teste do APK num emulador de TV (usado pelo workflow). Imprime as telas em base64 no log.
set -u
pip install --quiet --break-system-packages pillow 2>/dev/null || pip install --quiet pillow

shot() {
  adb exec-out screencap -p > /tmp/shot.png
  python3 -c "from PIL import Image; im=Image.open('/tmp/shot.png').convert('RGB'); im.thumbnail((800,450)); im.save('/tmp/shot.jpg', quality=55)"
  echo "== SCREENSHOT $1"; base64 -w0 /tmp/shot.jpg; echo
}
key() { adb shell input keyevent "$1"; sleep 1.5; }
api() { curl -sS -m 30 "$@"; echo; }

adb install -r apk/*.apk
adb logcat -c
adb shell am start -n com.streamhub.tv/.MainActivity
sleep 20
adb forward tcp:51730 tcp:51730
B=http://127.0.0.1:51730

echo "== health"; api $B/api/health
echo "== index"; curl -sS -m 10 $B/ | head -c 200; echo
echo "== playlist"; curl -sS -m 30 -o /tmp/pl.txt -w "%{http_code} %{size_download}\n" "$B/api/playlist?url=https%3A%2F%2Fiptv-org.github.io%2Fiptv%2Fcountries%2Fbr.m3u"; head -3 /tmp/pl.txt
echo "== stream manifest"; curl -sS -m 30 "$B/api/stream?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Fx36xhzz.m3u8" | head -4
echo "== stream segment"; SEG=$(curl -sS -m 30 "$B/api/stream?url=https%3A%2F%2Ftest-streams.mux.dev%2Fx36xhzz%2Furl_0%2F193039199_mp4_h264_aac_hd_7.m3u8" | grep -v '^#' | head -1); echo "$SEG"; curl -sS -m 30 -o /dev/null -w "%{http_code} %{content_type} %{size_download}\n" "$SEG"
echo "== range mp4"; curl -sS -m 30 -o /dev/null -D - -H "Range: bytes=0-1023" "$B/api/stream?url=https%3A%2F%2Fcommondatastorage.googleapis.com%2Fgtv-videos-bucket%2Fsample%2FBigBuckBunny.mp4" | grep -iE "^HTTP|content-range|content-length"
echo "== xtream (sem credenciais)"; api -X POST -H 'Content-Type: application/json' -d '{}' $B/api/xtream

shot inicio
echo "== importar M3U pelo controle"
key KEYCODE_DPAD_DOWN; key KEYCODE_DPAD_DOWN; key KEYCODE_DPAD_DOWN
shot foco-no-campo
adb shell input text "https://raw.githubusercontent.com/leozinwf/streamhub/firestick-apk/android/test/teste.m3u"; sleep 1
key KEYCODE_ENTER; sleep 8
shot home
key KEYCODE_DPAD_DOWN; key KEYCODE_DPAD_DOWN
shot foco-cartao
key KEYCODE_DPAD_CENTER; sleep 20
shot assistindo
key KEYCODE_DPAD_DOWN
shot assistindo-controles
key KEYCODE_BACK; sleep 3
shot depois-do-voltar
key KEYCODE_BACK; sleep 1
shot pergunta-sair
echo "== logcat"; adb logcat -d | grep -E "StreamHub|AndroidRuntime|FATAL" | tail -120
exit 0
