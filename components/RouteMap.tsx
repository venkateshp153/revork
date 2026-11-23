import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { RouteLocation, RouteStop } from '@/src/utils/routePlanner';

interface RouteMapProps {
  path: { lat: number; lng: number }[];
  stops: RouteStop[];
  start?: RouteLocation | null;
  end?: RouteLocation | null;
  currentLocation?: RouteLocation | null;
  accent?: string;
  height?: number;
  onStopPress?: (index: number) => void;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

export default function RouteMap({
  path,
  stops,
  start,
  end,
  currentLocation,
  accent = '#2563EB',
  height = 230,
  onStopPress,
}: RouteMapProps) {
  const html = useMemo(() => {
    const safeAccent = /^#[0-9a-fA-F]{3,8}$/.test(accent)
      ? accent
      : '#2563EB';
    const data = {
      path,
      stops: stops.map((stop) => ({
        lat: stop.lat,
        lng: stop.lng,
        address: stop.address,
        delivered: stop.delivered,
        note: stop.note || '',
        etaText: stop.etaText || '',
      })),
      start: start ? { lat: start.lat, lng: start.lng } : null,
      end: end ? { lat: end.lat, lng: end.lng } : null,
      current: currentLocation
        ? { lat: currentLocation.lat, lng: currentLocation.lng }
        : null,
      accent: safeAccent,
    };

    return `<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline' https://unpkg.com; script-src 'unsafe-inline' https://unpkg.com; connect-src https://*.tile.openstreetmap.org https://unpkg.com; font-src https://unpkg.com;" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="anonymous" />
<style>
  html, body, #map { height: 100%; margin: 0; background: #F1F5F9; }
  .pin {
    width: 26px; height: 26px; border-radius: 13px; display: flex;
    align-items: center; justify-content: center; font-size: 11px;
    font-weight: 800; border: 2px solid #fff; color: #fff;
    box-shadow: 0 2px 6px rgba(0,0,0,0.28);
  }
  .pin.current { background: #0EA5E9; font-size: 14px; }
  .popup-title { font-size: 12px; font-weight: 800; margin-bottom: 2px; }
  .popup-meta { font-size: 11px; color: #475569; }
  .popup-note { font-size: 11px; color: #B45309; margin-top: 3px; }
</style>
</head>
<body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js" integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin="anonymous"></script>
<script>
const data = ${safeJson(data)};
const map = L.map('map', { zoomControl: true, attributionControl: false });
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap'
}).addTo(map);

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function numberIcon(text, color, extraClass) {
  return L.divIcon({
    className: '',
    html: '<div class="pin ' + (extraClass || '') + '" style="background:' + color + '">' + text + '</div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -14]
  });
}

const points = [];
if (data.start) points.push([data.start.lat, data.start.lng]);
data.stops.forEach(s => points.push([s.lat, s.lng]));
if (data.end) points.push([data.end.lat, data.end.lng]);
if (data.current) points.push([data.current.lat, data.current.lng]);

if (data.path && data.path.length > 1) {
  L.polyline(data.path.map(p => [p.lat, p.lng]), {
    color: data.accent,
    weight: 5,
    opacity: 0.8
  }).addTo(map);
}

if (data.start) {
  L.marker([data.start.lat, data.start.lng], { icon: numberIcon('S', '#16A34A') })
    .addTo(map)
    .bindPopup('<div class="popup-title">Start</div>');
}

data.stops.forEach((stop, index) => {
  const marker = L.marker([stop.lat, stop.lng], {
    icon: numberIcon(
      stop.delivered ? '&#10003;' : String(index + 1),
      stop.delivered ? '#16A34A' : data.accent
    )
  })
    .addTo(map)
    .bindPopup(
      '<div class="popup-title">' + (index + 1) + '. ' + escapeHtml(stop.address) + '</div>' +
      '<div class="popup-meta">' + (stop.delivered ? 'Delivered' : 'Pending') +
      (stop.etaText ? ' · ETA ' + escapeHtml(stop.etaText) : '') + '</div>' +
      (stop.note ? '<div class="popup-note">' + escapeHtml(stop.note) + '</div>' : '')
    );
  marker.on('click', () => {
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'stop', index }));
  });
});

if (data.end) {
  L.marker([data.end.lat, data.end.lng], { icon: numberIcon('E', '#DC2626') })
    .addTo(map)
    .bindPopup('<div class="popup-title">End</div>');
}

if (data.current) {
  L.marker([data.current.lat, data.current.lng], {
    icon: numberIcon('&#9679;', '#0EA5E9', 'current')
  })
    .addTo(map)
    .bindPopup('<div class="popup-title">You are here</div>');
}

if (points.length > 0) {
  map.fitBounds(L.latLngBounds(points), { padding: [24, 24] });
} else {
  map.setView([20, 0], 2);
}
</script>
</body>
</html>`;
  }, [path, stops, start, end, currentLocation, accent]);

  return (
    <View style={[styles.wrap, { height }]}>
      <WebView
        originWhitelist={['*']}
        source={{ html }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled={false}
        javaScriptCanOpenWindowsAutomatically={false}
        setSupportMultipleWindows={false}
        allowFileAccess={false}
        allowFileAccessFromFileURLs={false}
        allowUniversalAccessFromFileURLs={false}
        mixedContentMode="never"
        scrollEnabled={false}
        onShouldStartLoadWithRequest={(request) =>
          request.url === 'about:blank' ||
          request.url.startsWith('data:text/html') ||
          request.url.startsWith('about:')
        }
        onMessage={(event) => {
          try {
            const message = JSON.parse(event.nativeEvent.data);
            if (
              message?.type === 'stop' &&
              typeof message.index === 'number' &&
              message.index >= 0 &&
              message.index < stops.length
            ) {
              onStopPress?.(message.index);
            }
          } catch {
            // ignore malformed messages
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#F1F5F9',
  },
  webview: { flex: 1, backgroundColor: '#F1F5F9' },
});
