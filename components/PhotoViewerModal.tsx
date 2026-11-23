import React from 'react';
import {
  Image,
  Modal,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { openSafeHttpsUrl } from '@/src/utils/safeUrl';

export interface ViewerPhoto {
  uri: string;
  title?: string;
  subtitle?: string;
  meta?: string[];
  driveUrl?: string;
}

interface Props {
  visible: boolean;
  photo: ViewerPhoto | null;
  onClose: () => void;
  onDelete?: () => void;
}

/** Full-screen proof photo viewer with its immutable delivery metadata. */
export default function PhotoViewerModal({
  visible,
  photo,
  onClose,
  onDelete,
}: Props) {
  return (
    <Modal
      visible={visible && !!photo}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <View style={styles.headerText}>
            <Text style={styles.title} numberOfLines={1}>
              {photo?.title || 'Proof photo'}
            </Text>
            {!!photo?.subtitle && (
              <Text style={styles.subtitle} numberOfLines={2}>
                {photo.subtitle}
              </Text>
            )}
          </View>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <MaterialCommunityIcons name="close" size={22} color="#fff" />
          </TouchableOpacity>
        </View>

        {!!photo?.uri && (
          <Image
            source={{ uri: photo.uri }}
            style={styles.image}
            resizeMode="contain"
          />
        )}

        <View style={styles.footer}>
          {(photo?.meta || []).map((line) => (
            <Text key={line} style={styles.metaLine}>
              {line}
            </Text>
          ))}
          <View style={styles.actions}>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                const message = [
                  photo?.title,
                  photo?.subtitle,
                  photo?.driveUrl,
                ]
                  .filter(Boolean)
                  .join('\n');
                void Share.share({ title: photo?.title, message });
              }}
            >
              <MaterialCommunityIcons
                name="share-variant-outline"
                size={16}
                color="#fff"
              />
              <Text style={styles.actionText}>Share</Text>
            </TouchableOpacity>
            {!!photo?.driveUrl && (
              <TouchableOpacity
                style={styles.actionButton}
                onPress={() => {
                  if (photo?.driveUrl) {
                    void openSafeHttpsUrl(photo.driveUrl, {
                      hosts: [
                        'drive.google.com',
                        'docs.google.com',
                        'lh3.googleusercontent.com',
                      ],
                    });
                  }
                }}
              >
                <MaterialCommunityIcons
                  name="google-drive"
                  size={16}
                  color="#fff"
                />
                <Text style={styles.actionText}>Open in Drive</Text>
              </TouchableOpacity>
            )}
            {onDelete && (
              <TouchableOpacity
                style={[styles.actionButton, styles.deleteButton]}
                onPress={onDelete}
              >
                <MaterialCommunityIcons
                  name="delete-outline"
                  size={16}
                  color="#FCA5A5"
                />
                <Text style={[styles.actionText, { color: '#FCA5A5' }]}>
                  Delete local copy
                </Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingTop: 52,
    paddingHorizontal: 16,
    paddingBottom: 10,
  },
  headerText: { flex: 1, paddingRight: 10 },
  title: { color: '#fff', fontSize: 15, fontWeight: '800' },
  subtitle: { color: '#94A3B8', fontSize: 10.5, marginTop: 3, lineHeight: 14 },
  closeButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  image: { flex: 1, width: '100%' },
  footer: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 30,
    backgroundColor: 'rgba(15,23,42,0.9)',
  },
  metaLine: { color: '#CBD5E1', fontSize: 10.5, lineHeight: 15 },
  actions: { flexDirection: 'row', marginTop: 10, flexWrap: 'wrap' },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderRadius: 9,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
    marginBottom: 6,
  },
  deleteButton: { backgroundColor: 'rgba(220,38,38,0.18)' },
  actionText: { color: '#fff', fontSize: 10.5, fontWeight: '800', marginLeft: 5 },
});
