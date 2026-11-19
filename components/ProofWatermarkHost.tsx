import React, { useEffect, useRef, useState } from 'react';
import {
  Image,
  NativeModules,
  StyleSheet,
  Text,
  TurboModuleRegistry,
  View,
} from 'react-native';
import { registerProofStampHandler } from '@/src/utils/proofStamp';

interface StampJob {
  uri: string;
  lines: string[];
  width: number;
  height: number;
  resolve: (uri: string) => void;
}

/**
 * Global, hidden compositor that burns the delivery metadata into the proof
 * photo. It only appears while a photo is being stamped and falls back to the
 * original photo if the native view-shot module is unavailable.
 */
export default function ProofWatermarkHost() {
  const [job, setJob] = useState<StampJob | null>(null);
  const shotRef = useRef<View>(null);
  const capturedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unregister = registerProofStampHandler(
      (uri, lines) =>
        new Promise<string>((resolve) => {
          Image.getSize(
            uri,
            (width, height) => {
              const targetWidth = 360;
              const targetHeight = Math.min(
                760,
                Math.max(360, Math.round((targetWidth * height) / width))
              );
              capturedRef.current = false;
              if (timerRef.current) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(() => {
                if (!capturedRef.current) {
                  resolve(uri);
                  setJob(null);
                }
              }, 6000);
              setJob({
                uri,
                lines,
                width: targetWidth,
                height: targetHeight,
                resolve,
              });
            },
            () => resolve(uri)
          );
        })
    );
    return () => {
      unregister();
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const capture = async () => {
    if (!job || capturedRef.current) return;
    capturedRef.current = true;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const hasViewShot = (() => {
      try {
        return (
          !!NativeModules.RNViewShot ||
          !!TurboModuleRegistry.get('RNViewShot')
        );
      } catch {
        return false;
      }
    })();
    if (!hasViewShot) {
      job.resolve(job.uri);
      setJob(null);
      return;
    }
    try {
      const { captureRef } = await import('react-native-view-shot');
      const uri = await captureRef(shotRef as any, {
        format: 'jpg',
        quality: 0.85,
        result: 'tmpfile',
      });
      // Guard against a blank capture (some devices cannot snapshot obscured
      // views). A blank JPEG is dramatically smaller than the original.
      try {
        const FileSystem = await import('expo-file-system/legacy');
        const [shotInfo, sourceInfo] = await Promise.all([
          FileSystem.getInfoAsync(uri),
          FileSystem.getInfoAsync(job.uri),
        ]);
        const shotSize =
          shotInfo.exists && 'size' in shotInfo ? shotInfo.size || 0 : 0;
        const sourceSize =
          sourceInfo.exists && 'size' in sourceInfo
            ? sourceInfo.size || 0
            : 0;
        if (
          shotSize <= 0 ||
          (sourceSize > 0 && shotSize < sourceSize * 0.15)
        ) {
          job.resolve(job.uri);
          return;
        }
      } catch {
        // size check is best-effort
      }
      job.resolve(uri);
    } catch (error) {
      console.warn('[ProofStamp] Could not add watermark:', error);
      job.resolve(job.uri);
    } finally {
      setJob(null);
    }
  };

  if (!job) return null;

  return (
    <View style={styles.host} pointerEvents="none">
      <View
        ref={shotRef}
        collapsable={false}
        style={{ width: job.width, height: job.height }}
      >
        <Image
          source={{ uri: job.uri }}
          style={{ width: job.width, height: job.height }}
          resizeMode="cover"
          onLoad={() => {
            setTimeout(() => {
              void capture();
            }, 140);
          }}
          onError={() => {
            job.resolve(job.uri);
            setJob(null);
          }}
        />
        <View style={styles.overlay}>
          <View style={styles.brandRow}>
            <Text style={styles.brand}>REVORK · DELIVERY PROOF</Text>
          </View>
          {job.lines.filter(Boolean).map((line, index) => (
            <Text
              key={`${index}-${line}`}
              style={[
                styles.line,
                index === 0 ? styles.strongLine : undefined,
              ]}
              numberOfLines={2}
            >
              {line}
            </Text>
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 0,
    left: 0,
    zIndex: -1,
  },
  overlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(8,15,30,0.78)',
    paddingHorizontal: 10,
    paddingVertical: 8,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 3 },
  brand: {
    color: '#86EFAC',
    fontSize: 7,
    fontWeight: '800',
    letterSpacing: 1,
  },
  line: { color: '#E2E8F0', fontSize: 8, lineHeight: 11 },
  strongLine: { color: '#FFFFFF', fontSize: 9.5, fontWeight: '800' },
});
